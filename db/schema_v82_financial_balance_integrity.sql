-- Atomic manual balances, verifiable acknowledgements, and service-only protected storage.

ALTER TABLE public.financial_balances
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_sha256 text,
  ADD COLUMN IF NOT EXISTS attachment_scan_status text,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledgment_name text,
  ADD COLUMN IF NOT EXISTS acknowledgment_signature_hash text,
  ADD COLUMN IF NOT EXISTS acknowledgment_evidence jsonb;

CREATE TABLE IF NOT EXISTS public.financial_balance_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('create', 'acknowledge')),
  balance_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.financial_balance_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_balance_commands_service_only ON public.financial_balance_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_trusted_financial_balance_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Financial balances require a trusted command.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_trusted_financial_balance_write ON public.financial_balances;
CREATE TRIGGER trg_guard_trusted_financial_balance_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.financial_balances
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_financial_balance_write();

CREATE OR REPLACE FUNCTION public.create_financial_balance(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_balance_id uuid, p_employee_id uuid, p_balance_type text, p_amount numeric,
  p_description text, p_attachment jsonb DEFAULT NULL
)
RETURNS SETOF public.financial_balances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.financial_balance_commands%ROWTYPE; row_value public.financial_balances%ROWTYPE;
  actor_role_value text; employee_user_id uuid; input_value jsonb; hash_value text;
  event_payload jsonb; notification_payload jsonb; event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN
    RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;
  SELECT user_id INTO employee_user_id FROM public.employees
  WHERE org_id = p_org_id AND id = p_employee_id AND lifecycle_status <> 'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_balance_type NOT IN ('deficit', 'loan', 'advance_payment', 'reimbursement') OR COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Balance type and positive amount are required.' USING ERRCODE = '23514'; END IF;
  IF p_attachment IS NOT NULL AND (p_attachment->>'scan_status' <> 'clean'
      OR length(COALESCE(p_attachment->>'sha256', '')) <> 64
      OR p_attachment->>'path' NOT LIKE 'balances/' || p_org_id::text || '/' || p_balance_id::text || '/' || p_command_id::text || '/%') THEN
    RAISE EXCEPTION 'Balance attachment must be clean and command scoped.' USING ERRCODE = '23514'; END IF;
  input_value := jsonb_build_object('balance_id', p_balance_id, 'employee_id', p_employee_id,
    'balance_type', p_balance_type, 'amount', round(p_amount, 2),
    'description', NULLIF(btrim(COALESCE(p_description, '')), ''), 'attachment', p_attachment);
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.financial_balance_commands (id, org_id, actor_user_id, action, balance_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'create', p_balance_id, hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.financial_balance_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'create' OR command_row.balance_id IS DISTINCT FROM p_balance_id
     OR command_row.input_hash <> hash_value THEN
    RAISE EXCEPTION 'Financial-balance command was reused with different input.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.financial_balances WHERE org_id = p_org_id AND id = p_balance_id; RETURN;
  END IF;
  INSERT INTO public.financial_balances (id, org_id, employee_id, balance_type, amount, status,
    description, attachment_url, attachment_name, attachment_sha256, attachment_scan_status, version)
  VALUES (p_balance_id, p_org_id, p_employee_id, p_balance_type, round(p_amount, 2), 'unpaid',
    NULLIF(btrim(COALESCE(p_description, '')), ''), p_attachment->>'path', p_attachment->>'filename',
    p_attachment->>'sha256', p_attachment->>'scan_status', 1)
  RETURNING * INTO row_value;
  event_payload := jsonb_build_object('event_type', 'financial.balance_created', 'balance_id', row_value.id,
    'employee_id', row_value.employee_id, 'balance_type', row_value.balance_type,
    'amount', row_value.amount, 'version', row_value.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'financial_balance', row_value.id::text || ':created', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id,
    p_actor_user_id, now(), now()) RETURNING id INTO event_id_value;
  IF employee_user_id IS NOT NULL THEN
    notification_payload := event_payload || jsonb_build_object('employee_user_id', employee_user_id);
    INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
    VALUES (p_org_id, event_id_value, 'financial.balance_created', notification_payload,
      encode(digest(notification_payload::text, 'sha256'), 'hex'));
  END IF;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'financial.balance_created',
    'financial_balance', row_value.id::text, 'success', 201, event_payload);
  UPDATE public.financial_balance_commands SET status = 'completed', result = to_jsonb(row_value), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT row_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_financial_balance(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_balance_id uuid, p_expected_version integer, p_typed_name text, p_evidence jsonb
)
RETURNS SETOF public.financial_balances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.financial_balance_commands%ROWTYPE; row_value public.financial_balances%ROWTYPE;
  employee_name_value text; input_value jsonb; hash_value text; signature_hash_value text;
  event_payload jsonb; event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT balance.* INTO row_value FROM public.financial_balances balance
  JOIN public.employees employee ON employee.org_id = balance.org_id AND employee.id = balance.employee_id
  WHERE balance.org_id = p_org_id AND balance.id = p_balance_id AND employee.user_id = p_actor_user_id
  FOR UPDATE OF balance;
  IF row_value.id IS NULL THEN RAISE EXCEPTION 'Balance was not found for this employee.' USING ERRCODE = 'P0002'; END IF;
  SELECT full_name INTO employee_name_value FROM public.employees WHERE org_id = p_org_id AND id = row_value.employee_id;
  IF length(btrim(COALESCE(p_typed_name, ''))) < 2 OR p_evidence->>'consent' <> 'true'
     OR length(COALESCE(p_evidence->>'terms_version', '')) = 0 THEN
    RAISE EXCEPTION 'Typed name and acknowledgement consent are required.' USING ERRCODE = '23514'; END IF;
  input_value := jsonb_build_object('balance_id', p_balance_id, 'expected_version', p_expected_version,
    'typed_name', btrim(p_typed_name), 'evidence', p_evidence);
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.financial_balance_commands (id, org_id, actor_user_id, action, balance_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'acknowledge', p_balance_id, hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.financial_balance_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'acknowledge' OR command_row.balance_id IS DISTINCT FROM p_balance_id
     OR command_row.input_hash <> hash_value THEN
    RAISE EXCEPTION 'Financial-balance command was reused with different input.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN NEXT row_value; RETURN; END IF;
  IF row_value.version <> p_expected_version OR row_value.status = 'acknowledged' THEN
    RAISE EXCEPTION 'Balance acknowledgement version is stale.' USING ERRCODE = '40001'; END IF;
  signature_hash_value := encode(digest((p_evidence || jsonb_build_object('typed_name', btrim(p_typed_name)))::text,
    'sha256'), 'hex');
  UPDATE public.financial_balances SET status = 'acknowledged', acknowledged_at = now(),
    acknowledged_by = p_actor_user_id, acknowledgment_name = btrim(p_typed_name),
    acknowledgment_signature_hash = signature_hash_value, acknowledgment_evidence = p_evidence,
    acknowledgment_signature_url = 'electronic-evidence:' || signature_hash_value, version = version + 1,
    updated_at = now()
  WHERE id = row_value.id RETURNING * INTO row_value;
  event_payload := jsonb_build_object('event_type', 'financial.balance_acknowledged', 'balance_id', row_value.id,
    'employee_id', row_value.employee_id, 'employee_name', employee_name_value,
    'balance_type', row_value.balance_type, 'amount', row_value.amount, 'version', row_value.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'financial_balance', row_value.id::text || ':acknowledged', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id,
    p_actor_user_id, now(), now()) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id_value, 'financial.balance_acknowledged', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, 'employee', 'financial.balance_acknowledged',
    'financial_balance', row_value.id::text, 'success', 200,
    jsonb_build_object('signature_hash', signature_hash_value, 'version', row_value.version));
  UPDATE public.financial_balance_commands SET status = 'completed', result = to_jsonb(row_value), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT row_value;
