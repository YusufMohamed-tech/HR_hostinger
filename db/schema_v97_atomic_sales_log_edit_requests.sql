-- Make sales-log edit request submission replay-safe and publish both request
-- and resolution notifications through the durable outbox.

CREATE TABLE IF NOT EXISTS public.sales_log_edit_request_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action = 'submit'),
  edit_request_id uuid REFERENCES public.sales_log_edit_requests(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.sales_log_edit_request_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_log_edit_request_commands_select
  ON public.sales_log_edit_request_commands;
CREATE POLICY sales_log_edit_request_commands_select
  ON public.sales_log_edit_request_commands
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND actor_user_id = auth.uid()
    )
  );

-- Submission is server-command-owned. Existing read policies remain intact.
DROP POLICY IF EXISTS sales_log_edit_requests_insert
  ON public.sales_log_edit_requests;

CREATE OR REPLACE FUNCTION public.submit_sales_log_edit_request(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_sales_log_id uuid,
  p_requested_changes text
)
RETURNS SETOF public.sales_log_edit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.sales_log_edit_request_commands%ROWTYPE;
  log_row public.sales_logs%ROWTYPE;
  request_row public.sales_log_edit_requests%ROWTYPE;
  actor_role_value text;
  business_date_value date;
  payload_value jsonb;
  payload_hash_value text;
  event_payload jsonb;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_requested_changes, ''))) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'Requested changes must contain between 3 and 2000 characters.' USING ERRCODE = '23514';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.profiles profile
    ON profile.user_id = member.user_id
   AND profile.org_id = member.org_id
   AND profile.account_status = 'Active'
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN ('sales', 'sales_manager');
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'An active sales membership is required.' USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'sales_log_id', p_sales_log_id,
    'requested_changes', btrim(p_requested_changes)
  );
  payload_hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.sales_log_edit_request_commands (
    organization_id, idempotency_key, action, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, 'submit', payload_hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row
  FROM public.sales_log_edit_request_commands command
  WHERE command.organization_id = p_org_id
    AND command.idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'submit'
     OR command_row.payload_hash <> payload_hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for another sales edit request.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.sales_log_edit_requests request
      WHERE request.organization_id = p_org_id
        AND request.id = command_row.edit_request_id;
    RETURN;
  END IF;

  SELECT * INTO log_row
  FROM public.sales_logs log
  WHERE log.organization_id = p_org_id
    AND log.id = p_sales_log_id
  FOR SHARE;
  IF log_row.id IS NULL THEN
    RAISE EXCEPTION 'Sales log was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF log_row.sales_agent_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Only the sales-log owner can request an edit.' USING ERRCODE = '42501';
  END IF;
  IF log_row.status = 'voided' THEN
    RAISE EXCEPTION 'A voided sales log cannot be edited.' USING ERRCODE = '55000';
  END IF;

  business_date_value := public.organization_business_date(p_org_id, now());
  IF NOT EXISTS (
    SELECT 1
    FROM public.sales_company_assignments assignment
    WHERE assignment.organization_id = p_org_id
      AND assignment.company_id = log_row.company_id
      AND assignment.user_id = p_actor_user_id
      AND assignment.is_active
      AND assignment.start_date <= business_date_value
      AND (assignment.end_date IS NULL OR assignment.end_date >= business_date_value)
  ) THEN
    RAISE EXCEPTION 'The sales-log company is not currently assigned to the requester.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sales_log_edit_requests (
    organization_id, sales_log_id, company_id, sales_agent_id,
    requested_changes, status
  ) VALUES (
    p_org_id, log_row.id, log_row.company_id, p_actor_user_id,
    btrim(p_requested_changes), 'pending'
  ) RETURNING * INTO request_row;

  event_payload := jsonb_build_object(
    'event_type', 'sales_log.edit_requested',
    'edit_request_id', request_row.id,
    'sales_log_id', log_row.id,
    'company_id', log_row.company_id,
    'sales_agent_id', log_row.sales_agent_id,
    'requested_changes', request_row.requested_changes,
    'log_date', log_row.log_date,
    'grand_total', log_row.grand_total
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'sales_log_edit_request', request_row.id::text || ':submitted',
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, 'sales_log.edit_requested', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'sales_log.edit_requested', 'sales_log_edit_request', request_row.id::text,
    'success', 201, jsonb_build_object('sales_log_id', log_row.id, 'company_id', log_row.company_id)
  );
  UPDATE public.sales_log_edit_request_commands
  SET edit_request_id = request_row.id,
      status = 'completed',
      completed_at = now(),
      result = event_payload
  WHERE id = command_row.id;

  RETURN NEXT request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_log_emit_edit_resolution_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  log_row public.sales_logs%ROWTYPE;
  event_payload jsonb;
  event_id_value uuid;
  request_id_value uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'pending'
     OR NEW.status NOT IN ('applied', 'rejected') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO log_row FROM public.sales_logs log
  WHERE log.organization_id = NEW.organization_id
    AND log.id = NEW.sales_log_id;
  SELECT command.request_id INTO request_id_value
  FROM public.sales_log_commands command
  WHERE command.organization_id = NEW.organization_id
    AND command.entity_id = NEW.id
    AND command.status = 'processing'
  ORDER BY command.created_at DESC
  LIMIT 1;

  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'event_type', 'sales_log.edit_resolved',
    'edit_request_id', NEW.id,
    'sales_log_id', NEW.sales_log_id,
    'company_id', NEW.company_id,
    'sales_agent_id', NEW.sales_agent_id,
    'resolution_status', NEW.status,
    'resolution_note', NEW.resolution_note,
    'log_date', log_row.log_date,
    'grand_total', log_row.grand_total
  ));
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    NEW.organization_id, 'sales_log_edit_request', NEW.id::text || ':' || NEW.status,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    request_id_value, NEW.resolved_by, now(), now()
  )
  ON CONFLICT (org_id, source_type, business_key) DO UPDATE
    SET updated_at = public.business_events.updated_at
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    NEW.organization_id, event_id_value, 'sales_log.edit_resolved', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  )
  ON CONFLICT (business_event_id, topic) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_log_edit_resolution_event
  ON public.sales_log_edit_requests;
CREATE TRIGGER trg_sales_log_edit_resolution_event
  AFTER UPDATE OF status ON public.sales_log_edit_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sales_log_emit_edit_resolution_event();

REVOKE ALL ON FUNCTION public.submit_sales_log_edit_request(uuid, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_log_edit_request(uuid, uuid, uuid, uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.sales_log_emit_edit_resolution_event()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.sales_log_edit_request_commands IS
  'Replay ledger for sales-log edit request submissions.';
COMMENT ON FUNCTION public.submit_sales_log_edit_request(uuid, uuid, uuid, uuid, uuid, text) IS
  'Submits one tenant-scoped sales-log edit request with idempotency, audit, and durable notification event.';
