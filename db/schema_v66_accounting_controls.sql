-- Atomic budgets, controlled period reopen, and a source-to-ledger reconciliation control.

ALTER TABLE public.accounting_budgets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_budgets
  ADD CONSTRAINT accounting_budgets_version_check CHECK (version >= 0);

ALTER TABLE public.accounting_commands DROP CONSTRAINT IF EXISTS accounting_commands_action_check;
ALTER TABLE public.accounting_commands ADD CONSTRAINT accounting_commands_action_check CHECK (action IN (
  'journal_create', 'journal_update', 'journal_post', 'journal_reverse',
  'invoice_create', 'invoice_update', 'invoice_issue',
  'expense_create', 'expense_update', 'expense_approve', 'expense_reject',
  'payment_create', 'payment_update', 'payment_post',
  'period_close', 'period_reopen', 'budget_create', 'budget_update', 'budget_approve'
));

DROP POLICY IF EXISTS "budget_insert" ON public.accounting_budgets;
DROP POLICY IF EXISTS "budget_update" ON public.accounting_budgets;
DROP POLICY IF EXISTS "budget_delete" ON public.accounting_budgets;
DROP POLICY IF EXISTS "budget_lines_insert" ON public.accounting_budget_lines;
DROP POLICY IF EXISTS "budget_lines_update" ON public.accounting_budget_lines;
DROP POLICY IF EXISTS "budget_lines_delete" ON public.accounting_budget_lines;