END;
$$;

REVOKE ALL ON FUNCTION public.create_financial_balance(uuid, uuid, uuid, uuid, uuid, uuid, text, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_financial_balance(uuid, uuid, uuid, uuid, uuid, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_financial_balance(uuid, uuid, uuid, uuid, uuid, uuid, text, numeric, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_financial_balance(uuid, uuid, uuid, uuid, uuid, integer, text, jsonb)
  TO service_role;

-- All protected attachment signing now goes through an authorization-aware server route.
UPDATE storage.buckets SET public = false
WHERE id IN ('balance-attachments', 'recruitment', 'task-attachments', 'chat-attachments');
DROP POLICY IF EXISTS balance_attachments_select ON storage.objects;
DROP POLICY IF EXISTS balance_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS balance_attachments_update ON storage.objects;
DROP POLICY IF EXISTS balance_attachments_delete ON storage.objects;
DROP POLICY IF EXISTS recruitment_attachments_select ON storage.objects;
DROP POLICY IF EXISTS recruitment_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS recruitment_attachments_update ON storage.objects;
DROP POLICY IF EXISTS recruitment_attachments_delete ON storage.objects;
DROP POLICY IF EXISTS task_attachments_select ON storage.objects;
DROP POLICY IF EXISTS task_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS task_attachments_update ON storage.objects;
DROP POLICY IF EXISTS task_attachments_delete ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_select ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_update ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_delete ON storage.objects;
CREATE POLICY protected_uploads_service_select ON storage.objects FOR SELECT
  USING (bucket_id IN ('balance-attachments','recruitment','task-attachments','chat-attachments') AND auth.role() = 'service_role');
CREATE POLICY protected_uploads_service_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id IN ('balance-attachments','recruitment','task-attachments','chat-attachments') AND auth.role() = 'service_role');
CREATE POLICY protected_uploads_service_update ON storage.objects FOR UPDATE
  USING (bucket_id IN ('balance-attachments','recruitment','task-attachments','chat-attachments') AND auth.role() = 'service_role')
  WITH CHECK (bucket_id IN ('balance-attachments','recruitment','task-attachments','chat-attachments') AND auth.role() = 'service_role');
CREATE POLICY protected_uploads_service_delete ON storage.objects FOR DELETE
  USING (bucket_id IN ('balance-attachments','recruitment','task-attachments','chat-attachments') AND auth.role() = 'service_role');
