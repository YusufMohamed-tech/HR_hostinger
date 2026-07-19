-- Authoritative employee lifecycle: idempotent onboarding/finalization,
-- identity linking, offboarding, and historical-record preservation.

CREATE TABLE IF NOT EXISTS public.employee_lifecycle_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('begin_onboarding', 'finalize_onboarding', 'link_identity', 'offboard')),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  source_type text,
  source_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, idempotency_key)
);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS offboarding_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS offboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS offboarding_reason text,
  ADD COLUMN IF NOT EXISTS offboarded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auth_access_revoked_at timestamptz;

UPDATE public.employees
SET
  lifecycle_status = CASE
    WHEN lower(COALESCE(status, '')) = 'inactive' THEN 'offboarded'
    ELSE 'active'
  END,
  onboarded_at = CASE
    WHEN lower(COALESCE(status, '')) <> 'inactive' THEN COALESCE(onboarded_at, created_at)
    ELSE onboarded_at
  END,
  offboarded_at = CASE
    WHEN lower(COALESCE(status, '')) = 'inactive' THEN COALESCE(offboarded_at, updated_at, created_at)
    ELSE offboarded_at
  END
WHERE lifecycle_status IS NULL
   OR (lifecycle_status = 'active' AND lower(COALESCE(status, '')) = 'inactive')
   OR (lifecycle_status = 'active' AND onboarded_at IS NULL);

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_lifecycle_status_check;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_lifecycle_status_check
  CHECK (lifecycle_status IN ('onboarding', 'active', 'offboarding', 'offboarded', 'archived'));

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_lifecycle_version_check;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_lifecycle_version_check CHECK (lifecycle_version > 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.employees
    WHERE user_id IS NOT NULL
    GROUP BY org_id, user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate employee identities must be resolved before applying the employee lifecycle migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.employees
    WHERE email IS NOT NULL
      AND btrim(email) <> ''
      AND lifecycle_status <> 'archived'
    GROUP BY org_id, lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active employee emails must be resolved before applying the employee lifecycle migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS employees_org_user_identity_idx
  ON public.employees(org_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_org_active_email_idx
  ON public.employees(org_id, lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '' AND lifecycle_status <> 'archived';
CREATE INDEX IF NOT EXISTS employees_org_lifecycle_idx
  ON public.employees(org_id, lifecycle_status, status, full_name);
CREATE INDEX IF NOT EXISTS employee_lifecycle_commands_org_created_idx
  ON public.employee_lifecycle_commands(org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS employee_lifecycle_source_hire_idx
  ON public.employee_lifecycle_commands(org_id, source_type, source_id, action)
  WHERE source_id IS NOT NULL AND action = 'begin_onboarding';

ALTER TABLE public.employee_lifecycle_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_lifecycle_commands_select ON public.employee_lifecycle_commands;
CREATE POLICY employee_lifecycle_commands_select ON public.employee_lifecycle_commands
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND (public.can_manage_people() OR public.can_manage_recruitment()))
  );

-- Employees are historical master records. Normal application flows may never
-- hard-delete them; legally authorized erasure is deliberately a separate DBA process.
DROP POLICY IF EXISTS launch_delete_employees ON public.employees;
DROP POLICY IF EXISTS launch_insert_employees ON public.employees;
DROP POLICY IF EXISTS launch_update_employees ON public.employees;
DROP POLICY IF EXISTS org_delete_employees ON public.employees;
DROP POLICY IF EXISTS org_insert_employees ON public.employees;
DROP POLICY IF EXISTS org_update_employees ON public.employees;
DROP POLICY IF EXISTS employees_delete ON public.employees;

CREATE OR REPLACE FUNCTION public.bump_employee_lifecycle_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lifecycle_version = OLD.lifecycle_version THEN
    NEW.lifecycle_version := OLD.lifecycle_version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_lifecycle_version_trigger ON public.employees;
CREATE TRIGGER employee_lifecycle_version_trigger
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.bump_employee_lifecycle_version();

CREATE OR REPLACE FUNCTION public.begin_employee_onboarding(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_employee jsonb,
  p_source_type text DEFAULT 'hr',
  p_source_id uuid DEFAULT NULL
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_hash text := encode(digest(COALESCE(p_employee, '{}'::jsonb)::text, 'sha256'), 'hex');
  accrual_start date;
  accrued_days numeric := 0;
  initial_balance numeric := 0;
  balance_id uuid;
  event_id uuid;
  event_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, and command id are required.' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_employee->>'full_name', ''))) < 2 THEN
    RAISE EXCEPTION 'Employee full name is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id
      AND (
        role::text IN ('admin', 'hr_admin')
        OR (role::text = 'hr_recruitment' AND p_source_type = 'recruitment')
        OR (role::text = 'sales_manager' AND p_source_type = 'sales')
      )
  ) THEN
    RAISE EXCEPTION 'Actor cannot onboard employees in this organization.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.employee_lifecycle_commands (
    org_id, idempotency_key, action, source_type, source_id, payload_hash, actor_user_id
  ) VALUES (
    p_org_id, p_command_id, 'begin_onboarding', NULLIF(btrim(p_source_type), ''), p_source_id, input_hash, p_actor_user_id
  )
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;

  IF command_row.action <> 'begin_onboarding' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different employee command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' AND command_row.employee_id IS NOT NULL THEN
    RETURN QUERY SELECT * FROM public.employees WHERE id = command_row.employee_id AND org_id = p_org_id;
    RETURN;
  END IF;

  IF p_source_id IS NOT NULL THEN
    SELECT * INTO employee_row
    FROM public.employees
    WHERE id = (
      SELECT employee_id
      FROM public.employee_lifecycle_commands
      WHERE org_id = p_org_id
        AND source_type = NULLIF(btrim(p_source_type), '')
        AND source_id = p_source_id
        AND action = 'begin_onboarding'
        AND employee_id IS NOT NULL
      ORDER BY created_at
      LIMIT 1
    );
    IF employee_row.id IS NOT NULL THEN
      UPDATE public.employee_lifecycle_commands
      SET employee_id = employee_row.id, status = 'completed', result = jsonb_build_object('employee_id', employee_row.id), completed_at = now()
      WHERE id = command_row.id;
      RETURN NEXT employee_row;
      RETURN;
    END IF;
  END IF;

  IF NULLIF(btrim(COALESCE(p_employee->>'email', '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.employees
       WHERE org_id = p_org_id
         AND lower(btrim(email)) = lower(btrim(p_employee->>'email'))
         AND lifecycle_status <> 'archived'
     ) THEN
    RAISE EXCEPTION 'An employee with this email already exists in the organization.' USING ERRCODE = '23505';
  END IF;

  IF NULLIF(p_employee->>'department_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = (p_employee->>'department_id')::uuid AND org_id = p_org_id
  ) THEN RAISE EXCEPTION 'Department is outside the organization.' USING ERRCODE = '23503'; END IF;
  IF NULLIF(p_employee->>'manager_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees WHERE id = (p_employee->>'manager_id')::uuid AND org_id = p_org_id
  ) THEN RAISE EXCEPTION 'Manager is outside the organization.' USING ERRCODE = '23503'; END IF;
  IF NULLIF(p_employee->>'location_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations WHERE id = (p_employee->>'location_id')::uuid AND org_id = p_org_id
  ) THEN RAISE EXCEPTION 'Location is outside the organization.' USING ERRCODE = '23503'; END IF;
  IF NULLIF(p_employee->>'company_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_companies WHERE id = (p_employee->>'company_id')::uuid AND organization_id = p_org_id
  ) THEN RAISE EXCEPTION 'Company is outside the organization.' USING ERRCODE = '23503'; END IF;
  IF NULLIF(p_employee->>'project_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_companies WHERE id = (p_employee->>'project_id')::uuid AND organization_id = p_org_id
  ) THEN RAISE EXCEPTION 'Project is outside the organization.' USING ERRCODE = '23503'; END IF;
  IF NULLIF(p_employee->>'deduction_rule_group_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.deduction_rule_groups WHERE id = (p_employee->>'deduction_rule_group_id')::uuid AND org_id = p_org_id
  ) THEN RAISE EXCEPTION 'Deduction group is outside the organization.' USING ERRCODE = '23503'; END IF;

  INSERT INTO public.employees (
    org_id, employee_code, full_name, full_name_ar, full_name_en, email, phone, address,
    work_city, national_address_code, emergency_contact_name, emergency_contact_phone,
    national_id, date_of_birth, date_of_birth_hijri, gender, hiring_date, department_id,
    job_title, manager_id, location_id, company_id, project_id, city, province,
    employment_type, status, base_salary, bonus, deductions, deduction_rule_group_id,
    leave_balance_manual_adjustment, leave_accrual_start_date, payment_method, bank_account,
    bank_account_name, bank_name, iban, education_level, lifecycle_status
  ) VALUES (
    p_org_id,
    NULLIF(btrim(p_employee->>'employee_code'), ''),
    btrim(p_employee->>'full_name'),
    NULLIF(btrim(p_employee->>'full_name_ar'), ''), NULLIF(btrim(p_employee->>'full_name_en'), ''),
    NULLIF(lower(btrim(p_employee->>'email')), ''), NULLIF(btrim(p_employee->>'phone'), ''), NULLIF(btrim(p_employee->>'address'), ''),
    NULLIF(btrim(p_employee->>'work_city'), ''), NULLIF(btrim(p_employee->>'national_address_code'), ''),
    NULLIF(btrim(p_employee->>'emergency_contact_name'), ''), NULLIF(btrim(p_employee->>'emergency_contact_phone'), ''),
    NULLIF(btrim(p_employee->>'national_id'), ''), NULLIF(p_employee->>'date_of_birth', '')::date,
    NULLIF(btrim(p_employee->>'date_of_birth_hijri'), ''), NULLIF(btrim(p_employee->>'gender'), ''),
    NULLIF(p_employee->>'hiring_date', '')::date, NULLIF(p_employee->>'department_id', '')::uuid,
    NULLIF(btrim(p_employee->>'job_title'), ''), NULLIF(p_employee->>'manager_id', '')::uuid,
    NULLIF(p_employee->>'location_id', '')::uuid, NULLIF(p_employee->>'company_id', '')::uuid,
    NULLIF(p_employee->>'project_id', '')::uuid, NULLIF(btrim(p_employee->>'city'), ''), NULLIF(btrim(p_employee->>'province'), ''),
    COALESCE(NULLIF(p_employee->>'employment_type', ''), 'full_time')::public.employment_type,
    CASE WHEN p_employee->>'status' IN ('Active', 'Inactive', 'On Leave') THEN p_employee->>'status' ELSE 'Active' END,
    COALESCE(NULLIF(p_employee->>'base_salary', '')::numeric, 0),
    COALESCE(NULLIF(p_employee->>'bonus', '')::numeric, 0),
    COALESCE(NULLIF(p_employee->>'deductions', '')::numeric, 0),
    NULLIF(p_employee->>'deduction_rule_group_id', '')::uuid,
    COALESCE(NULLIF(p_employee->>'leave_balance_manual_adjustment', '')::numeric, 0),
    COALESCE(NULLIF(p_employee->>'leave_accrual_start_date', '')::date, NULLIF(p_employee->>'hiring_date', '')::date, current_date),
    NULLIF(btrim(p_employee->>'payment_method'), ''), NULLIF(btrim(p_employee->>'bank_account'), ''),
    NULLIF(btrim(p_employee->>'bank_account_name'), ''), NULLIF(btrim(p_employee->>'bank_name'), ''),
    NULLIF(btrim(p_employee->>'iban'), ''), NULLIF(btrim(p_employee->>'education_level'), ''), 'onboarding'
  )
  RETURNING * INTO employee_row;

  accrual_start := COALESCE(employee_row.leave_accrual_start_date, employee_row.hiring_date, current_date);
  accrued_days := round((GREATEST(0, extract(year FROM age(current_date, accrual_start))::integer * 12
    + extract(month FROM age(current_date, accrual_start))::integer) * 1.75)::numeric, 2);
  initial_balance := round((accrued_days + COALESCE(employee_row.leave_balance_manual_adjustment, 0))::numeric, 2);

  INSERT INTO public.leave_balances (
    org_id, employee_id, sick_remaining, vacation_remaining, emergency_remaining,
    accrual_start_date, vacation_accrued_days, manual_adjustment, last_accrual_calculated_at
  ) VALUES (
    p_org_id, employee_row.id, 0, initial_balance, 0,
    accrual_start, accrued_days, COALESCE(employee_row.leave_balance_manual_adjustment, 0), now()
  )
  ON CONFLICT (org_id, employee_id) DO UPDATE
    SET accrual_start_date = EXCLUDED.accrual_start_date,
        updated_at = now()
  RETURNING id INTO balance_id;

  INSERT INTO public.leave_balance_transactions (
    org_id, employee_id, leave_balance_id, leave_type, transaction_type, amount,
    balance_before, balance_after, reason, created_by
  ) VALUES (
    p_org_id, employee_row.id, balance_id, 'vacation', 'initial', initial_balance,
    0, initial_balance, 'Initial annual leave balance', p_actor_user_id
  );

  INSERT INTO public.employee_career_events (
    employee_id, event_type, previous_value, new_value, effective_date, notes, created_by
  ) VALUES (
    employee_row.id,
    CASE WHEN employee_row.employment_type = 'intern' THEN 'hired_as_trainee' ELSE 'hired' END,
    NULL,
    jsonb_build_object('lifecycle_status', 'onboarding', 'job_title', employee_row.job_title, 'department_id', employee_row.department_id),
    COALESCE(employee_row.hiring_date, current_date),
    'Employee onboarding started',
    p_actor_user_id
  );

  event_payload := jsonb_build_object(
    'event_type', 'employee.onboarding_started', 'employee_id', employee_row.id,
    'source_type', COALESCE(NULLIF(btrim(p_source_type), ''), 'hr'), 'source_id', p_source_id
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'employee', 'onboarding:' || employee_row.id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'employee.onboarding_started', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));

  IF p_source_type = 'recruitment' AND p_source_id IS NOT NULL THEN
    UPDATE public.job_applications
    SET status = 'hired',
        stage_history = COALESCE(stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'stage', 'hired', 'changed_by', p_actor_user_id, 'changed_at', now(),
          'note', 'Candidate converted to employee onboarding'
        )),
        updated_at = now()
    WHERE id = p_source_id
      AND org_id = p_org_id
      AND status IN ('offer', 'hired');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recruitment application must be in the offer stage before hiring.' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.employee_lifecycle_commands
  SET employee_id = employee_row.id,
      status = 'completed',
      result = jsonb_build_object('employee_id', employee_row.id, 'lifecycle_status', employee_row.lifecycle_status),
      completed_at = now()
  WHERE id = command_row.id;

  RETURN NEXT employee_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_employee_onboarding(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_payload jsonb := jsonb_build_object('employee_id', p_employee_id);
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
  event_id uuid;
  event_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin', 'sales_manager')
  ) THEN RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.employee_lifecycle_commands (org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'finalize_onboarding', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'finalize_onboarding' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different employee command.' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO employee_row FROM public.employees WHERE id = p_employee_id AND org_id = p_org_id FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  IF employee_row.lifecycle_status IN ('offboarding', 'offboarded', 'archived') THEN
    RAISE EXCEPTION 'An offboarded or archived employee cannot be activated.' USING ERRCODE = '23514';
  END IF;

  IF employee_row.hiring_date IS NULL THEN
    RAISE EXCEPTION 'Hiring date is required before employee activation.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.personnel_files
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND category = 'official'
  ) THEN
    RAISE EXCEPTION 'A registered official personnel file is required before employee activation.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_contracts
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active employee contract is required before activation.' USING ERRCODE = '23514';
  END IF;
  IF employee_row.employment_type <> 'intern' AND NOT EXISTS (
    SELECT 1 FROM public.social_insurance
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active social-insurance registration is required before employee activation.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_locations
    WHERE org_id = p_org_id AND employee_id = p_employee_id
      AND assigned_from <= current_date AND (assigned_to IS NULL OR assigned_to >= current_date)
  ) THEN
    RAISE EXCEPTION 'At least one active work location is required before employee activation.' USING ERRCODE = '23514';
  END IF;

  IF employee_row.lifecycle_status <> 'active' THEN
    UPDATE public.employees
    SET lifecycle_status = 'active', status = 'Active', onboarded_at = COALESCE(onboarded_at, now()),
        lifecycle_version = lifecycle_version + 1, updated_at = now()
    WHERE id = p_employee_id AND org_id = p_org_id
    RETURNING * INTO employee_row;

    IF employee_row.user_id IS NOT NULL THEN
      UPDATE public.profiles
      SET account_status = 'Active', updated_at = now()
      WHERE user_id = employee_row.user_id AND org_id = p_org_id;
    END IF;

    event_payload := jsonb_build_object('event_type', 'employee.onboarded', 'employee_id', employee_row.id);
    INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status, actor_user_id, occurred_at, processed_at)
    VALUES (p_org_id, 'employee', 'onboarded:' || employee_row.id::text, event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_actor_user_id, now(), now())
    ON CONFLICT (org_id, source_type, business_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO event_id;
    INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
    VALUES (p_org_id, event_id, 'employee.onboarded', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'))
    ON CONFLICT (business_event_id, topic) DO NOTHING;
  END IF;

  UPDATE public.employee_lifecycle_commands
  SET employee_id = employee_row.id, status = 'completed',
      result = jsonb_build_object('employee_id', employee_row.id, 'lifecycle_status', employee_row.lifecycle_status), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT employee_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_employee_identity(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role public.org_role
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_payload jsonb := jsonb_build_object('employee_id', p_employee_id, 'user_id', p_user_id, 'email', lower(btrim(p_email)), 'role', p_role);
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id
      AND (
        role::text IN ('admin', 'hr_admin')
        OR (role::text = 'sales_manager' AND p_role::text IN ('sales', 'sales_manager'))
      )
  ) THEN RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;
  IF p_role::text NOT IN ('employee', 'training_manager', 'promoter', 'finance_manager', 'accountant', 'finance_viewer', 'sales', 'sales_manager') THEN
    RAISE EXCEPTION 'Unsupported employee account role.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_lifecycle_commands (org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'link_identity', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'link_identity' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different employee command.' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO employee_row FROM public.employees WHERE id = p_employee_id AND org_id = p_org_id FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  IF employee_row.lifecycle_status IN ('offboarding', 'offboarded', 'archived') THEN
    RAISE EXCEPTION 'Identity cannot be linked to an offboarded employee.' USING ERRCODE = '23514';
  END IF;
  IF employee_row.user_id IS NOT NULL AND employee_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Employee already has a different login identity.' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE user_id = p_user_id AND org_id <> p_org_id) THEN
    RAISE EXCEPTION 'Login identity belongs to another organization.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.profiles (user_id, org_id, full_name, email, phone, title, account_status)
  VALUES (p_user_id, p_org_id, p_full_name, lower(btrim(p_email)), employee_row.phone, COALESCE(employee_row.job_title, 'Employee'), 'Pending')
  ON CONFLICT (user_id) DO UPDATE SET
    org_id = EXCLUDED.org_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    phone = EXCLUDED.phone, title = EXCLUDED.title, account_status = 'Pending', updated_at = now();

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (p_org_id, p_user_id, p_role)
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.employees
  SET user_id = p_user_id, email = lower(btrim(p_email)), updated_at = now(), lifecycle_version = lifecycle_version + 1
  WHERE id = p_employee_id AND org_id = p_org_id
  RETURNING * INTO employee_row;

  UPDATE public.employee_lifecycle_commands
  SET status = 'completed', result = jsonb_build_object('employee_id', employee_row.id, 'user_id', p_user_id), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT employee_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_employee_locations(
  p_org_id uuid,
  p_employee_id uuid,
  p_location_ids uuid[],
  p_primary_location_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invalid_count integer;
  selected_primary uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO invalid_count
  FROM unnest(COALESCE(p_location_ids, ARRAY[]::uuid[])) location_id
  WHERE NOT EXISTS (SELECT 1 FROM public.locations WHERE id = location_id AND org_id = p_org_id);
  IF invalid_count > 0 THEN RAISE EXCEPTION 'A location is outside the organization.' USING ERRCODE = '23503'; END IF;

  selected_primary := CASE
    WHEN p_primary_location_id = ANY(COALESCE(p_location_ids, ARRAY[]::uuid[])) THEN p_primary_location_id
    ELSE (COALESCE(p_location_ids, ARRAY[]::uuid[]))[1]
  END;

  DELETE FROM public.employee_locations WHERE org_id = p_org_id AND employee_id = p_employee_id;
  INSERT INTO public.employee_locations (org_id, employee_id, location_id, is_primary, assigned_from)
  SELECT p_org_id, p_employee_id, location_id, location_id = selected_primary, current_date
  FROM (SELECT DISTINCT unnest(COALESCE(p_location_ids, ARRAY[]::uuid[])) AS location_id) selected;
  UPDATE public.employees SET location_id = selected_primary, updated_at = now(), lifecycle_version = lifecycle_version + 1
  WHERE id = p_employee_id AND org_id = p_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.offboard_employee(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_effective_date date,
  p_reason text,
  p_termination_type text DEFAULT 'termination'
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_payload jsonb := jsonb_build_object('employee_id', p_employee_id, 'effective_date', p_effective_date, 'reason', btrim(p_reason), 'termination_type', p_termination_type);
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
  prior_role text;
  event_id uuid;
  event_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin')
  ) THEN RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;
  IF p_effective_date IS NULL OR length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Effective date and offboarding reason are required.' USING ERRCODE = '22023';
  END IF;
  IF p_termination_type NOT IN ('resignation', 'termination', 'end_of_contract', 'retirement', 'other') THEN
    RAISE EXCEPTION 'Unsupported termination type.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_lifecycle_commands (org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'offboard', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'offboard' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different employee command.' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO employee_row FROM public.employees WHERE id = p_employee_id AND org_id = p_org_id FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  IF employee_row.lifecycle_status = 'archived' THEN RAISE EXCEPTION 'Archived employee cannot be offboarded.' USING ERRCODE = '23514'; END IF;
  IF employee_row.user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'Users cannot offboard their own employee identity.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.employee_assets
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND status = 'assigned' AND returned_date IS NULL
  ) THEN RAISE EXCEPTION 'Employee has assigned assets that must be returned first.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.advance_requests
    WHERE organization_id = p_org_id AND employee_id = p_employee_id AND status IN ('pending', 'approved')
  ) THEN RAISE EXCEPTION 'Employee has an unsettled advance request.' USING ERRCODE = '23514'; END IF;

  IF employee_row.lifecycle_status NOT IN ('offboarded') THEN
    SELECT role::text INTO prior_role FROM public.org_members WHERE org_id = p_org_id AND user_id = employee_row.user_id;

    UPDATE public.employee_shifts
    SET end_date = LEAST(COALESCE(end_date, p_effective_date), p_effective_date)
    WHERE org_id = p_org_id AND employee_id = p_employee_id
      AND (end_date IS NULL OR end_date > p_effective_date);
    UPDATE public.employee_locations
    SET assigned_to = LEAST(COALESCE(assigned_to, p_effective_date), p_effective_date)
    WHERE org_id = p_org_id AND employee_id = p_employee_id
      AND (assigned_to IS NULL OR assigned_to > p_effective_date);
    UPDATE public.employee_contracts
    SET status = 'terminated', terminated_at = now(), termination_reason = p_reason, updated_at = now()
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND status = 'active';
    UPDATE public.social_insurance
    SET status = 'inactive', updated_at = now()
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND status = 'active';

    IF employee_row.user_id IS NOT NULL THEN
      UPDATE public.profiles
      SET account_status = 'Inactive', updated_at = now()
      WHERE user_id = employee_row.user_id AND org_id = p_org_id;
      DELETE FROM public.org_members WHERE org_id = p_org_id AND user_id = employee_row.user_id;
    END IF;

    UPDATE public.employees
    SET lifecycle_status = 'offboarded', status = 'Inactive', offboarding_started_at = COALESCE(offboarding_started_at, now()),
        offboarded_at = now(), offboarding_reason = p_reason, offboarded_by = p_actor_user_id,
        termination_date = p_effective_date, termination_type = p_termination_type,
        auth_access_revoked_at = CASE WHEN user_id IS NULL THEN auth_access_revoked_at ELSE now() END,
        lifecycle_version = lifecycle_version + 1, updated_at = now()
    WHERE id = p_employee_id AND org_id = p_org_id
    RETURNING * INTO employee_row;

    INSERT INTO public.employee_career_events (employee_id, event_type, previous_value, new_value, effective_date, notes, created_by)
    VALUES (employee_row.id, 'offboarded', jsonb_build_object('role', prior_role, 'status', 'Active'),
      jsonb_build_object('status', 'Inactive', 'termination_type', p_termination_type), p_effective_date, p_reason, p_actor_user_id);

    event_payload := jsonb_build_object('event_type', 'employee.offboarded', 'employee_id', employee_row.id,
      'effective_date', p_effective_date, 'termination_type', p_termination_type, 'prior_role', prior_role);
    INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status, actor_user_id, occurred_at, processed_at)
    VALUES (p_org_id, 'employee', 'offboarded:' || employee_row.id::text, event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_actor_user_id, now(), now())
    ON CONFLICT (org_id, source_type, business_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO event_id;
    INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
    VALUES (p_org_id, event_id, 'employee.offboarded', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'))
    ON CONFLICT (business_event_id, topic) DO NOTHING;
  END IF;

  UPDATE public.employee_lifecycle_commands
  SET employee_id = employee_row.id, status = 'completed',
      result = jsonb_build_object('employee_id', employee_row.id, 'lifecycle_status', employee_row.lifecycle_status, 'user_id', employee_row.user_id),
      completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT employee_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_active_employee_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = NEW.employee_id
      AND org_id = NEW.org_id
      AND lifecycle_status = 'active'
      AND lower(COALESCE(status, '')) = 'active'
  ) THEN
    RAISE EXCEPTION 'Only active employees may create attendance or leave records.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_active_employee_guard ON public.attendance_records;
CREATE TRIGGER attendance_active_employee_guard
  BEFORE INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.require_active_employee_write();

DROP TRIGGER IF EXISTS leave_active_employee_guard ON public.leave_requests;
CREATE TRIGGER leave_active_employee_guard
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.require_active_employee_write();

REVOKE ALL ON FUNCTION public.begin_employee_onboarding(uuid, uuid, uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_employee_onboarding(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_employee_identity(uuid, uuid, uuid, uuid, uuid, text, text, public.org_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_employee_locations(uuid, uuid, uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.offboard_employee(uuid, uuid, uuid, uuid, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_employee_onboarding(uuid, uuid, uuid, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_employee_onboarding(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_employee_identity(uuid, uuid, uuid, uuid, uuid, text, text, public.org_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_employee_locations(uuid, uuid, uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.offboard_employee(uuid, uuid, uuid, uuid, date, text, text) TO service_role;
