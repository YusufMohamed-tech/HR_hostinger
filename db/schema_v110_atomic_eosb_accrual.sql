-- Post a monthly end-of-service-benefit accrual and its employee ledger rows
-- in one replay-safe transaction. The legacy application flow inserted the
-- employee rows before attempting the journal, which could make a failed month
-- look complete and prevent a safe retry.

CREATE TABLE IF NOT EXISTS public.eosb_accrual_runs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE RESTRICT,
  employees_processed integer NOT NULL DEFAULT 0 CHECK (employees_processed >= 0),
  total_accrual numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_accrual >= 0),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, month)
);

ALTER TABLE public.eosb_accrual_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eosb_accrual_runs_select ON public.eosb_accrual_runs;
CREATE POLICY eosb_accrual_runs_select ON public.eosb_accrual_runs
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND EXISTS (
        SELECT 1 FROM public.org_members member
        WHERE member.org_id = organization_id AND member.user_id = auth.uid()
          AND member.role::text IN ('finance_manager', 'accountant')
      )
    )
  );

-- Accrual rows are command-owned. Browser sessions retain the existing scoped
-- read policy, but can no longer manufacture financial ledger rows directly.
DROP POLICY IF EXISTS "eosb_accruals_insert" ON public.eosb_accruals;

CREATE OR REPLACE FUNCTION public.run_eosb_accrual(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_row public.eosb_accrual_runs%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  journal_row public.accounting_journal_entries%ROWTYPE;
  actor_role_value text;
  month_start date := date_trunc('month', p_month)::date;
  month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  month_text text := to_char(date_trunc('month', p_month), 'YYYY-MM');
  accrual_rows_value jsonb := '[]'::jsonb;
  lines_value jsonb := '[]'::jsonb;
  employees_count integer := 0;
  total_value numeric(14,2) := 0;
  legacy_count integer := 0;
  legacy_journal_count integer := 0;
  legacy_journal_id uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_month IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, command, and month are required.' USING ERRCODE = '22023';
  END IF;
  IF p_month IS DISTINCT FROM month_start THEN
    RAISE EXCEPTION 'EOSB accrual month must be the first day of the month.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.org_id = member.org_id AND profile.user_id = member.user_id
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text = 'finance_manager'
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO run_row FROM public.eosb_accrual_runs
  WHERE organization_id = p_org_id AND month = month_start
  FOR UPDATE;
  IF run_row.id IS NOT NULL THEN
    IF run_row.status = 'completed' THEN RETURN run_row.result; END IF;
    RAISE EXCEPTION 'EOSB accrual month is already processing.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.eosb_accrual_runs (
    id, organization_id, month, actor_user_id, request_id
  ) VALUES (
    p_command_id, p_org_id, month_start, p_actor_user_id, p_request_id
  ) RETURNING * INTO run_row;

  SELECT * INTO settings_row FROM public.accounting_settings
  WHERE organization_id = p_org_id FOR SHARE;
  IF settings_row.id IS NULL OR NOT COALESCE(settings_row.auto_post_eosb, false) THEN
    result_value := jsonb_build_object(
      'journalEntryId', NULL, 'employeesProcessed', 0,
      'totalAccrual', 0, 'status', 'disabled'
    );
    UPDATE public.eosb_accrual_runs SET
      status = 'completed', result = result_value, completed_at = now()
    WHERE id = run_row.id;
    RETURN result_value;
  END IF;
  IF settings_row.default_eosb_expense_id IS NULL
     OR settings_row.default_eosb_provision_id IS NULL THEN
    RAISE EXCEPTION 'EOSB expense and provision accounts are not configured.' USING ERRCODE = '23514';
  END IF;

  -- Adopt a fully linked legacy month, but fail closed on the partial state
  -- produced by the old application flow so Finance can reconcile it first.
  SELECT count(*)::integer, count(DISTINCT journal_entry_id)::integer,
    min(journal_entry_id::text)::uuid
    INTO legacy_count, legacy_journal_count, legacy_journal_id
  FROM public.eosb_accruals
  WHERE organization_id = p_org_id AND month = month_text;
  IF legacy_count > 0 THEN
    IF legacy_journal_count <> 1 OR legacy_journal_id IS NULL
       OR EXISTS (
         SELECT 1 FROM public.eosb_accruals
         WHERE organization_id = p_org_id AND month = month_text AND journal_entry_id IS NULL
       ) THEN
      RAISE EXCEPTION 'Existing EOSB accrual rows for this month require reconciliation before retry.'
        USING ERRCODE = '55000';
    END IF;
    SELECT COALESCE(sum(monthly_accrual), 0)::numeric(14,2)
      INTO total_value
    FROM public.eosb_accruals
    WHERE organization_id = p_org_id AND month = month_text;
    result_value := jsonb_build_object(
      'journalEntryId', legacy_journal_id, 'employeesProcessed', legacy_count,
      'totalAccrual', total_value, 'status', 'adopted'
    );
    UPDATE public.eosb_accrual_runs SET
      status = 'completed', journal_entry_id = legacy_journal_id,
      employees_processed = legacy_count, total_accrual = total_value,
      result = result_value, completed_at = now()
    WHERE id = run_row.id;
    RETURN result_value;
  END IF;

  -- Stabilize employee inputs while the accrual snapshot and journal are built.
  PERFORM 1 FROM public.employees employee
  WHERE employee.org_id = p_org_id
    AND lower(employee.status::text) = 'active'
    AND employee.lifecycle_status = 'active'
    AND employee.hiring_date IS NOT NULL
    AND employee.hiring_date <= month_start
    AND COALESCE(employee.base_salary, 0) > 0
  FOR SHARE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', calculated.employee_id,
    'employee_name', calculated.employee_name,
    'years_of_service', round(calculated.years_of_service, 2),
    'daily_rate', calculated.daily_rate,
    'monthly_accrual', calculated.monthly_accrual,
    'cumulative_accrual', round(calculated.prior_total + calculated.monthly_accrual, 2)
  ) ORDER BY calculated.employee_id), '[]'::jsonb)
    INTO accrual_rows_value
  FROM (
    SELECT monthly.employee_id, monthly.employee_name, monthly.years_of_service,
      monthly.daily_rate, monthly.monthly_accrual,
      COALESCE((
        SELECT sum(prior.monthly_accrual)
        FROM public.eosb_accruals prior
        WHERE prior.organization_id = p_org_id
          AND prior.employee_id = monthly.employee_id
          AND prior.month < month_text
      ), 0)::numeric AS prior_total
    FROM (
      SELECT base.employee_id, base.employee_name, base.years_of_service,
        base.daily_rate,
        round(base.daily_rate * CASE WHEN base.years_of_service > 5 THEN 30 ELSE 15 END / 12, 2) AS monthly_accrual
      FROM (
        SELECT employee.id AS employee_id, employee.full_name AS employee_name,
          (extract(epoch FROM (month_start::timestamp - employee.hiring_date::timestamp)) / 31557600)::numeric AS years_of_service,
          round(employee.base_salary / 30, 2) AS daily_rate
        FROM public.employees employee
        WHERE employee.org_id = p_org_id
          AND lower(employee.status::text) = 'active'
          AND employee.lifecycle_status = 'active'
          AND employee.hiring_date IS NOT NULL
          AND employee.hiring_date <= month_start
          AND COALESCE(employee.base_salary, 0) > 0
      ) base
    ) monthly
    WHERE monthly.monthly_accrual > 0
  ) calculated;

  employees_count := jsonb_array_length(accrual_rows_value);
  SELECT COALESCE(sum((item->>'monthly_accrual')::numeric), 0)::numeric(14,2)
    INTO total_value
  FROM jsonb_array_elements(accrual_rows_value) item;

  IF employees_count = 0 THEN
    result_value := jsonb_build_object(
      'journalEntryId', NULL, 'employeesProcessed', 0,
      'totalAccrual', 0, 'status', 'completed'
    );
    UPDATE public.eosb_accrual_runs SET
      status = 'completed', result = result_value, completed_at = now()
    WHERE id = run_row.id;
    RETURN result_value;
  END IF;

  SELECT jsonb_agg(line ORDER BY employee_id, line_order) INTO lines_value
  FROM (
    SELECT (item->>'employee_id')::uuid AS employee_id, 1 AS line_order,
      jsonb_build_object(
        'account_id', settings_row.default_eosb_expense_id,
        'debit', (item->>'monthly_accrual')::numeric, 'credit', 0,
        'description', 'EOSB accrual ' || (item->>'employee_name') || ' - ' || month_text,
        'employee_id', item->>'employee_id'
      ) AS line
    FROM jsonb_array_elements(accrual_rows_value) item
    UNION ALL
    SELECT (item->>'employee_id')::uuid, 2,
      jsonb_build_object(
        'account_id', settings_row.default_eosb_provision_id,
        'debit', 0, 'credit', (item->>'monthly_accrual')::numeric,
        'description', 'EOSB provision ' || (item->>'employee_name') || ' - ' || month_text,
        'employee_id', item->>'employee_id'
      )
    FROM jsonb_array_elements(accrual_rows_value) item
  ) journal_lines;

  SELECT * INTO journal_row FROM public.accounting_save_journal(
    p_org_id, p_actor_user_id, p_command_id, p_request_id, NULL, 0,
    jsonb_build_object(
      'entryDate', month_end,
      'description', 'EOSB accrual - ' || month_text,
      'notes', 'Atomic EOSB accrual for ' || employees_count || ' employees',
      'sourceModule', 'eosb', 'sourceId', p_command_id,
      'status', 'posted', 'lines', lines_value
    )
  );

  INSERT INTO public.eosb_accruals (
    organization_id, employee_id, month, years_of_service, daily_rate,
    monthly_accrual, cumulative_accrual, journal_entry_id
  )
  SELECT p_org_id, (item->>'employee_id')::uuid, month_text,
    (item->>'years_of_service')::numeric, (item->>'daily_rate')::numeric,
    (item->>'monthly_accrual')::numeric, (item->>'cumulative_accrual')::numeric,
    journal_row.id
  FROM jsonb_array_elements(accrual_rows_value) item;

  result_value := jsonb_build_object(
    'journalEntryId', journal_row.id, 'employeesProcessed', employees_count,
    'totalAccrual', total_value, 'status', 'completed'
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'accounting.eosb_accrual_posted', 'eosb_accrual_runs', run_row.id::text,
    'success', 201, jsonb_build_object(
      'month', month_text, 'journal_entry_id', journal_row.id,
      'employees_processed', employees_count, 'total_accrual', total_value
    )
  );
  UPDATE public.eosb_accrual_runs SET
    status = 'completed', journal_entry_id = journal_row.id,
    employees_processed = employees_count, total_accrual = total_value,
    result = result_value, completed_at = now()
  WHERE id = run_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.run_eosb_accrual(uuid, uuid, uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_eosb_accrual(uuid, uuid, uuid, uuid, date)
  TO service_role;

COMMENT ON FUNCTION public.run_eosb_accrual(uuid, uuid, uuid, uuid, date) IS
  'Atomically posts one monthly EOSB journal and its per-employee accrual ledger with natural-month replay protection.';
