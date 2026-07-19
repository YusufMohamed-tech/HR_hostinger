-- Versioned, server-owned payroll calculation and approval workflow.

-- ---------------------------------------------------------------------------
-- 1. Explicit social-insurance configuration
-- ---------------------------------------------------------------------------

ALTER TABLE public.social_insurance
  ADD COLUMN IF NOT EXISTS scheme_code text,
  ADD COLUMN IF NOT EXISTS contributory_wage numeric(14,2),
  ADD COLUMN IF NOT EXISTS maximum_contributory_wage numeric(14,2),
  ADD COLUMN IF NOT EXISTS employee_rate_basis_points integer,
  ADD COLUMN IF NOT EXISTS employer_rate_basis_points integer,
  ADD COLUMN IF NOT EXISTS prorate_partial_month boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS configuration_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS configuration_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS configuration_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.social_insurance
  DROP CONSTRAINT IF EXISTS social_insurance_configuration_status_check,
  ADD CONSTRAINT social_insurance_configuration_status_check
    CHECK (configuration_status IN ('unverified', 'verified')),
  DROP CONSTRAINT IF EXISTS social_insurance_contributory_wage_check,
  ADD CONSTRAINT social_insurance_contributory_wage_check
    CHECK (contributory_wage IS NULL OR contributory_wage >= 0),
  DROP CONSTRAINT IF EXISTS social_insurance_maximum_wage_check,
  ADD CONSTRAINT social_insurance_maximum_wage_check
    CHECK (maximum_contributory_wage IS NULL OR maximum_contributory_wage > 0),
  DROP CONSTRAINT IF EXISTS social_insurance_employee_rate_check,
  ADD CONSTRAINT social_insurance_employee_rate_check
    CHECK (employee_rate_basis_points IS NULL OR employee_rate_basis_points BETWEEN 0 AND 10000),
  DROP CONSTRAINT IF EXISTS social_insurance_employer_rate_check,
  ADD CONSTRAINT social_insurance_employer_rate_check
    CHECK (employer_rate_basis_points IS NULL OR employer_rate_basis_points BETWEEN 0 AND 10000),
  DROP CONSTRAINT IF EXISTS social_insurance_effective_dates_check,
  ADD CONSTRAINT social_insurance_effective_dates_check
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);

-- Existing rows are deliberately not marked verified. Their legacy percentage
-- did not describe the employee scheme, employer rate, or contributory wage.
UPDATE public.social_insurance
SET employee_rate_basis_points = COALESCE(
      employee_rate_basis_points,
      round(COALESCE(contribution_rate, 0) * 100)::integer
    ),
    scheme_code = COALESCE(scheme_code, 'legacy-unverified'),
    configuration_status = COALESCE(configuration_status, 'unverified')
WHERE employee_rate_basis_points IS NULL OR scheme_code IS NULL;

-- Configuration is sensitive payroll input and is now command-owned.
DROP POLICY IF EXISTS org_insert_social_insurance ON public.social_insurance;
DROP POLICY IF EXISTS org_update_social_insurance ON public.social_insurance;
DROP POLICY IF EXISTS org_delete_social_insurance ON public.social_insurance;