CREATE OR REPLACE FUNCTION public.accounting_save_budget(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_budget_id uuid, p_expected_version integer, p_payload jsonb
)
RETURNS SETOF public.accounting_budgets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  budget_row public.accounting_budgets%ROWTYPE;
  actor_role_value text;
  action_value text := CASE WHEN p_budget_id IS NULL THEN 'budget_create' ELSE 'budget_update' END;
  lines jsonb := COALESCE(p_payload->'lines', '[]'::jsonb);
  name_value text := NULLIF(btrim(p_payload->>'name'), '');
  fiscal_year_value integer := (p_payload->>'fiscalYear')::integer;
  hash_value text := encode(digest(jsonb_build_object(
    'budget_id', p_budget_id, 'expected_version', p_expected_version, 'payload', p_payload
  )::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('finance_manager', 'accountant');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Accounting management access is required.' USING ERRCODE = '42501'; END IF;
  IF name_value IS NULL OR fiscal_year_value NOT BETWEEN 1900 AND 2500 OR jsonb_typeof(lines) <> 'array' THEN
    RAISE EXCEPTION 'Budget input is invalid.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(lines) line
    LEFT JOIN public.accounting_accounts account
      ON account.organization_id = p_org_id AND account.id = NULLIF(line->>'accountId', '')::uuid
    LEFT JOIN public.accounting_cost_centers center
      ON center.organization_id = p_org_id AND center.id = NULLIF(line->>'costCenterId', '')::uuid
    WHERE account.id IS NULL
      OR COALESCE((line->>'month')::integer, 0) NOT BETWEEN 1 AND 12
      OR COALESCE((line->>'amount')::numeric, -1) < 0
      OR COALESCE((line->>'amount')::numeric, -1) <> round(COALESCE((line->>'amount')::numeric, -1), 2)
      OR (NULLIF(line->>'costCenterId', '') IS NOT NULL AND center.id IS NULL)
  ) THEN RAISE EXCEPTION 'A budget line has an invalid account, cost center, month, or amount.' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.accounting_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, action_value, p_budget_id, hash_value, p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> action_value OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_budgets
    WHERE organization_id = p_org_id AND id = command_row.entity_id;
    RETURN;
  END IF;

  IF p_budget_id IS NULL THEN
    INSERT INTO public.accounting_budgets (
      organization_id, name, fiscal_year, status, created_by, version, updated_at
    ) VALUES (
      p_org_id, name_value, fiscal_year_value, 'draft', p_actor_user_id, 0, now()
    ) RETURNING * INTO budget_row;
  ELSE
    SELECT * INTO budget_row FROM public.accounting_budgets
    WHERE organization_id = p_org_id AND id = p_budget_id FOR UPDATE;
    IF budget_row.id IS NULL THEN RAISE EXCEPTION 'Budget was not found.' USING ERRCODE = 'P0002'; END IF;
    IF budget_row.status <> 'draft' OR budget_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'Budget state or version conflict.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.accounting_budgets SET name = name_value, fiscal_year = fiscal_year_value,
      version = version + 1, updated_at = now()
    WHERE id = budget_row.id RETURNING * INTO budget_row;
    DELETE FROM public.accounting_budget_lines WHERE budget_id = budget_row.id;
  END IF;

  INSERT INTO public.accounting_budget_lines (
    organization_id, budget_id, account_id, cost_center_id, month, amount, notes
  )
  SELECT p_org_id, budget_row.id, (line->>'accountId')::uuid,
    NULLIF(line->>'costCenterId', '')::uuid, (line->>'month')::integer,
    round((line->>'amount')::numeric, 2), NULLIF(btrim(line->>'notes'), '')
  FROM jsonb_array_elements(lines) line;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'accounting.' || action_value, 'accounting_budgets', budget_row.id::text,
    'success', CASE WHEN p_budget_id IS NULL THEN 201 ELSE 200 END,
    jsonb_build_object('name', budget_row.name, 'fiscal_year', budget_row.fiscal_year,
      'line_count', jsonb_array_length(lines), 'version', budget_row.version)
  );
  UPDATE public.accounting_commands SET entity_id = budget_row.id, status = 'completed', completed_at = now(),
    result = jsonb_build_object('budget_id', budget_row.id, 'status', budget_row.status, 'version', budget_row.version)
  WHERE id = command_row.id;
  RETURN NEXT budget_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_approve_budget(
  p_org_id uuid, p_budget_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer
)
RETURNS SETOF public.accounting_budgets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  budget_row public.accounting_budgets%ROWTYPE;
  hash_value text := encode(digest(jsonb_build_object(
    'budget_id', p_budget_id, 'expected_version', p_expected_version
  )::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id
      AND user_id = p_actor_user_id AND role::text = 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.accounting_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, 'budget_approve', p_budget_id, hash_value, p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'budget_approve' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_budgets WHERE organization_id = p_org_id AND id = p_budget_id;
    RETURN;
  END IF;
  SELECT * INTO budget_row FROM public.accounting_budgets
  WHERE organization_id = p_org_id AND id = p_budget_id FOR UPDATE;
  IF budget_row.id IS NULL THEN RAISE EXCEPTION 'Budget was not found.' USING ERRCODE = 'P0002'; END IF;
  IF budget_row.status <> 'draft' OR budget_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Budget state or version conflict.' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounting_budget_lines WHERE budget_id = budget_row.id) THEN
    RAISE EXCEPTION 'A budget requires at least one line before approval.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.accounting_budgets SET status = 'approved', approved_by = p_actor_user_id,
    approved_at = now(), version = version + 1, updated_at = now()
  WHERE id = budget_row.id RETURNING * INTO budget_row;
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, 'finance_manager', 'accounting.budget_approved',
    'accounting_budgets', budget_row.id::text, 'success', 200,
    jsonb_build_object('name', budget_row.name, 'fiscal_year', budget_row.fiscal_year, 'version', budget_row.version)
  );
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('budget_id', budget_row.id, 'status', budget_row.status, 'version', budget_row.version)
  WHERE id = command_row.id;
  RETURN NEXT budget_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_reopen_period(
  p_org_id uuid, p_period_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer, p_reason text
)
RETURNS SETOF public.accounting_periods
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  period_row public.accounting_periods%ROWTYPE;
  hash_value text := encode(digest(jsonb_build_object(
    'period_id', p_period_id, 'expected_version', p_expected_version, 'reason', NULLIF(btrim(p_reason), '')
  )::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id
      AND user_id = p_actor_user_id AND role::text = 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'A reopen reason is required.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.accounting_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, 'period_reopen', p_period_id, hash_value, p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'period_reopen' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_periods WHERE organization_id = p_org_id AND id = p_period_id;
    RETURN;
  END IF;
  SELECT * INTO period_row FROM public.accounting_periods
  WHERE organization_id = p_org_id AND id = p_period_id FOR UPDATE;
  IF period_row.id IS NULL THEN RAISE EXCEPTION 'Accounting period was not found.' USING ERRCODE = 'P0002'; END IF;
  IF period_row.status <> 'closed' OR period_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Accounting period state or version conflict.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_periods WHERE organization_id = p_org_id
      AND start_date > period_row.start_date AND status = 'closed') THEN
    RAISE EXCEPTION 'Later closed periods must be reopened first.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.accounting_periods SET status = 'open', closed_by = NULL, closed_at = NULL,
    version = version + 1 WHERE id = period_row.id RETURNING * INTO period_row;
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, 'finance_manager', 'accounting.period_reopened',
    'accounting_periods', period_row.id::text, 'success', 200,
    jsonb_build_object('name', period_row.name, 'reason', btrim(p_reason), 'version', period_row.version)
  );
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('period_id', period_row.id, 'status', period_row.status, 'version', period_row.version)
  WHERE id = command_row.id;
  RETURN NEXT period_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_reconciliation_report(
  p_org_id uuid, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH journal_lines AS (
    SELECT entry.id, COALESCE(sum(line.debit), 0) debit, COALESCE(sum(line.credit), 0) credit
    FROM public.accounting_journal_entries entry
    LEFT JOIN public.accounting_journal_lines line ON line.journal_entry_id = entry.id
    WHERE entry.organization_id = p_org_id AND entry.status IN ('posted', 'reversed')
      AND (p_date_from IS NULL OR entry.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR entry.entry_date <= p_date_to)
    GROUP BY entry.id
  ), journal_control AS (
    SELECT count(*)::integer checked,
      count(*) FILTER (WHERE entry.total_debit <> entry.total_credit
        OR entry.total_debit <> lines.debit OR entry.total_credit <> lines.credit)::integer issues,
      COALESCE(sum(lines.debit - lines.credit), 0) variance
    FROM public.accounting_journal_entries entry JOIN journal_lines lines ON lines.id = entry.id
    WHERE entry.organization_id = p_org_id AND entry.status IN ('posted', 'reversed')
  ), invoice_payments AS (
    SELECT invoice_id, COALESCE(sum(amount), 0) paid FROM public.accounting_payments
    WHERE organization_id = p_org_id AND status = 'posted' AND invoice_id IS NOT NULL GROUP BY invoice_id
  ), invoice_control AS (
    SELECT count(*)::integer checked,
      count(*) FILTER (WHERE invoice.paid_amount <> COALESCE(payment.paid, 0)
        OR invoice.balance_due <> invoice.total_amount - COALESCE(payment.paid, 0))::integer issues,
      COALESCE(sum(invoice.balance_due - (invoice.total_amount - COALESCE(payment.paid, 0))), 0) variance
    FROM public.accounting_invoices invoice LEFT JOIN invoice_payments payment ON payment.invoice_id = invoice.id
    WHERE invoice.organization_id = p_org_id AND invoice.status NOT IN ('draft', 'cancelled', 'void')
      AND (p_date_from IS NULL OR invoice.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR invoice.invoice_date <= p_date_to)
  ), expense_payments AS (
    SELECT expense_id, COALESCE(sum(amount), 0) paid FROM public.accounting_payments
    WHERE organization_id = p_org_id AND status = 'posted' AND expense_id IS NOT NULL GROUP BY expense_id
  ), expense_control AS (
    SELECT count(*)::integer checked,
      count(*) FILTER (WHERE COALESCE(payment.paid, 0) > expense.total_amount
        OR (expense.status = 'paid' AND COALESCE(payment.paid, 0) <> expense.total_amount)
        OR (expense.paid_status = 'unpaid' AND COALESCE(payment.paid, 0) <> 0))::integer issues,
      COALESCE(sum(GREATEST(COALESCE(payment.paid, 0) - expense.total_amount, 0)), 0) variance
    FROM public.accounting_expenses expense LEFT JOIN expense_payments payment ON payment.expense_id = expense.id
    WHERE expense.organization_id = p_org_id AND expense.status NOT IN ('draft', 'rejected', 'cancelled')
      AND (p_date_from IS NULL OR expense.expense_date >= p_date_from)
      AND (p_date_to IS NULL OR expense.expense_date <= p_date_to)
  ), payroll_control AS (
    SELECT count(*)::integer checked,
      count(*) FILTER (WHERE journal.id IS NULL
        OR journal.total_debit <> run.total_net + run.total_employee_gosi + run.total_employer_gosi + advance.total
        OR journal.total_credit <> run.total_net + run.total_employee_gosi + run.total_employer_gosi + advance.total
        OR (run.status = 'paid' AND payment.total <> run.total_net))::integer issues,
      COALESCE(sum(
        run.total_net + run.total_employee_gosi + run.total_employer_gosi + advance.total - COALESCE(journal.total_debit, 0)
        + CASE WHEN run.status = 'paid' THEN run.total_net - payment.total ELSE 0 END
      ), 0) variance
    FROM public.payroll_runs run
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(advance_deduction), 0) total FROM public.payslips WHERE payroll_run_id = run.id
    ) advance ON true
    LEFT JOIN public.accounting_source_postings posting ON posting.organization_id = p_org_id
      AND posting.source_module = 'payroll' AND posting.source_id = run.id AND posting.status = 'posted'
    LEFT JOIN public.accounting_journal_entries journal ON journal.id = posting.journal_entry_id AND journal.status = 'posted'
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(amount), 0) total FROM public.accounting_payments
      WHERE organization_id = p_org_id AND payroll_id = run.id AND status = 'posted'
    ) payment ON true
    WHERE run.org_id = p_org_id AND run.status IN ('approved', 'paid')
      AND (p_date_from IS NULL OR run.month >= date_trunc('month', p_date_from)::date)
      AND (p_date_to IS NULL OR run.month <= date_trunc('month', p_date_to)::date)
  ), advance_installments AS (
    SELECT advance_request_id,
      COALESCE(sum(amount) FILTER (WHERE status NOT IN ('consumed', 'waived')), 0) remaining
    FROM public.advance_installments WHERE organization_id = p_org_id GROUP BY advance_request_id
  ), advance_control AS (
    SELECT count(*)::integer checked,
      count(*) FILTER (WHERE request.outstanding_amount <> COALESCE(installment.remaining, 0)
        OR balance.amount IS DISTINCT FROM request.outstanding_amount
        OR payment.status IS DISTINCT FROM 'posted')::integer issues,
      COALESCE(sum(request.outstanding_amount - COALESCE(installment.remaining, 0)), 0) variance
    FROM public.advance_requests request
    LEFT JOIN advance_installments installment ON installment.advance_request_id = request.id
    LEFT JOIN public.financial_balances balance ON balance.advance_request_id = request.id
    LEFT JOIN public.accounting_payments payment ON payment.id = request.payment_id
    WHERE request.organization_id = p_org_id AND request.status IN ('disbursed', 'repaying', 'repaid')
  ), controls AS (
    SELECT journal_control.checked journal_checked, journal_control.issues journal_issues, journal_control.variance journal_variance,
      invoice_control.checked invoice_checked, invoice_control.issues invoice_issues, invoice_control.variance invoice_variance,
      expense_control.checked expense_checked, expense_control.issues expense_issues, expense_control.variance expense_variance,
      payroll_control.checked payroll_checked, payroll_control.issues payroll_issues, payroll_control.variance payroll_variance,
      advance_control.checked advance_checked, advance_control.issues advance_issues, advance_control.variance advance_variance
    FROM journal_control, invoice_control, expense_control, payroll_control, advance_control
  )
  SELECT jsonb_build_object(
    'organizationId', p_org_id, 'dateFrom', p_date_from, 'dateTo', p_date_to,
    'generatedAt', now(),
    'isReconciled', journal_issues + invoice_issues + expense_issues + payroll_issues + advance_issues = 0,
    'issueCount', journal_issues + invoice_issues + expense_issues + payroll_issues + advance_issues,
    'journals', jsonb_build_object('checked', journal_checked, 'issues', journal_issues, 'variance', journal_variance),
    'invoices', jsonb_build_object('checked', invoice_checked, 'issues', invoice_issues, 'variance', invoice_variance),
    'expenses', jsonb_build_object('checked', expense_checked, 'issues', expense_issues, 'variance', expense_variance),
    'payroll', jsonb_build_object('checked', payroll_checked, 'issues', payroll_issues, 'variance', payroll_variance),
    'advances', jsonb_build_object('checked', advance_checked, 'issues', advance_issues, 'variance', advance_variance)
  ) FROM controls
$$;

REVOKE ALL ON FUNCTION public.accounting_save_budget(uuid, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_approve_budget(uuid, uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_reopen_period(uuid, uuid, uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_reconciliation_report(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_save_budget(uuid, uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_approve_budget(uuid, uuid, uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_reopen_period(uuid, uuid, uuid, uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_reconciliation_report(uuid, date, date) TO service_role;
