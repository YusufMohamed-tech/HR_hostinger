-- v87: idempotent leave review commands, atomic HR escalation notifications,
-- and exactly-once notification delivery for durable business events.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES public.business_events(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname = 'notifications_source_event_user_key'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_source_event_user_key UNIQUE (source_event_id, user_id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.leave_review_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  result_snapshot jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, command_id)
);

ALTER TABLE public.leave_review_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_review_commands_service_only ON public.leave_review_commands;
CREATE POLICY leave_review_commands_service_only ON public.leave_review_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.leave_review_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.leave_review_commands TO service_role;

CREATE OR REPLACE FUNCTION public.execute_leave_review_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_leave_request_id uuid,
  p_command_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_record public.leave_review_commands%ROWTYPE;
  result_value jsonb;
  normalized_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  request_payload jsonb;
  request_hash text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_leave_request_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, leave request, and command ids are required.' USING ERRCODE = '22023';
  END IF;

  request_payload := jsonb_build_object(
    'leave_request_id', p_leave_request_id,
    'decision', p_decision,
    'note', normalized_note
  );
  request_hash := encode(digest(request_payload::text, 'sha256'), 'hex');

  SELECT * INTO command_record
  FROM public.leave_review_commands
  WHERE org_id = p_org_id AND command_id = p_command_id
  FOR UPDATE;

  IF command_record.id IS NOT NULL THEN
    IF command_record.leave_request_id <> p_leave_request_id
       OR command_record.actor_user_id <> p_actor_user_id
       OR command_record.payload_hash <> request_hash THEN
      RAISE EXCEPTION 'Command id was already used with different leave-review input.' USING ERRCODE = '23505';
    END IF;
    IF command_record.status = 'completed' AND command_record.result_snapshot IS NOT NULL THEN
      RETURN command_record.result_snapshot;
    END IF;
    RAISE EXCEPTION 'Leave-review command is already processing.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.leave_review_commands (
    org_id, command_id, leave_request_id, actor_user_id, payload_hash
  ) VALUES (
    p_org_id, p_command_id, p_leave_request_id, p_actor_user_id, request_hash
  );

  SELECT to_jsonb(reviewed) INTO result_value
  FROM public.review_leave_request(
    p_org_id,
    p_actor_user_id,
    p_leave_request_id,
    p_command_id,
    p_decision,
    normalized_note
  ) reviewed
  LIMIT 1;

  IF result_value IS NULL THEN
    RAISE EXCEPTION 'Leave review returned no result.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.leave_review_commands
  SET status = 'completed', result_snapshot = result_value, completed_at = clock_timestamp()
  WHERE org_id = p_org_id AND command_id = p_command_id;

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_leave_review_command(uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_leave_review_command(uuid, uuid, uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_leave_manager_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id_value uuid;
  event_payload jsonb;
  employee_name_value text;
  recipient_ids uuid[];
BEGIN
  IF OLD.status::text <> 'pending'
     OR NEW.status::text <> 'pending'
     OR COALESCE(NEW.current_step, 1) <= COALESCE(OLD.current_step, 1) THEN
    RETURN NEW;
  END IF;

  SELECT employee.full_name INTO employee_name_value
  FROM public.employees employee
  WHERE employee.org_id = NEW.org_id AND employee.id = NEW.employee_id;

  SELECT COALESCE(array_agg(DISTINCT member.user_id), ARRAY[]::uuid[]) INTO recipient_ids
  FROM public.org_members member
  WHERE member.org_id = NEW.org_id AND member.role::text IN ('admin', 'hr_admin');

  event_payload := jsonb_build_object(
    'leave_request_id', NEW.id,
    'employee_id', NEW.employee_id,
    'employee_name', COALESCE(employee_name_value, 'موظف'),
    'current_step', COALESCE(NEW.current_step, 1),
    'recipient_user_ids', to_jsonb(recipient_ids)
  );

  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    actor_user_id, occurred_at, processed_at
  ) VALUES (
    NEW.org_id,
    'leave.manager_approved',
    NEW.id::text || ':' || COALESCE(NEW.current_step, 1)::text,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed',
    NEW.decided_by,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (org_id, source_type, business_key) DO UPDATE
    SET processed_at = public.business_events.processed_at
  RETURNING id INTO event_id_value;

  IF cardinality(recipient_ids) > 0 THEN
    INSERT INTO public.event_outbox (
      org_id, business_event_id, topic, payload, payload_hash
    ) VALUES (
      NEW.org_id,
      event_id_value,
      'leave.manager_approved',
      event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex')
    ) ON CONFLICT (business_event_id, topic) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_leave_manager_approval_trigger ON public.leave_requests;
CREATE TRIGGER enqueue_leave_manager_approval_trigger
  AFTER UPDATE OF status, current_step ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_leave_manager_approval();

COMMENT ON COLUMN public.notifications.source_event_id IS
  'Durable business event that produced the notification; unique with user_id for exactly-once delivery.';
COMMENT ON TABLE public.leave_review_commands IS
  'Idempotency ledger for atomic leave approval and rejection commands.';