-- ---------------------------------------------------------------------------
-- 2. Payroll runs, command ledger, and immutable snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  formula_version text NOT NULL DEFAULT 'sa-payroll-v1',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'void')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  employee_count integer NOT NULL DEFAULT 0 CHECK (employee_count >= 0),
  total_base_salary numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_base_salary >= 0),
  total_allowances numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_allowances >= 0),
  total_deductions numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
  total_employee_gosi numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_employee_gosi >= 0),
  total_employer_gosi numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_employer_gosi >= 0),
  total_net numeric(16,2) NOT NULL DEFAULT 0 CHECK (total_net >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month),
  UNIQUE (id, org_id)
);

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid,
  ADD COLUMN IF NOT EXISTS formula_version text,
  ADD COLUMN IF NOT EXISTS calculation_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS input_hash text,
  ADD COLUMN IF NOT EXISTS result_hash text,
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS calculated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS advance_deduction numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payslips
  DROP CONSTRAINT IF EXISTS payslips_payroll_run_id_fkey,
  ADD CONSTRAINT payslips_payroll_run_id_fkey
    FOREIGN KEY (payroll_run_id, org_id) REFERENCES public.payroll_runs(id, org_id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS payslips_calculation_version_check,
  ADD CONSTRAINT payslips_calculation_version_check CHECK (calculation_version >= 0),
  DROP CONSTRAINT IF EXISTS payslips_input_hash_check,
  ADD CONSTRAINT payslips_input_hash_check CHECK (input_hash IS NULL OR length(input_hash) = 64),
  DROP CONSTRAINT IF EXISTS payslips_result_hash_check,
  ADD CONSTRAINT payslips_result_hash_check CHECK (result_hash IS NULL OR length(result_hash) = 64),
  DROP CONSTRAINT IF EXISTS payslips_advance_deduction_check,
  ADD CONSTRAINT payslips_advance_deduction_check CHECK (advance_deduction >= 0);

-- The original baseline created payslips before the later CREATE TABLE ...
-- UNIQUE definition, so existing installations may not have this key. Refuse
-- to hide duplicate financial records; operators must reconcile them before
-- applying the migration.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payslips_org_employee_month
  ON public.payslips(org_id, employee_id, month);
ALTER TABLE public.payslips
  DROP CONSTRAINT IF EXISTS payslips_status_check,
  ADD CONSTRAINT payslips_status_check CHECK (status IN ('draft', 'approved', 'paid', 'void'));

-- Preserve historical data without pretending it satisfies the new formula.
INSERT INTO public.payroll_runs (org_id, month, formula_version, status, employee_count,
  total_base_salary, total_allowances, total_deductions, total_employee_gosi,
  total_employer_gosi, total_net, created_at, updated_at)
SELECT p.org_id, p.month, 'legacy-unverified',
  CASE
    WHEN bool_or(COALESCE(p.status, 'draft') = 'paid') THEN 'paid'
    WHEN bool_or(COALESCE(p.status, 'draft') = 'approved') THEN 'approved'
    ELSE 'draft'
  END,
  count(*)::integer,
  COALESCE(sum(p.base_salary), 0), COALESCE(sum(p.total_allowances), 0),
  COALESCE(sum(p.total_deductions), 0), COALESCE(sum(p.employee_gosi), 0),
  COALESCE(sum(p.employer_gosi), 0), COALESCE(sum(p.net_salary), 0),
  min(p.created_at), max(p.updated_at)
FROM public.payslips p
WHERE p.payroll_run_id IS NULL
GROUP BY p.org_id, p.month
ON CONFLICT (org_id, month) DO NOTHING;

UPDATE public.payslips p
SET payroll_run_id = r.id,
    formula_version = COALESCE(p.formula_version, 'legacy-unverified')
FROM public.payroll_runs r
WHERE p.payroll_run_id IS NULL
  AND r.org_id = p.org_id
  AND r.month = p.month;

CREATE TABLE IF NOT EXISTS public.payroll_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('configure_insurance', 'calculate_payslip', 'add_adjustment', 'remove_adjustment', 'transition_run')),
  payroll_run_id uuid,
  payslip_id uuid REFERENCES public.payslips(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (payroll_run_id, org_id) REFERENCES public.payroll_runs(id, org_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS payroll_runs_org_status_idx ON public.payroll_runs(org_id, status, month DESC);
CREATE INDEX IF NOT EXISTS payroll_commands_org_created_idx ON public.payroll_commands(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payslips_run_idx ON public.payslips(payroll_run_id, employee_id);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_runs_select ON public.payroll_runs
  FOR SELECT USING (auth.role() = 'service_role' OR (org_id = public.current_org_id() AND public.can_manage_payroll()));
CREATE POLICY payroll_commands_select ON public.payroll_commands
  FOR SELECT USING (auth.role() = 'service_role' OR (org_id = public.current_org_id() AND public.can_manage_payroll()));

-- Payslips are readable by payroll managers and by the employee, but are only
-- mutable through the service-only commands below.
DROP POLICY IF EXISTS org_insert_payslips ON public.payslips;
DROP POLICY IF EXISTS org_update_payslips ON public.payslips;
DROP POLICY IF EXISTS org_delete_payslips ON public.payslips;
DROP POLICY IF EXISTS payslips_insert ON public.payslips;
DROP POLICY IF EXISTS payslips_update ON public.payslips;
DROP POLICY IF EXISTS payslips_delete ON public.payslips;
DROP POLICY IF EXISTS org_select_payslips ON public.payslips;
DROP POLICY IF EXISTS payslips_select ON public.payslips;
CREATE POLICY payroll_payslips_select ON public.payslips
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      org_id = public.current_org_id()
      AND (public.can_manage_payroll() OR employee_id = public.current_employee_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Atomic configuration, calculation, and run-transition commands
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.configure_employee_social_insurance(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_configuration jsonb
)
RETURNS SETOF public.social_insurance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.payroll_commands%ROWTYPE;
  insurance_row public.social_insurance%ROWTYPE;
  input_hash text := encode(digest(p_configuration::text, 'sha256'), 'hex');
  registered boolean := COALESCE((p_configuration->>'registered')::boolean, false);
  actor_role text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin');
  IF actor_role IS NULL THEN RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.payroll_commands (org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'configure_insurance', p_employee_id, input_hash, p_actor_user_id, p_request_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.payroll_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'configure_insurance' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for a different payroll command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.social_insurance WHERE org_id = p_org_id AND employee_id = p_employee_id;
    RETURN;
  END IF;

  IF registered THEN
    IF NULLIF(btrim(p_configuration->>'gosiNumber'), '') IS NULL
       OR NULLIF(btrim(p_configuration->>'schemeCode'), '') IS NULL
       OR (p_configuration->>'contributoryWage')::numeric < 0
       OR (p_configuration->>'maximumContributoryWage')::numeric <= 0
       OR (p_configuration->>'employeeRateBasisPoints')::integer NOT BETWEEN 0 AND 10000
       OR (p_configuration->>'employerRateBasisPoints')::integer NOT BETWEEN 0 AND 10000
       OR NULLIF(p_configuration->>'effectiveFrom', '') IS NULL THEN
      RAISE EXCEPTION 'A complete verified social-insurance configuration is required.' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.social_insurance (
    org_id, employee_id, gosi_number, registration_date, contribution_rate,
    status, scheme_code, contributory_wage, maximum_contributory_wage,
    employee_rate_basis_points, employer_rate_basis_points, prorate_partial_month,
    effective_from, effective_to, configuration_status,
    configuration_verified_at, configuration_verified_by, updated_at
  ) VALUES (
    p_org_id, p_employee_id, NULLIF(btrim(p_configuration->>'gosiNumber'), ''),
    NULLIF(p_configuration->>'registrationDate', '')::date,
    COALESCE((p_configuration->>'employeeRateBasisPoints')::numeric / 100, 0),
    CASE WHEN registered THEN 'active' ELSE 'inactive' END,
    CASE WHEN registered THEN NULLIF(btrim(p_configuration->>'schemeCode'), '') ELSE NULL END,
    CASE WHEN registered THEN (p_configuration->>'contributoryWage')::numeric ELSE NULL END,
    CASE WHEN registered THEN (p_configuration->>'maximumContributoryWage')::numeric ELSE NULL END,
    CASE WHEN registered THEN (p_configuration->>'employeeRateBasisPoints')::integer ELSE NULL END,
    CASE WHEN registered THEN (p_configuration->>'employerRateBasisPoints')::integer ELSE NULL END,
    COALESCE((p_configuration->>'proratePartialMonth')::boolean, false),
    CASE WHEN registered THEN (p_configuration->>'effectiveFrom')::date ELSE NULL END,
    NULLIF(p_configuration->>'effectiveTo', '')::date,
    CASE WHEN registered THEN 'verified' ELSE 'unverified' END,
    CASE WHEN registered THEN now() ELSE NULL END,
    CASE WHEN registered THEN p_actor_user_id ELSE NULL END,
    now()
  ) ON CONFLICT (org_id, employee_id) DO UPDATE SET
    gosi_number = EXCLUDED.gosi_number,
    registration_date = EXCLUDED.registration_date,
    contribution_rate = EXCLUDED.contribution_rate,
    status = EXCLUDED.status,
    scheme_code = EXCLUDED.scheme_code,
    contributory_wage = EXCLUDED.contributory_wage,
    maximum_contributory_wage = EXCLUDED.maximum_contributory_wage,
    employee_rate_basis_points = EXCLUDED.employee_rate_basis_points,
    employer_rate_basis_points = EXCLUDED.employer_rate_basis_points,
    prorate_partial_month = EXCLUDED.prorate_partial_month,
    effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to,
    configuration_status = EXCLUDED.configuration_status,
    configuration_verified_at = EXCLUDED.configuration_verified_at,
    configuration_verified_by = EXCLUDED.configuration_verified_by,
    updated_at = now()
  RETURNING * INTO insurance_row;

  UPDATE public.employees SET
    gosi_registered = registered,
    gosi_number = CASE WHEN registered THEN insurance_row.gosi_number ELSE NULL END,
    updated_at = now()
  WHERE id = p_employee_id AND org_id = p_org_id;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role, 'payroll.insurance_configured',
    'social_insurance', insurance_row.id::text, 'success', 200,
    jsonb_build_object('employee_id', p_employee_id, 'registered', registered, 'scheme_code', insurance_row.scheme_code)
  );
  UPDATE public.payroll_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('social_insurance_id', insurance_row.id, 'employee_id', p_employee_id, 'registered', registered)
  WHERE id = command_row.id;
  RETURN NEXT insurance_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_payroll_calculation(
  p_org_id uuid,
  p_employee_id uuid,
  p_month date,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_expected_calculation_version integer,
  p_command_action text,
  p_input_snapshot jsonb,
  p_result_snapshot jsonb
)
RETURNS SETOF public.payslips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.payroll_commands%ROWTYPE;
  run_row public.payroll_runs%ROWTYPE;
  payslip_row public.payslips%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  payload jsonb := jsonb_build_object(
    'employee_id', p_employee_id, 'month', p_month, 'expected_version', p_expected_calculation_version,
    'input', p_input_snapshot, 'result', p_result_snapshot
  );
  payload_hash text;
  input_hash_value text := encode(digest(p_input_snapshot::text, 'sha256'), 'hex');
  result_hash_value text := encode(digest(p_result_snapshot::text, 'sha256'), 'hex');
  actor_role text;
  month_end date := (p_month + interval '1 month - 1 day')::date;
  earned_base bigint;
  total_allowances bigint;
  total_deductions bigint;
  net_pay bigint;
  employee_gosi_value bigint;
  employer_gosi_value bigint;
  manual_bonus bigint;
  manual_deduction bigint;
  adjustments_json jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_command_action NOT IN ('calculate_payslip', 'add_adjustment', 'remove_adjustment') THEN
    RAISE EXCEPTION 'Unsupported payroll calculation command.' USING ERRCODE = '22023';
  END IF;
  IF p_month <> date_trunc('month', p_month)::date THEN RAISE EXCEPTION 'Payroll month must be the first day of the month.' USING ERRCODE = '22023'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin', 'finance_manager');
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Payroll management access is required.' USING ERRCODE = '42501'; END IF;
  IF p_result_snapshot->>'formulaVersion' <> 'sa-payroll-v1' THEN
    RAISE EXCEPTION 'Unsupported payroll formula version.' USING ERRCODE = '23514';
  END IF;

  earned_base := (p_result_snapshot->>'earnedBaseSalaryHalalas')::bigint;
  total_allowances := (p_result_snapshot->>'totalAllowancesHalalas')::bigint;
  total_deductions := (p_result_snapshot->>'totalDeductionsHalalas')::bigint;
  net_pay := (p_result_snapshot->>'netPayHalalas')::bigint;
  employee_gosi_value := (p_result_snapshot->>'employeeInsuranceHalalas')::bigint;
  employer_gosi_value := (p_result_snapshot->>'employerInsuranceHalalas')::bigint;
  manual_bonus := (p_result_snapshot->>'manualBonusHalalas')::bigint;
  manual_deduction := (p_result_snapshot->>'manualDeductionHalalas')::bigint;
  IF earned_base < 0 OR total_allowances < 0 OR total_deductions < 0 OR net_pay < 0
     OR employee_gosi_value < 0 OR employer_gosi_value < 0
     OR earned_base + total_allowances - total_deductions <> net_pay THEN
    RAISE EXCEPTION 'Payroll result totals are invalid.' USING ERRCODE = '23514';
  END IF;
  payload_hash := encode(digest(payload::text, 'sha256'), 'hex');

  INSERT INTO public.payroll_commands (
    org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_command_action, p_employee_id, payload_hash, p_actor_user_id, p_request_id
  ) ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.payroll_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> p_command_action OR command_row.payload_hash <> payload_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for a different payroll command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.payslips WHERE id = command_row.payslip_id AND org_id = p_org_id;
    RETURN;
  END IF;

  SELECT * INTO employee_row FROM public.employees
  WHERE id = p_employee_id AND org_id = p_org_id FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  IF employee_row.lifecycle_status = 'archived'
     OR employee_row.hiring_date IS NULL
     OR employee_row.hiring_date > month_end
     OR (employee_row.termination_date IS NOT NULL AND employee_row.termination_date < p_month) THEN
    RAISE EXCEPTION 'Employee is not eligible for this payroll month.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.payroll_runs (org_id, month, formula_version, created_by)
  VALUES (p_org_id, p_month, 'sa-payroll-v1', p_actor_user_id)
  ON CONFLICT (org_id, month) DO NOTHING;
  SELECT * INTO run_row FROM public.payroll_runs WHERE org_id = p_org_id AND month = p_month FOR UPDATE;
  IF run_row.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft payroll run can be calculated.' USING ERRCODE = '55000'; END IF;
  IF run_row.formula_version <> 'sa-payroll-v1' THEN
    -- Draft legacy rows may be upgraded one-by-one. Approval remains blocked
    -- until every row has a launch-formula snapshot.
    UPDATE public.payroll_runs SET formula_version = 'sa-payroll-v1', updated_at = now() WHERE id = run_row.id;
  END IF;

  SELECT * INTO payslip_row FROM public.payslips
  WHERE org_id = p_org_id AND employee_id = p_employee_id AND month = p_month FOR UPDATE;
  IF payslip_row.id IS NULL AND p_expected_calculation_version <> 0 THEN
    RAISE EXCEPTION 'Payroll calculation version conflict.' USING ERRCODE = '40001';
  ELSIF payslip_row.id IS NOT NULL AND payslip_row.calculation_version <> p_expected_calculation_version THEN
    RAISE EXCEPTION 'Payroll calculation version conflict.' USING ERRCODE = '40001';
  END IF;
  IF payslip_row.id IS NOT NULL AND payslip_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft payslip can be recalculated.' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', item->>'id', 'type', item->>'type',
    'amount', (item->>'amountHalalas')::numeric / 100,
    'reason', item->>'reason', 'created_by', item->>'createdBy', 'created_at', item->>'createdAt'
  ) ORDER BY item->>'createdAt'), '[]'::jsonb)
  INTO adjustments_json
  FROM jsonb_array_elements(COALESCE(p_input_snapshot->'manualAdjustments', '[]'::jsonb)) item;

  INSERT INTO public.payslips (
    org_id, employee_id, month, payroll_run_id, formula_version, calculation_version,
    base_salary, total_allowances, total_deductions, net_salary, employee_gosi, employer_gosi,
    attendance_days, approved_absent_days, unapproved_absent_days, late_minutes,
    late_deduction, absence_deduction, advance_deduction,
    snapshot_group_name, snapshot_late_grace_minutes, snapshot_deduction_per_late_hour,
    snapshot_allowed_absent_days, snapshot_deduction_per_absent_day,
    snapshot_deduction_per_excess_approved_day, manual_adjustments, manual_adjustments_total,
    allowances_details, deductions_details, payroll_notes, status,
    input_snapshot, result_snapshot, input_hash, result_hash, calculated_at, calculated_by, updated_at
  ) VALUES (
    p_org_id, p_employee_id, p_month, run_row.id, 'sa-payroll-v1', 1,
    earned_base::numeric / 100, total_allowances::numeric / 100, total_deductions::numeric / 100,
    net_pay::numeric / 100, employee_gosi_value::numeric / 100, employer_gosi_value::numeric / 100,
    COALESCE((p_input_snapshot->'attendance'->>'attendanceDays')::integer, 0),
    COALESCE((p_input_snapshot->'attendance'->>'approvedAbsentDays')::integer, 0),
    COALESCE((p_input_snapshot->'attendance'->>'unapprovedAbsentDays')::integer, 0),
    COALESCE((p_input_snapshot->'attendance'->>'lateMinutes')::integer, 0),
    COALESCE((p_input_snapshot->>'lateDeductionHalalas')::numeric, 0) / 100,
    COALESCE((p_input_snapshot->>'absenceDeductionHalalas')::numeric, 0) / 100,
    COALESCE((p_input_snapshot->>'advanceDeductionHalalas')::numeric, 0) / 100,
    p_input_snapshot->'deductionRule'->>'name',
    (p_input_snapshot->'deductionRule'->>'lateGraceMinutes')::integer,
    COALESCE((p_input_snapshot->'deductionRule'->>'deductionPerLateHourHalalas')::numeric, 0) / 100,
    (p_input_snapshot->'deductionRule'->>'allowedAbsentDays')::integer,
    COALESCE((p_input_snapshot->'deductionRule'->>'deductionPerAbsentDayHalalas')::numeric, 0) / 100,
    COALESCE((p_input_snapshot->'deductionRule'->>'deductionPerExcessApprovedDayHalalas')::numeric, 0) / 100,
    adjustments_json, (manual_bonus - manual_deduction)::numeric / 100,
    COALESCE(p_result_snapshot->'allowanceLines', '[]'::jsonb),
    COALESCE(p_result_snapshot->'recurringDeductionLines', '[]'::jsonb),
    p_input_snapshot->>'notes', 'draft',
    p_input_snapshot, p_result_snapshot, input_hash_value, result_hash_value, now(), p_actor_user_id, now()
  ) ON CONFLICT (org_id, employee_id, month) DO UPDATE SET
    payroll_run_id = EXCLUDED.payroll_run_id,
    formula_version = EXCLUDED.formula_version,
    calculation_version = public.payslips.calculation_version + 1,
    base_salary = EXCLUDED.base_salary,
    total_allowances = EXCLUDED.total_allowances,
    total_deductions = EXCLUDED.total_deductions,
    net_salary = EXCLUDED.net_salary,
    employee_gosi = EXCLUDED.employee_gosi,
    employer_gosi = EXCLUDED.employer_gosi,
    attendance_days = EXCLUDED.attendance_days,
    approved_absent_days = EXCLUDED.approved_absent_days,
    unapproved_absent_days = EXCLUDED.unapproved_absent_days,
    late_minutes = EXCLUDED.late_minutes,
    late_deduction = EXCLUDED.late_deduction,
    absence_deduction = EXCLUDED.absence_deduction,
    advance_deduction = EXCLUDED.advance_deduction,
    snapshot_group_name = EXCLUDED.snapshot_group_name,
    snapshot_late_grace_minutes = EXCLUDED.snapshot_late_grace_minutes,
    snapshot_deduction_per_late_hour = EXCLUDED.snapshot_deduction_per_late_hour,
    snapshot_allowed_absent_days = EXCLUDED.snapshot_allowed_absent_days,
    snapshot_deduction_per_absent_day = EXCLUDED.snapshot_deduction_per_absent_day,
    snapshot_deduction_per_excess_approved_day = EXCLUDED.snapshot_deduction_per_excess_approved_day,
    manual_adjustments = EXCLUDED.manual_adjustments,
    manual_adjustments_total = EXCLUDED.manual_adjustments_total,
    allowances_details = EXCLUDED.allowances_details,
    deductions_details = EXCLUDED.deductions_details,
    payroll_notes = EXCLUDED.payroll_notes,
    input_snapshot = EXCLUDED.input_snapshot,
    result_snapshot = EXCLUDED.result_snapshot,
    input_hash = EXCLUDED.input_hash,
    result_hash = EXCLUDED.result_hash,
    calculated_at = EXCLUDED.calculated_at,
    calculated_by = EXCLUDED.calculated_by,
    updated_at = now()
  RETURNING * INTO payslip_row;

  UPDATE public.payroll_runs r SET
    version = r.version + 1,
    employee_count = totals.employee_count,
    total_base_salary = totals.total_base,
    total_allowances = totals.total_allowances,
    total_deductions = totals.total_deductions,
    total_employee_gosi = totals.employee_gosi,
    total_employer_gosi = totals.employer_gosi,
    total_net = totals.total_net,
    updated_at = now()
  FROM (
    SELECT count(*)::integer employee_count,
      COALESCE(sum(slip.base_salary), 0) total_base,
      COALESCE(sum(slip.total_allowances), 0) total_allowances,
      COALESCE(sum(slip.total_deductions), 0) total_deductions,
      COALESCE(sum(slip.employee_gosi), 0) employee_gosi,
      COALESCE(sum(slip.employer_gosi), 0) employer_gosi,
      COALESCE(sum(slip.net_salary), 0) total_net
    FROM public.payslips slip WHERE slip.payroll_run_id = run_row.id
  ) totals
  WHERE r.id = run_row.id;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role, 'payroll.payslip_calculated',
    'payslip', payslip_row.id::text, 'success', 200,
    jsonb_build_object('employee_id', p_employee_id, 'month', p_month, 'formula_version', 'sa-payroll-v1', 'result_hash', result_hash_value)
  );
  UPDATE public.payroll_commands SET payroll_run_id = run_row.id, payslip_id = payslip_row.id,
    status = 'completed', completed_at = now(),
    result = jsonb_build_object('payroll_run_id', run_row.id, 'payslip_id', payslip_row.id,
      'calculation_version', payslip_row.calculation_version, 'result_hash', result_hash_value)
  WHERE id = command_row.id;
  RETURN NEXT payslip_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_payroll_run(
  p_org_id uuid,
  p_payroll_run_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_target_status text,
  p_reason text DEFAULT NULL
)
RETURNS SETOF public.payroll_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.payroll_commands%ROWTYPE;
  run_row public.payroll_runs%ROWTYPE;
  actor_role text;
  input_payload jsonb := jsonb_build_object(
    'payroll_run_id', p_payroll_run_id, 'expected_version', p_expected_version,
    'target_status', p_target_status, 'reason', NULLIF(btrim(p_reason), '')
  );
  input_hash text;
  eligible_count integer;
  event_id uuid;
  event_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin', 'finance_manager');
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Payroll management access is required.' USING ERRCODE = '42501'; END IF;
  IF p_target_status NOT IN ('approved', 'void') THEN
    RAISE EXCEPTION 'Paid status is controlled by the atomic accounting payment workflow.' USING ERRCODE = '23514';
  END IF;
  input_hash := encode(digest(input_payload::text, 'sha256'), 'hex');
  INSERT INTO public.payroll_commands (
    org_id, idempotency_key, action, payroll_run_id, payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, 'transition_run', p_payroll_run_id, input_hash, p_actor_user_id, p_request_id
  ) ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.payroll_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'transition_run' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for a different payroll command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.payroll_runs WHERE id = p_payroll_run_id AND org_id = p_org_id;
    RETURN;
  END IF;

  SELECT * INTO run_row FROM public.payroll_runs
  WHERE id = p_payroll_run_id AND org_id = p_org_id FOR UPDATE;
  IF run_row.id IS NULL THEN RAISE EXCEPTION 'Payroll run was not found.' USING ERRCODE = 'P0002'; END IF;
  IF run_row.version <> p_expected_version THEN RAISE EXCEPTION 'Payroll run version conflict.' USING ERRCODE = '40001'; END IF;

  IF p_target_status = 'approved' THEN
    IF run_row.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft payroll run can be approved.' USING ERRCODE = '55000'; END IF;
    IF run_row.formula_version <> 'sa-payroll-v1' OR run_row.employee_count = 0 THEN
      RAISE EXCEPTION 'A complete launch-formula payroll run is required.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payslips slip
      WHERE slip.payroll_run_id = run_row.id
        AND (slip.formula_version <> 'sa-payroll-v1' OR slip.input_hash IS NULL OR slip.result_hash IS NULL OR slip.status <> 'draft')
    ) THEN RAISE EXCEPTION 'Every payslip must have a valid immutable launch-formula snapshot.' USING ERRCODE = '23514'; END IF;
    SELECT count(*)::integer INTO eligible_count FROM public.employees e
    WHERE e.org_id = p_org_id
      AND e.lifecycle_status <> 'archived'
      AND e.hiring_date IS NOT NULL
      AND e.hiring_date <= (run_row.month + interval '1 month - 1 day')::date
      AND (e.termination_date IS NULL OR e.termination_date >= run_row.month);
    IF eligible_count <> run_row.employee_count THEN
      RAISE EXCEPTION 'Payroll run is incomplete: expected % eligible employees, found % payslips.', eligible_count, run_row.employee_count USING ERRCODE = '23514';
    END IF;

    UPDATE public.payslips SET status = 'approved', approved_at = now(), approved_by = p_actor_user_id, updated_at = now()
    WHERE payroll_run_id = run_row.id AND status = 'draft';
    UPDATE public.payroll_runs SET status = 'approved', version = version + 1,
      approved_at = now(), approved_by = p_actor_user_id, updated_at = now()
    WHERE id = run_row.id RETURNING * INTO run_row;
    event_payload := jsonb_build_object(
      'event_type', 'payroll.run_approved', 'payroll_run_id', run_row.id,
      'month', run_row.month, 'version', run_row.version, 'employee_count', run_row.employee_count,
      'total_base_salary', run_row.total_base_salary, 'total_allowances', run_row.total_allowances,
      'total_deductions', run_row.total_deductions, 'total_employee_gosi', run_row.total_employee_gosi,
      'total_employer_gosi', run_row.total_employer_gosi, 'total_net', run_row.total_net
    );
    INSERT INTO public.business_events (
      org_id, source_type, business_key, event_version, payload, payload_hash,
      status, request_id, actor_user_id, occurred_at, processed_at
    ) VALUES (
      p_org_id, 'payroll', run_row.id::text || ':approved:' || run_row.version::text,
      run_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
      'completed', p_request_id, p_actor_user_id, now(), now()
    ) RETURNING id INTO event_id;
    INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
    VALUES (p_org_id, event_id, 'payroll.run_approved', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  ELSE
    IF run_row.status NOT IN ('draft', 'approved') THEN RAISE EXCEPTION 'Only a draft or approved payroll run can be voided.' USING ERRCODE = '55000'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A void reason is required.' USING ERRCODE = '22023'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.accounting_source_postings
      WHERE organization_id = p_org_id AND source_module = 'payroll'
        AND source_id = run_row.id AND status = 'posted'
    ) THEN RAISE EXCEPTION 'Posted payroll must be reversed in accounting before it can be voided.' USING ERRCODE = '55000'; END IF;
    UPDATE public.payslips SET status = 'void', updated_at = now() WHERE payroll_run_id = run_row.id;
    UPDATE public.payroll_runs SET status = 'void', version = version + 1,
      voided_at = now(), voided_by = p_actor_user_id, void_reason = btrim(p_reason), updated_at = now()
    WHERE id = run_row.id RETURNING * INTO run_row;
  END IF;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role,
    'payroll.run_' || p_target_status, 'payroll_run', run_row.id::text, 'success', 200,
    jsonb_build_object('month', run_row.month, 'version', run_row.version, 'reason', NULLIF(btrim(p_reason), ''))
  );
  UPDATE public.payroll_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('payroll_run_id', run_row.id, 'status', run_row.status, 'version', run_row.version)
  WHERE id = command_row.id;
  RETURN NEXT run_row;
