-- Policy-driven, idempotent employee advances with payroll installments.

ALTER TABLE public.advance_requests
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_deduction_month date,
  ADD COLUMN IF NOT EXISTS outstanding_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.accounting_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disbursed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disbursed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.advance_requests DROP CONSTRAINT IF EXISTS advance_requests_status_check;
ALTER TABLE public.advance_requests ADD CONSTRAINT advance_requests_status_check
  CHECK (status IN ('pending', 'approved', 'partial_approved', 'rejected', 'disbursed', 'repaying', 'repaid', 'cancelled'));
ALTER TABLE public.advance_requests ADD CONSTRAINT advance_requests_version_check CHECK (version >= 0);
ALTER TABLE public.advance_requests ADD CONSTRAINT advance_requests_amounts_check CHECK (
  requested_amount > 0
  AND (approved_amount IS NULL OR (approved_amount > 0 AND approved_amount <= requested_amount))
  AND outstanding_amount >= 0
  AND (approved_amount IS NULL OR outstanding_amount <= approved_amount)
);
ALTER TABLE public.advance_requests ADD CONSTRAINT advance_requests_installments_check CHECK (installment_count BETWEEN 1 AND 60);
ALTER TABLE public.advance_requests ADD CONSTRAINT advance_requests_first_month_check CHECK (
  first_deduction_month IS NULL OR first_deduction_month = date_trunc('month', first_deduction_month)::date
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_request_payment
  ON public.advance_requests(organization_id, payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE public.financial_balances
  ADD COLUMN IF NOT EXISTS advance_request_id uuid REFERENCES public.advance_requests(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_balance_advance_request
  ON public.financial_balances(org_id, advance_request_id) WHERE advance_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.advance_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  allow_stacking boolean NOT NULL DEFAULT false,
  max_active_advances integer NOT NULL DEFAULT 1 CHECK (max_active_advances BETWEEN 1 AND 20),
  max_outstanding_salary_multiple numeric(8,2) NOT NULL DEFAULT 1 CHECK (max_outstanding_salary_multiple > 0 AND max_outstanding_salary_multiple <= 24),
  min_installments integer NOT NULL DEFAULT 1 CHECK (min_installments BETWEEN 1 AND 60),
  max_installments integer NOT NULL DEFAULT 12 CHECK (max_installments BETWEEN 1 AND 60),
  termination_treatment text NOT NULL DEFAULT 'settle_before_offboarding'
    CHECK (termination_treatment IN ('settle_before_offboarding', 'final_payroll')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_installments >= min_installments)
);

INSERT INTO public.advance_policies (organization_id)
SELECT id FROM public.organizations ON CONFLICT (organization_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_advance_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.advance_policies (organization_id) VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ensure_advance_policy_trigger ON public.organizations;
CREATE TRIGGER ensure_advance_policy_trigger AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_advance_policy();

CREATE TABLE IF NOT EXISTS public.advance_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  advance_request_id uuid NOT NULL REFERENCES public.advance_requests(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  due_month date NOT NULL CHECK (due_month = date_trunc('month', due_month)::date),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'allocated', 'consumed', 'waived')),
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  payslip_id uuid REFERENCES public.payslips(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  waived_at timestamptz,
  waiver_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (advance_request_id, sequence_no),
  UNIQUE (advance_request_id, due_month)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_installment_payslip
  ON public.advance_installments(payslip_id) WHERE payslip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS advance_installments_due_idx
  ON public.advance_installments(organization_id, employee_id, due_month, status);

CREATE TABLE IF NOT EXISTS public.advance_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('submit', 'review', 'disburse')),
  advance_request_id uuid REFERENCES public.advance_requests(id) ON DELETE SET NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.advance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advance_requests_insert ON public.advance_requests;
DROP POLICY IF EXISTS advance_requests_update ON public.advance_requests;
DROP POLICY IF EXISTS advance_requests_delete ON public.advance_requests;
DROP POLICY IF EXISTS advance_requests_select ON public.advance_requests;
CREATE POLICY advance_requests_select ON public.advance_requests FOR SELECT USING (
  auth.role() = 'service_role' OR (
    organization_id = public.current_org_id() AND (
      employee_id = public.current_employee_id() OR EXISTS (
        SELECT 1 FROM public.org_members WHERE org_id = organization_id AND user_id = auth.uid()
          AND role::text IN ('admin', 'hr_admin', 'finance_manager', 'accountant', 'finance_viewer')
      )
    )
  )
);
CREATE POLICY advance_policies_select ON public.advance_policies FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id() AND EXISTS (
    SELECT 1 FROM public.org_members WHERE org_id = organization_id AND user_id = auth.uid()
      AND role::text IN ('admin', 'hr_admin', 'finance_manager', 'accountant', 'finance_viewer')
  ))
);
CREATE POLICY advance_installments_select ON public.advance_installments FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id() AND (
    employee_id = public.current_employee_id() OR EXISTS (
      SELECT 1 FROM public.org_members WHERE org_id = organization_id AND user_id = auth.uid()
        AND role::text IN ('admin', 'hr_admin', 'finance_manager', 'accountant', 'finance_viewer')
    )
  ))
);
CREATE POLICY advance_commands_select ON public.advance_commands FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id() AND EXISTS (
    SELECT 1 FROM public.org_members WHERE org_id = organization_id AND user_id = auth.uid()
      AND role::text IN ('admin', 'hr_admin', 'finance_manager')
  ))
);

CREATE OR REPLACE FUNCTION public.submit_advance_request(
  p_org_id uuid, p_employee_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_requested_amount numeric, p_reason text,
  p_signature_data text, p_installment_count integer, p_first_deduction_month date
)
RETURNS SETOF public.advance_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.advance_commands%ROWTYPE;
  request_row public.advance_requests%ROWTYPE;
  policy_row public.advance_policies%ROWTYPE;
  event_id uuid;
  event_payload jsonb;
  payload jsonb := jsonb_build_object('employee_id', p_employee_id, 'requested_amount', p_requested_amount,
    'reason', COALESCE(p_reason, ''), 'signature_hash', encode(digest(COALESCE(p_signature_data, ''), 'sha256'), 'hex'),
    'installment_count', p_installment_count, 'first_deduction_month', p_first_deduction_month);
  hash_value text;
  earliest_month date;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE org_id = p_org_id AND id = p_employee_id
      AND user_id = p_actor_user_id AND lifecycle_status = 'active') THEN
    RAISE EXCEPTION 'Active employee identity is required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO policy_row FROM public.advance_policies WHERE organization_id = p_org_id;
  earliest_month := (date_trunc('month', public.organization_business_date(p_org_id, now())) + interval '1 month')::date;
  IF round(p_requested_amount, 2) <= 0 OR p_requested_amount <> round(p_requested_amount, 2)
     OR NULLIF(p_signature_data, '') IS NULL OR p_signature_data NOT LIKE 'data:image/%'
     OR length(p_signature_data) > 1500000
     OR p_installment_count NOT BETWEEN policy_row.min_installments AND policy_row.max_installments
     OR p_first_deduction_month <> date_trunc('month', p_first_deduction_month)::date
     OR p_first_deduction_month < earliest_month THEN
    RAISE EXCEPTION 'Advance request amount, signature, or schedule is invalid.' USING ERRCODE = '23514';
  END IF;
  hash_value := encode(digest(payload::text, 'sha256'), 'hex');
  INSERT INTO public.advance_commands (organization_id, idempotency_key, action, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'submit', hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.advance_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'submit' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for another advance command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.advance_requests WHERE organization_id = p_org_id AND id = command_row.advance_request_id; RETURN; END IF;
  INSERT INTO public.advance_requests (organization_id, employee_id, requested_amount, status, reason,
    employee_signature_data, employee_signed_at, installment_count, first_deduction_month, version, updated_at)
  VALUES (p_org_id, p_employee_id, round(p_requested_amount, 2), 'pending', NULLIF(btrim(p_reason), ''),
    p_signature_data, now(), p_installment_count, p_first_deduction_month, 0, now())
  RETURNING * INTO request_row;
  event_payload := jsonb_build_object('event_type', 'advance.request_submitted',
    'advance_request_id', request_row.id, 'employee_id', request_row.employee_id,
    'requested_amount', request_row.requested_amount, 'installment_count', request_row.installment_count,
    'first_deduction_month', request_row.first_deduction_month, 'version', request_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'advance', request_row.id::text || ':submitted:1', 1,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id,
    p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'advance.request_submitted', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, 'employee', 'advance.request_submitted',
    'advance_request', request_row.id::text, 'success', 201,
    jsonb_build_object('requested_amount', request_row.requested_amount, 'installment_count', request_row.installment_count, 'first_deduction_month', request_row.first_deduction_month));
  UPDATE public.advance_commands SET advance_request_id = request_row.id, status = 'completed', completed_at = now(),
    result = jsonb_build_object('advance_request_id', request_row.id, 'status', request_row.status)
  WHERE id = command_row.id;
  RETURN NEXT request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_advance_request(
  p_org_id uuid, p_advance_request_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer, p_decision text,
  p_approved_amount numeric, p_hr_notes text
)
RETURNS SETOF public.advance_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.advance_commands%ROWTYPE;
  request_row public.advance_requests%ROWTYPE;
  policy_row public.advance_policies%ROWTYPE;
  employee_salary numeric(14,2);
  active_count integer;
  active_outstanding numeric(14,2);
  total_cents bigint;
  base_cents bigint;
  remainder_cents bigint;
  seq integer;
  event_id uuid;
  event_payload jsonb;
  actor_role_value text;
  payload jsonb := jsonb_build_object('advance_request_id', p_advance_request_id, 'expected_version', p_expected_version,
    'decision', p_decision, 'approved_amount', p_approved_amount, 'hr_notes', COALESCE(p_hr_notes, ''));
  hash_value text := encode(digest(payload::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('approved', 'partial_approved', 'rejected') THEN RAISE EXCEPTION 'Unsupported advance decision.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.advance_commands (organization_id, idempotency_key, action, advance_request_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'review', p_advance_request_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.advance_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'review' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for another advance command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.advance_requests WHERE organization_id = p_org_id AND id = p_advance_request_id; RETURN; END IF;
  SELECT * INTO request_row FROM public.advance_requests WHERE organization_id = p_org_id AND id = p_advance_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Advance request was not found.' USING ERRCODE = 'P0002'; END IF;
  IF request_row.status <> 'pending' OR request_row.version <> p_expected_version THEN RAISE EXCEPTION 'Advance request state or version conflict.' USING ERRCODE = '40001'; END IF;
  IF p_decision = 'rejected' THEN
    UPDATE public.advance_requests SET status = 'rejected', approved_amount = NULL, outstanding_amount = 0,
      hr_notes = NULLIF(btrim(p_hr_notes), ''), reviewed_by = p_actor_user_id, reviewed_at = now(),
      version = version + 1, updated_at = now() WHERE id = request_row.id RETURNING * INTO request_row;
  ELSE
    IF round(p_approved_amount, 2) <= 0 OR p_approved_amount <> round(p_approved_amount, 2)
       OR p_approved_amount > request_row.requested_amount
       OR (p_decision = 'approved' AND p_approved_amount <> request_row.requested_amount)
       OR (p_decision = 'partial_approved' AND p_approved_amount >= request_row.requested_amount) THEN
      RAISE EXCEPTION 'Approved advance amount is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO policy_row FROM public.advance_policies WHERE organization_id = p_org_id FOR UPDATE;
    SELECT base_salary INTO employee_salary FROM public.employees WHERE org_id = p_org_id AND id = request_row.employee_id FOR UPDATE;
    SELECT count(*)::integer, COALESCE(sum(
      CASE WHEN status IN ('approved', 'partial_approved') THEN approved_amount ELSE outstanding_amount END
    ), 0) INTO active_count, active_outstanding
    FROM public.advance_requests WHERE organization_id = p_org_id AND employee_id = request_row.employee_id
      AND id <> request_row.id AND status IN ('approved', 'partial_approved', 'disbursed', 'repaying');
    IF (NOT policy_row.allow_stacking AND active_count > 0) OR active_count >= policy_row.max_active_advances
       OR active_outstanding + p_approved_amount > COALESCE(employee_salary, 0) * policy_row.max_outstanding_salary_multiple THEN
      RAISE EXCEPTION 'Advance policy cap or stacking rule would be exceeded.' USING ERRCODE = '23514';
    END IF;
    total_cents := round(p_approved_amount * 100)::bigint;
    base_cents := total_cents / request_row.installment_count;
    remainder_cents := total_cents % request_row.installment_count;
    IF base_cents = 0 THEN RAISE EXCEPTION 'Approved amount is too small for the installment count.' USING ERRCODE = '23514'; END IF;
    FOR seq IN 1..request_row.installment_count LOOP
      INSERT INTO public.advance_installments (organization_id, advance_request_id, employee_id,
        sequence_no, due_month, amount)
      VALUES (p_org_id, request_row.id, request_row.employee_id, seq,
        (request_row.first_deduction_month + ((seq - 1) || ' months')::interval)::date,
        (base_cents + CASE WHEN seq <= remainder_cents THEN 1 ELSE 0 END)::numeric / 100);
    END LOOP;
    UPDATE public.advance_requests SET status = p_decision, approved_amount = round(p_approved_amount, 2),
      outstanding_amount = 0, hr_notes = NULLIF(btrim(p_hr_notes), ''), reviewed_by = p_actor_user_id,
      reviewed_at = now(), version = version + 1, updated_at = now()
    WHERE id = request_row.id RETURNING * INTO request_row;
  END IF;
  event_payload := jsonb_build_object('event_type', 'advance.request_' || p_decision,
    'advance_request_id', request_row.id, 'employee_id', request_row.employee_id,
    'requested_amount', request_row.requested_amount, 'approved_amount', request_row.approved_amount,
    'installment_count', request_row.installment_count, 'version', request_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'advance', request_row.id::text || ':' || p_decision || ':' || request_row.version::text,
    request_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'advance.request_' || p_decision, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'advance.request_' || p_decision,
    'advance_request', request_row.id::text, 'success', 200,
    jsonb_build_object('approved_amount', request_row.approved_amount, 'version', request_row.version));
  UPDATE public.advance_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('advance_request_id', request_row.id, 'status', request_row.status, 'version', request_row.version)
  WHERE id = command_row.id;
  RETURN NEXT request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.disburse_advance_request(
  p_org_id uuid, p_advance_request_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer, p_payment_date date,
  p_account_id uuid, p_method text, p_reference_no text
)
RETURNS SETOF public.advance_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.advance_commands%ROWTYPE;
  request_row public.advance_requests%ROWTYPE;
  payment_row public.accounting_payments%ROWTYPE;
  actor_role_value text;
  event_id uuid;
  event_payload jsonb;
  payment_date_value date := COALESCE(p_payment_date, public.organization_business_date(p_org_id, now()));
  payload jsonb := jsonb_build_object('advance_request_id', p_advance_request_id, 'expected_version', p_expected_version,
    'payment_date', payment_date_value, 'account_id', p_account_id, 'method', COALESCE(p_method, ''), 'reference_no', COALESCE(p_reference_no, ''));
  hash_value text := encode(digest(payload::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.advance_commands (organization_id, idempotency_key, action, advance_request_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'disburse', p_advance_request_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.advance_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'disburse' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for another advance command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.advance_requests WHERE organization_id = p_org_id AND id = p_advance_request_id; RETURN; END IF;
  SELECT * INTO request_row FROM public.advance_requests WHERE organization_id = p_org_id AND id = p_advance_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Advance request was not found.' USING ERRCODE = 'P0002'; END IF;
  IF request_row.status NOT IN ('approved', 'partial_approved') OR request_row.version <> p_expected_version
     OR request_row.payment_id IS NOT NULL OR request_row.approved_amount IS NULL THEN
    RAISE EXCEPTION 'Advance request is not ready for disbursement.' USING ERRCODE = '40001';
  END IF;
  IF (SELECT count(*) FROM public.advance_installments WHERE advance_request_id = request_row.id) <> request_row.installment_count
     OR (SELECT COALESCE(sum(amount), 0) FROM public.advance_installments WHERE advance_request_id = request_row.id) <> request_row.approved_amount THEN
    RAISE EXCEPTION 'Advance installment schedule is incomplete.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO payment_row FROM public.accounting_save_payment(p_org_id, p_actor_user_id,
    public.accounting_child_command_id(p_command_id, 'advance-payment'), p_request_id, NULL, 0, true,
    jsonb_build_object('paymentDate', payment_date_value, 'type', 'employee_advance', 'direction', 'outbound',
      'amount', request_row.approved_amount, 'accountId', p_account_id, 'employeeId', request_row.employee_id,
      'advanceRequestId', request_row.id, 'description', 'Employee advance ' || request_row.id::text,
      'method', NULLIF(btrim(p_method), ''), 'referenceNo', NULLIF(btrim(p_reference_no), '')));
  UPDATE public.advance_requests SET status = 'disbursed', outstanding_amount = approved_amount,
    payment_id = payment_row.id, journal_entry_id = payment_row.journal_entry_id,
    disbursed_by = p_actor_user_id, disbursed_at = now(), version = version + 1, updated_at = now()
  WHERE id = request_row.id RETURNING * INTO request_row;
  INSERT INTO public.financial_balances (org_id, employee_id, balance_type, amount, status, description, advance_request_id)
  VALUES (p_org_id, request_row.employee_id, 'advance_payment', request_row.outstanding_amount, 'unpaid',
    'Disbursed advance request ' || request_row.id::text, request_row.id)
  ON CONFLICT (org_id, advance_request_id) WHERE advance_request_id IS NOT NULL DO UPDATE SET
    amount = EXCLUDED.amount, status = EXCLUDED.status, updated_at = now();
  event_payload := jsonb_build_object('event_type', 'advance.request_disbursed',
    'advance_request_id', request_row.id, 'employee_id', request_row.employee_id,
    'amount', request_row.approved_amount, 'payment_id', payment_row.id,
    'journal_entry_id', payment_row.journal_entry_id, 'version', request_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'advance', request_row.id::text || ':disbursed:' || request_row.version::text,
    request_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'advance.request_disbursed', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'advance.request_disbursed',
    'advance_request', request_row.id::text, 'success', 200,
    jsonb_build_object('amount', request_row.approved_amount, 'payment_id', payment_row.id, 'journal_entry_id', payment_row.journal_entry_id, 'version', request_row.version));
  UPDATE public.advance_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('advance_request_id', request_row.id, 'status', request_row.status,
      'payment_id', payment_row.id, 'version', request_row.version)
  WHERE id = command_row.id;
  RETURN NEXT request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_advance_installment_to_payslip()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  installment_ids uuid[];
  old_installment_ids uuid[];
  matched_count integer;
  matched_amount numeric(14,2);
  all_eligible boolean;
BEGIN
  SELECT COALESCE(array_agg(value::uuid ORDER BY value), ARRAY[]::uuid[]) INTO installment_ids
  FROM jsonb_array_elements_text(COALESCE(NEW.input_snapshot->'advanceInstallmentIds', '[]'::jsonb));
  IF cardinality(installment_ids) = 0 AND NULLIF(NEW.input_snapshot->>'advanceInstallmentId', '') IS NOT NULL THEN
    installment_ids := ARRAY[(NEW.input_snapshot->>'advanceInstallmentId')::uuid];
  END IF;
  IF NEW.advance_deduction = 0 AND cardinality(installment_ids) = 0 THEN RETURN NEW; END IF;
  IF NEW.advance_deduction <= 0 OR cardinality(installment_ids) = 0 THEN
    RAISE EXCEPTION 'Advance deduction requires its installment identifiers.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.advance_deduction > 0 THEN
    SELECT COALESCE(array_agg(value::uuid ORDER BY value), ARRAY[]::uuid[]) INTO old_installment_ids
    FROM jsonb_array_elements_text(COALESCE(OLD.input_snapshot->'advanceInstallmentIds', '[]'::jsonb));
    IF cardinality(old_installment_ids) = 0 AND NULLIF(OLD.input_snapshot->>'advanceInstallmentId', '') IS NOT NULL THEN
      old_installment_ids := ARRAY[(OLD.input_snapshot->>'advanceInstallmentId')::uuid];
    END IF;
    IF old_installment_ids IS DISTINCT FROM installment_ids THEN
      RAISE EXCEPTION 'A payroll calculation cannot switch its allocated advance installments.' USING ERRCODE = '55000';
    END IF;
  END IF;

  PERFORM 1 FROM public.advance_installments WHERE id = ANY(installment_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), COALESCE(sum(installment.amount), 0), bool_and(
      installment.organization_id = NEW.org_id
      AND installment.employee_id = NEW.employee_id
      AND installment.due_month = NEW.month
      AND installment.status IN ('scheduled', 'allocated')
      AND (installment.status <> 'allocated' OR installment.payslip_id = NEW.id)
      AND request.status IN ('disbursed', 'repaying')
    )
  INTO matched_count, matched_amount, all_eligible
  FROM public.advance_installments installment
  JOIN public.advance_requests request ON request.id = installment.advance_request_id
  WHERE installment.id = ANY(installment_ids);
  IF matched_count <> cardinality(installment_ids) OR matched_amount <> NEW.advance_deduction OR NOT COALESCE(all_eligible, false) THEN
    RAISE EXCEPTION 'Advance installments are not eligible for this payslip.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.advance_installments SET status = 'allocated', payroll_run_id = NEW.payroll_run_id,
    payslip_id = NEW.id, updated_at = now() WHERE id = ANY(installment_ids);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS allocate_advance_installment_trigger ON public.payslips;
CREATE TRIGGER allocate_advance_installment_trigger AFTER INSERT OR UPDATE OF input_snapshot, advance_deduction ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.allocate_advance_installment_to_payslip();

CREATE OR REPLACE FUNCTION public.consume_advance_installments_for_run()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  advance_id uuid;
  remaining numeric(14,2);
  affected_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT advance_request_id) INTO affected_ids
  FROM public.advance_installments WHERE payroll_run_id = NEW.id;
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    UPDATE public.advance_installments SET status = 'consumed', consumed_at = now(), updated_at = now()
    WHERE payroll_run_id = NEW.id AND status = 'allocated';
  ELSIF OLD.status = 'approved' AND NEW.status = 'void' THEN
    UPDATE public.advance_installments SET status = 'scheduled', consumed_at = NULL,
      payroll_run_id = NULL, payslip_id = NULL, updated_at = now()
    WHERE payroll_run_id = NEW.id AND status = 'consumed';
  ELSE
    RETURN NEW;
  END IF;
  FOREACH advance_id IN ARRAY COALESCE(affected_ids, ARRAY[]::uuid[]) LOOP
    SELECT GREATEST(request.approved_amount - COALESCE(sum(installment.amount) FILTER (WHERE installment.status = 'consumed'), 0), 0)
      INTO remaining
    FROM public.advance_requests request
    LEFT JOIN public.advance_installments installment ON installment.advance_request_id = request.id
    WHERE request.id = advance_id GROUP BY request.approved_amount;
    UPDATE public.advance_requests SET outstanding_amount = remaining,
      status = CASE WHEN remaining = 0 THEN 'repaid' ELSE 'repaying' END,
      version = version + 1, updated_at = now() WHERE id = advance_id;
    UPDATE public.financial_balances SET amount = remaining,
      status = CASE WHEN remaining = 0 THEN 'paid' ELSE 'unpaid' END, updated_at = now()
    WHERE advance_request_id = advance_id;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS consume_advance_installments_trigger ON public.payroll_runs;
CREATE TRIGGER consume_advance_installments_trigger AFTER UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.consume_advance_installments_for_run();

CREATE OR REPLACE FUNCTION public.block_offboarding_with_advance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lifecycle_status = 'offboarded' AND OLD.lifecycle_status IS DISTINCT FROM 'offboarded'
     AND EXISTS (SELECT 1 FROM public.advance_requests WHERE organization_id = NEW.org_id
       AND employee_id = NEW.id AND (status = 'pending' OR outstanding_amount > 0 OR status IN ('approved', 'partial_approved'))) THEN
    RAISE EXCEPTION 'Outstanding advance requests must be settled before offboarding.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS block_offboarding_with_advance_trigger ON public.employees;
CREATE TRIGGER block_offboarding_with_advance_trigger BEFORE UPDATE OF lifecycle_status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.block_offboarding_with_advance();

REVOKE ALL ON FUNCTION public.submit_advance_request(uuid, uuid, uuid, uuid, uuid, numeric, text, text, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_advance_request(uuid, uuid, uuid, uuid, uuid, integer, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disburse_advance_request(uuid, uuid, uuid, uuid, uuid, integer, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_advance_request(uuid, uuid, uuid, uuid, uuid, numeric, text, text, integer, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_advance_request(uuid, uuid, uuid, uuid, uuid, integer, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.disburse_advance_request(uuid, uuid, uuid, uuid, uuid, integer, date, uuid, text, text) TO service_role;

COMMENT ON TABLE public.advance_installments IS
  'Immutable approved advance schedule; each row may be allocated to and consumed by exactly one payslip.';