END;
$$;

-- Prevent accidental service-role edits to a frozen historical snapshot.
CREATE OR REPLACE FUNCTION public.protect_frozen_payslip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Approved and paid payslips are immutable.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'paid') THEN
    IF ROW(
      NEW.org_id, NEW.employee_id, NEW.month, NEW.payroll_run_id, NEW.formula_version,
      NEW.calculation_version, NEW.base_salary, NEW.total_allowances, NEW.total_deductions,
      NEW.net_salary, NEW.employee_gosi, NEW.employer_gosi, NEW.input_snapshot,
      NEW.result_snapshot, NEW.input_hash, NEW.result_hash, NEW.manual_adjustments,
      NEW.manual_adjustments_total, NEW.advance_deduction
    ) IS DISTINCT FROM ROW(
      OLD.org_id, OLD.employee_id, OLD.month, OLD.payroll_run_id, OLD.formula_version,
      OLD.calculation_version, OLD.base_salary, OLD.total_allowances, OLD.total_deductions,
      OLD.net_salary, OLD.employee_gosi, OLD.employer_gosi, OLD.input_snapshot,
      OLD.result_snapshot, OLD.input_hash, OLD.result_hash, OLD.manual_adjustments,
      OLD.manual_adjustments_total, OLD.advance_deduction
    ) THEN RAISE EXCEPTION 'Approved and paid payslip calculations are immutable.' USING ERRCODE = '55000'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.require_verified_insurance_for_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lifecycle_status = 'active'
     AND OLD.lifecycle_status IS DISTINCT FROM 'active'
     AND NEW.employment_type <> 'intern'
     AND NOT EXISTS (
       SELECT 1 FROM public.social_insurance insurance
       WHERE insurance.org_id = NEW.org_id
         AND insurance.employee_id = NEW.id
         AND insurance.status = 'active'
         AND insurance.configuration_status = 'verified'
         AND insurance.configuration_verified_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'A verified social-insurance configuration is required before employee activation.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_frozen_payslip_trigger ON public.payslips;
CREATE TRIGGER protect_frozen_payslip_trigger
  BEFORE UPDATE OR DELETE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.protect_frozen_payslip();

DROP TRIGGER IF EXISTS require_verified_insurance_for_activation_trigger ON public.employees;
CREATE TRIGGER require_verified_insurance_for_activation_trigger
  BEFORE UPDATE OF lifecycle_status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_insurance_for_activation();

DROP TRIGGER IF EXISTS touch_payroll_runs_updated_at ON public.payroll_runs;
CREATE TRIGGER touch_payroll_runs_updated_at
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

REVOKE ALL ON FUNCTION public.configure_employee_social_insurance(uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_payroll_calculation(uuid, uuid, date, uuid, uuid, uuid, integer, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_payroll_run(uuid, uuid, uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_employee_social_insurance(uuid, uuid, uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_payroll_calculation(uuid, uuid, date, uuid, uuid, uuid, integer, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_payroll_run(uuid, uuid, uuid, uuid, uuid, integer, text, text) TO service_role;

COMMENT ON TABLE public.payroll_runs IS 'Versioned organization payroll runs. Approved/paid runs are immutable accounting sources.';
COMMENT ON COLUMN public.payslips.formula_version IS 'Calculation contract version; legacy-unverified records cannot be approved by the launch workflow.';
