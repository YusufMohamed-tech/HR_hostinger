-- Atomic invoice, expense, payment, payroll-settlement, and period commands.

ALTER TABLE public.accounting_invoices ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_expenses ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_payments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_periods ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_invoices
  ADD CONSTRAINT accounting_invoices_version_check CHECK (version >= 0);
ALTER TABLE public.accounting_expenses
  ADD CONSTRAINT accounting_expenses_version_check CHECK (version >= 0);
ALTER TABLE public.accounting_payments
  ADD CONSTRAINT accounting_payments_version_check CHECK (version >= 0);
ALTER TABLE public.accounting_periods
  ADD CONSTRAINT accounting_periods_version_check CHECK (version >= 0);

ALTER TABLE public.accounting_commands DROP CONSTRAINT IF EXISTS accounting_commands_action_check;
ALTER TABLE public.accounting_commands ADD CONSTRAINT accounting_commands_action_check CHECK (action IN (
  'journal_create', 'journal_update', 'journal_post', 'journal_reverse',
  'invoice_create', 'invoice_update', 'invoice_issue',
  'expense_create', 'expense_update', 'expense_approve', 'expense_reject',
  'payment_create', 'payment_update', 'payment_post', 'period_close'
));

-- These indexes deliberately fail if historical financial duplicates exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_invoice_active_source
  ON public.accounting_invoices(organization_id, source_module, source_id)
  WHERE source_id IS NOT NULL AND status NOT IN ('cancelled', 'void');
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_payment_journal
  ON public.accounting_payments(organization_id, journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_payroll_payment_source
  ON public.accounting_payments(organization_id, payroll_id)
  WHERE type = 'payroll_payment' AND status <> 'cancelled' AND payroll_id IS NOT NULL;

-- Core financial documents are now writable only through service commands.
DROP POLICY IF EXISTS accounting_invoices_insert ON public.accounting_invoices;
DROP POLICY IF EXISTS accounting_invoices_update ON public.accounting_invoices;
DROP POLICY IF EXISTS accounting_invoices_delete ON public.accounting_invoices;
DROP POLICY IF EXISTS accounting_invoice_lines_insert ON public.accounting_invoice_lines;
DROP POLICY IF EXISTS accounting_invoice_lines_update ON public.accounting_invoice_lines;
DROP POLICY IF EXISTS accounting_invoice_lines_delete ON public.accounting_invoice_lines;
DROP POLICY IF EXISTS accounting_expenses_insert ON public.accounting_expenses;
DROP POLICY IF EXISTS accounting_expenses_update ON public.accounting_expenses;
DROP POLICY IF EXISTS accounting_expenses_delete ON public.accounting_expenses;
DROP POLICY IF EXISTS accounting_payments_insert ON public.accounting_payments;
DROP POLICY IF EXISTS accounting_payments_update ON public.accounting_payments;
DROP POLICY IF EXISTS accounting_payments_delete ON public.accounting_payments;
DROP POLICY IF EXISTS accounting_periods_insert ON public.accounting_periods;
DROP POLICY IF EXISTS accounting_periods_update ON public.accounting_periods;
DROP POLICY IF EXISTS accounting_periods_delete ON public.accounting_periods;

CREATE OR REPLACE FUNCTION public.accounting_child_command_id(p_parent uuid, p_scope text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (
    substring(md5(p_parent::text || ':' || p_scope), 1, 8) || '-' ||
    substring(md5(p_parent::text || ':' || p_scope), 9, 4) || '-5' ||
    substring(md5(p_parent::text || ':' || p_scope), 14, 3) || '-a' ||
    substring(md5(p_parent::text || ':' || p_scope), 18, 3) || '-' ||
    substring(md5(p_parent::text || ':' || p_scope), 21, 12)
  )::uuid
$$;

CREATE OR REPLACE FUNCTION public.accounting_protect_financial_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'accounting_invoice_lines' THEN
    SELECT status INTO parent_status FROM public.accounting_invoices
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    IF parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Issued invoice lines are immutable.' USING ERRCODE = '55000';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' AND (
    (TG_TABLE_NAME = 'accounting_invoices' AND OLD.status NOT IN ('draft', 'cancelled'))
    OR (TG_TABLE_NAME = 'accounting_expenses' AND OLD.status NOT IN ('draft', 'rejected', 'cancelled'))
    OR (TG_TABLE_NAME = 'accounting_payments' AND OLD.status = 'posted')
  ) THEN RAISE EXCEPTION 'Finalized financial documents cannot be deleted.' USING ERRCODE = '55000'; END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'accounting_invoices'
     AND OLD.status IN ('issued', 'partially_paid', 'paid', 'void') THEN
    IF ROW(NEW.organization_id, NEW.customer_id, NEW.invoice_no, NEW.invoice_date, NEW.due_date,
      NEW.source_module, NEW.source_id, NEW.subtotal, NEW.discount_amount, NEW.vat_amount,
      NEW.total_amount, NEW.currency, NEW.journal_entry_id)
       IS DISTINCT FROM
       ROW(OLD.organization_id, OLD.customer_id, OLD.invoice_no, OLD.invoice_date, OLD.due_date,
      OLD.source_module, OLD.source_id, OLD.subtotal, OLD.discount_amount, OLD.vat_amount,
      OLD.total_amount, OLD.currency, OLD.journal_entry_id) THEN
      RAISE EXCEPTION 'Issued invoice financial fields are immutable.' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'accounting_expenses'
     AND OLD.status IN ('approved', 'paid') THEN
    IF ROW(NEW.organization_id, NEW.expense_no, NEW.vendor_id, NEW.employee_id, NEW.expense_date,
      NEW.category_account_id, NEW.payment_account_id, NEW.cost_center_id, NEW.description,
      NEW.amount_before_vat, NEW.vat_amount, NEW.total_amount, NEW.journal_entry_id)
       IS DISTINCT FROM
       ROW(OLD.organization_id, OLD.expense_no, OLD.vendor_id, OLD.employee_id, OLD.expense_date,
      OLD.category_account_id, OLD.payment_account_id, OLD.cost_center_id, OLD.description,
      OLD.amount_before_vat, OLD.vat_amount, OLD.total_amount, OLD.journal_entry_id) THEN
      RAISE EXCEPTION 'Approved expense financial fields are immutable.' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS protect_accounting_invoice_trigger ON public.accounting_invoices;
CREATE TRIGGER protect_accounting_invoice_trigger BEFORE UPDATE OR DELETE ON public.accounting_invoices
  FOR EACH ROW EXECUTE FUNCTION public.accounting_protect_financial_document();
DROP TRIGGER IF EXISTS protect_accounting_invoice_lines_trigger ON public.accounting_invoice_lines;
CREATE TRIGGER protect_accounting_invoice_lines_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.accounting_protect_financial_document();
DROP TRIGGER IF EXISTS protect_accounting_expense_trigger ON public.accounting_expenses;
CREATE TRIGGER protect_accounting_expense_trigger BEFORE UPDATE OR DELETE ON public.accounting_expenses
  FOR EACH ROW EXECUTE FUNCTION public.accounting_protect_financial_document();

CREATE OR REPLACE FUNCTION public.accounting_save_invoice(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_invoice_id uuid, p_expected_version integer, p_payload jsonb
)
RETURNS SETOF public.accounting_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  invoice_row public.accounting_invoices%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  action_value text := CASE WHEN p_invoice_id IS NULL THEN 'invoice_create' ELSE 'invoice_update' END;
  hash_value text := encode(digest(jsonb_build_object('invoice_id', p_invoice_id, 'expected_version', p_expected_version, 'payload', p_payload)::text, 'sha256'), 'hex');
  actor_role_value text;
  invoice_date_value date := (p_payload->>'invoiceDate')::date;
  source_module_value text := COALESCE(NULLIF(btrim(p_payload->>'sourceModule'), ''), 'manual');
  source_id_value uuid := NULLIF(p_payload->>'sourceId', '')::uuid;
  subtotal_value numeric(14,2) := 0;
  discount_value numeric(14,2) := 0;
  vat_value numeric(14,2) := 0;
  total_value numeric(14,2) := 0;
  line_count integer;
  invalid_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id
    AND user_id = p_actor_user_id AND role::text IN ('finance_manager', 'accountant');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Accounting management access is required.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invoice lines must be an array.' USING ERRCODE = '22023'; END IF;
  IF NULLIF(p_payload->>'customerId', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounting_customers WHERE organization_id = p_org_id AND id = (p_payload->>'customerId')::uuid AND is_active
  ) THEN RAISE EXCEPTION 'Invoice customer must be active and belong to the organization.' USING ERRCODE = '23514'; END IF;

  SELECT count(*)::integer,
    count(*) FILTER (WHERE NULLIF(btrim(line->>'description_ar'), '') IS NULL
      OR COALESCE((line->>'quantity')::numeric, 0) <= 0
      OR COALESCE((line->>'unit_price')::numeric, 0) < 0
      OR COALESCE((line->>'discount_amount')::numeric, 0) < 0
      OR COALESCE((line->>'discount_amount')::numeric, 0) > round(COALESCE((line->>'quantity')::numeric, 0) * COALESCE((line->>'unit_price')::numeric, 0), 2))::integer
    INTO line_count, invalid_count
  FROM jsonb_array_elements(p_payload->'lines') line;
  IF invalid_count > 0 THEN RAISE EXCEPTION 'Invoice line amounts are invalid.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'lines') line
    WHERE NULLIF(line->>'tax_rate_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounting_tax_rates tax WHERE tax.organization_id = p_org_id
        AND tax.id = (line->>'tax_rate_id')::uuid AND tax.is_active
    )
  ) THEN RAISE EXCEPTION 'Invoice tax rate must be active and belong to the organization.' USING ERRCODE = '23514'; END IF;

  SELECT COALESCE(sum(round((line->>'quantity')::numeric * (line->>'unit_price')::numeric, 2)), 0),
    COALESCE(sum(round(COALESCE((line->>'discount_amount')::numeric, 0), 2)), 0),
    COALESCE(sum(round((round((line->>'quantity')::numeric * (line->>'unit_price')::numeric, 2)
      - round(COALESCE((line->>'discount_amount')::numeric, 0), 2)) * COALESCE(tax.rate, 0) / 100, 2)), 0)
    INTO subtotal_value, discount_value, vat_value
  FROM jsonb_array_elements(p_payload->'lines') line
  LEFT JOIN public.accounting_tax_rates tax ON tax.organization_id = p_org_id
    AND tax.id = NULLIF(line->>'tax_rate_id', '')::uuid;
  total_value := round(subtotal_value - discount_value + vat_value, 2);

  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, action_value, p_invoice_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> action_value OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.accounting_invoices WHERE organization_id = p_org_id AND id = command_row.entity_id; RETURN; END IF;

  IF p_invoice_id IS NULL THEN
    SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
    INSERT INTO public.accounting_invoices (organization_id, customer_id, invoice_no, invoice_date, due_date,
      source_module, source_id, subtotal, discount_amount, vat_amount, total_amount, balance_due,
      currency, notes, created_by, version)
    VALUES (p_org_id, NULLIF(p_payload->>'customerId', '')::uuid,
      public.next_accounting_document_number(p_org_id, 'invoice', COALESCE(settings_row.invoice_prefix, 'INV'), invoice_date_value),
      invoice_date_value, NULLIF(p_payload->>'dueDate', '')::date, source_module_value, source_id_value,
      subtotal_value, discount_value, vat_value, total_value, total_value, 'SAR',
      NULLIF(btrim(p_payload->>'notes'), ''), p_actor_user_id, 0)
    RETURNING * INTO invoice_row;
  ELSE
    SELECT * INTO invoice_row FROM public.accounting_invoices WHERE organization_id = p_org_id AND id = p_invoice_id FOR UPDATE;
    IF invoice_row.id IS NULL THEN RAISE EXCEPTION 'Invoice was not found.' USING ERRCODE = 'P0002'; END IF;
    IF invoice_row.status <> 'draft' THEN RAISE EXCEPTION 'Only draft invoices can be edited.' USING ERRCODE = '55000'; END IF;
    IF invoice_row.version <> p_expected_version THEN RAISE EXCEPTION 'Invoice version conflict.' USING ERRCODE = '40001'; END IF;
    IF source_module_value <> invoice_row.source_module OR source_id_value IS DISTINCT FROM invoice_row.source_id THEN RAISE EXCEPTION 'Invoice source cannot be changed.' USING ERRCODE = '23514'; END IF;
    UPDATE public.accounting_invoices SET customer_id = NULLIF(p_payload->>'customerId', '')::uuid,
      invoice_date = invoice_date_value, due_date = NULLIF(p_payload->>'dueDate', '')::date,
      subtotal = subtotal_value, discount_amount = discount_value, vat_amount = vat_value,
      total_amount = total_value, balance_due = total_value, notes = NULLIF(btrim(p_payload->>'notes'), ''),
      version = version + 1, updated_at = now()
    WHERE id = invoice_row.id RETURNING * INTO invoice_row;
    DELETE FROM public.accounting_invoice_lines WHERE organization_id = p_org_id AND invoice_id = invoice_row.id;
  END IF;

  INSERT INTO public.accounting_invoice_lines (organization_id, invoice_id, product_id, description_ar,
    description_en, quantity, unit_price, discount_amount, tax_rate_id, vat_amount, line_total,
    revenue_account_id, cost_center_id)
  SELECT p_org_id, invoice_row.id, NULLIF(line->>'product_id', '')::uuid, btrim(line->>'description_ar'),
    NULLIF(btrim(line->>'description_en'), ''), round((line->>'quantity')::numeric, 2),
    round((line->>'unit_price')::numeric, 2), round(COALESCE((line->>'discount_amount')::numeric, 0), 2),
    NULLIF(line->>'tax_rate_id', '')::uuid,
    round((round((line->>'quantity')::numeric * (line->>'unit_price')::numeric, 2)
      - round(COALESCE((line->>'discount_amount')::numeric, 0), 2)) * COALESCE(tax.rate, 0) / 100, 2),
    round((line->>'quantity')::numeric * (line->>'unit_price')::numeric, 2)
      - round(COALESCE((line->>'discount_amount')::numeric, 0), 2)
      + round((round((line->>'quantity')::numeric * (line->>'unit_price')::numeric, 2)
        - round(COALESCE((line->>'discount_amount')::numeric, 0), 2)) * COALESCE(tax.rate, 0) / 100, 2),
    NULLIF(line->>'revenue_account_id', '')::uuid, NULLIF(line->>'cost_center_id', '')::uuid
  FROM jsonb_array_elements(p_payload->'lines') line
  LEFT JOIN public.accounting_tax_rates tax ON tax.organization_id = p_org_id
    AND tax.id = NULLIF(line->>'tax_rate_id', '')::uuid;

  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    CASE WHEN p_invoice_id IS NULL THEN 'accounting.invoice_created' ELSE 'accounting.invoice_updated' END,
    'accounting_invoices', invoice_row.id::text, 'success', CASE WHEN p_invoice_id IS NULL THEN 201 ELSE 200 END,
    jsonb_build_object('invoice_no', invoice_row.invoice_no, 'total_amount', total_value, 'line_count', line_count, 'version', invoice_row.version));
  UPDATE public.accounting_commands SET entity_id = invoice_row.id, status = 'completed', completed_at = now(),
    result = jsonb_build_object('invoice_id', invoice_row.id, 'invoice_no', invoice_row.invoice_no, 'version', invoice_row.version)
  WHERE id = command_row.id;
  RETURN NEXT invoice_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_issue_invoice(
  p_org_id uuid, p_invoice_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer
)
RETURNS SETOF public.accounting_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  invoice_row public.accounting_invoices%ROWTYPE;
  journal_row public.accounting_journal_entries%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  actor_role_value text;
  hash_value text := encode(digest(jsonb_build_object('invoice_id', p_invoice_id, 'expected_version', p_expected_version)::text, 'sha256'), 'hex');
  journal_lines jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'invoice_issue', p_invoice_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'invoice_issue' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.accounting_invoices WHERE organization_id = p_org_id AND id = p_invoice_id; RETURN; END IF;
  SELECT * INTO invoice_row FROM public.accounting_invoices WHERE organization_id = p_org_id AND id = p_invoice_id FOR UPDATE;
  IF invoice_row.id IS NULL THEN RAISE EXCEPTION 'Invoice was not found.' USING ERRCODE = 'P0002'; END IF;
  IF invoice_row.status <> 'draft' OR invoice_row.total_amount <= 0 THEN RAISE EXCEPTION 'Only a non-empty draft invoice can be issued.' USING ERRCODE = '55000'; END IF;
  IF invoice_row.version <> p_expected_version THEN RAISE EXCEPTION 'Invoice version conflict.' USING ERRCODE = '40001'; END IF;
  SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
  IF settings_row.default_accounts_receivable_id IS NULL OR settings_row.default_sales_revenue_id IS NULL THEN RAISE EXCEPTION 'Receivable and sales revenue accounts are required.' USING ERRCODE = '23514'; END IF;
  IF invoice_row.vat_amount > 0 AND settings_row.default_vat_payable_id IS NULL THEN RAISE EXCEPTION 'VAT payable account is required.' USING ERRCODE = '23514'; END IF;
  SELECT jsonb_agg(item ORDER BY sort_order) INTO journal_lines FROM (
    SELECT 1 sort_order, jsonb_build_object('account_id', settings_row.default_accounts_receivable_id, 'debit', invoice_row.total_amount, 'credit', 0, 'description', invoice_row.invoice_no) item
    UNION ALL
    SELECT 2, jsonb_build_object('account_id', COALESCE(line.revenue_account_id, settings_row.default_sales_revenue_id), 'debit', 0,
      'credit', sum(line.line_total - line.vat_amount), 'description', invoice_row.invoice_no)
    FROM public.accounting_invoice_lines line WHERE line.organization_id = p_org_id AND line.invoice_id = invoice_row.id
    GROUP BY COALESCE(line.revenue_account_id, settings_row.default_sales_revenue_id)
    UNION ALL
    SELECT 3, jsonb_build_object('account_id', settings_row.default_vat_payable_id, 'debit', 0, 'credit', invoice_row.vat_amount, 'description', invoice_row.invoice_no)
    WHERE invoice_row.vat_amount > 0
  ) entries;
  SELECT * INTO journal_row FROM public.accounting_save_journal(p_org_id, p_actor_user_id,
    public.accounting_child_command_id(p_command_id, 'invoice-journal'), p_request_id, NULL, 0,
    jsonb_build_object('entryDate', invoice_row.invoice_date, 'description', 'Issue invoice ' || invoice_row.invoice_no,
      'sourceModule', 'invoice', 'sourceId', invoice_row.id, 'status', 'posted', 'lines', journal_lines));
  UPDATE public.accounting_invoices SET status = 'issued', issued_by = p_actor_user_id, issued_at = now(),
    journal_entry_id = journal_row.id, version = version + 1, updated_at = now()
  WHERE id = invoice_row.id RETURNING * INTO invoice_row;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'accounting.invoice_issued',
    'accounting_invoices', invoice_row.id::text, 'success', 200,
    jsonb_build_object('invoice_no', invoice_row.invoice_no, 'journal_entry_id', journal_row.id, 'version', invoice_row.version));
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('invoice_id', invoice_row.id, 'journal_entry_id', journal_row.id, 'version', invoice_row.version)
  WHERE id = command_row.id;
  RETURN NEXT invoice_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_save_expense(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_expense_id uuid, p_expected_version integer, p_payload jsonb
)
RETURNS SETOF public.accounting_expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  expense_row public.accounting_expenses%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  action_value text := CASE WHEN p_expense_id IS NULL THEN 'expense_create' ELSE 'expense_update' END;
  hash_value text := encode(digest(jsonb_build_object('expense_id', p_expense_id, 'expected_version', p_expected_version, 'payload', p_payload)::text, 'sha256'), 'hex');
  actor_role_value text;
  target_status text := COALESCE(NULLIF(p_payload->>'status', ''), 'draft');
  before_vat numeric(14,2) := round(COALESCE((p_payload->>'amountBeforeVat')::numeric, 0), 2);
  vat_value numeric(14,2) := round(COALESCE((p_payload->>'vatAmount')::numeric, 0), 2);
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('finance_manager', 'accountant');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Accounting management access is required.' USING ERRCODE = '42501'; END IF;
  IF target_status NOT IN ('draft', 'pending_approval') OR NULLIF(btrim(p_payload->>'description'), '') IS NULL
     OR before_vat < 0 OR vat_value < 0 OR before_vat + vat_value <= 0 THEN RAISE EXCEPTION 'Expense input is invalid.' USING ERRCODE = '23514'; END IF;
  IF NULLIF(p_payload->>'categoryAccountId', '') IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounting_accounts
    WHERE organization_id = p_org_id AND id = (p_payload->>'categoryAccountId')::uuid AND is_active AND type = 'expense') THEN
    RAISE EXCEPTION 'An active expense account is required.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, action_value, p_expense_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> action_value OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.accounting_expenses WHERE organization_id = p_org_id AND id = command_row.entity_id; RETURN; END IF;
  IF p_expense_id IS NULL THEN
    SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
    INSERT INTO public.accounting_expenses (organization_id, expense_no, vendor_id, employee_id, expense_date,
      category_account_id, payment_account_id, cost_center_id, description, amount_before_vat,
      vat_amount, total_amount, status, payment_method, attachment_url, created_by, version)
    VALUES (p_org_id, public.next_accounting_document_number(p_org_id, 'expense', COALESCE(settings_row.expense_prefix, 'EXP'), (p_payload->>'expenseDate')::date),
      NULLIF(p_payload->>'vendorId', '')::uuid, NULLIF(p_payload->>'employeeId', '')::uuid,
      (p_payload->>'expenseDate')::date, (p_payload->>'categoryAccountId')::uuid,
      NULLIF(p_payload->>'paymentAccountId', '')::uuid, NULLIF(p_payload->>'costCenterId', '')::uuid,
      btrim(p_payload->>'description'), before_vat, vat_value, before_vat + vat_value, target_status,
      NULLIF(btrim(p_payload->>'paymentMethod'), ''), NULLIF(btrim(p_payload->>'attachmentUrl'), ''), p_actor_user_id, 0)
    RETURNING * INTO expense_row;
  ELSE
    SELECT * INTO expense_row FROM public.accounting_expenses WHERE organization_id = p_org_id AND id = p_expense_id FOR UPDATE;
    IF expense_row.id IS NULL THEN RAISE EXCEPTION 'Expense was not found.' USING ERRCODE = 'P0002'; END IF;
    IF expense_row.status NOT IN ('draft', 'pending_approval') THEN RAISE EXCEPTION 'Only draft or pending expenses can be edited.' USING ERRCODE = '55000'; END IF;
    IF expense_row.version <> p_expected_version THEN RAISE EXCEPTION 'Expense version conflict.' USING ERRCODE = '40001'; END IF;
    UPDATE public.accounting_expenses SET vendor_id = NULLIF(p_payload->>'vendorId', '')::uuid,
      employee_id = NULLIF(p_payload->>'employeeId', '')::uuid, expense_date = (p_payload->>'expenseDate')::date,
      category_account_id = (p_payload->>'categoryAccountId')::uuid,
      payment_account_id = NULLIF(p_payload->>'paymentAccountId', '')::uuid,
      cost_center_id = NULLIF(p_payload->>'costCenterId', '')::uuid, description = btrim(p_payload->>'description'),
      amount_before_vat = before_vat, vat_amount = vat_value, total_amount = before_vat + vat_value,
      status = target_status, payment_method = NULLIF(btrim(p_payload->>'paymentMethod'), ''),
      attachment_url = NULLIF(btrim(p_payload->>'attachmentUrl'), ''), version = version + 1, updated_at = now()
    WHERE id = expense_row.id RETURNING * INTO expense_row;
  END IF;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    CASE WHEN p_expense_id IS NULL THEN 'accounting.expense_created' ELSE 'accounting.expense_updated' END,
    'accounting_expenses', expense_row.id::text, 'success', CASE WHEN p_expense_id IS NULL THEN 201 ELSE 200 END,
    jsonb_build_object('expense_no', expense_row.expense_no, 'total_amount', expense_row.total_amount, 'status', expense_row.status, 'version', expense_row.version));
  UPDATE public.accounting_commands SET entity_id = expense_row.id, status = 'completed', completed_at = now(),
    result = jsonb_build_object('expense_id', expense_row.id, 'expense_no', expense_row.expense_no, 'version', expense_row.version)
  WHERE id = command_row.id;
  RETURN NEXT expense_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_transition_expense(
  p_org_id uuid, p_expense_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer, p_action text, p_reason text DEFAULT NULL,
  p_paid_immediately boolean DEFAULT false
)
RETURNS SETOF public.accounting_expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  expense_row public.accounting_expenses%ROWTYPE;
  journal_row public.accounting_journal_entries%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  actor_role_value text;
  hash_value text := encode(digest(jsonb_build_object('expense_id', p_expense_id, 'expected_version', p_expected_version, 'action', p_action, 'reason', COALESCE(p_reason, ''), 'paid_immediately', p_paid_immediately)::text, 'sha256'), 'hex');
  command_action text;
  credit_account uuid;
  lines jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Unsupported expense action.' USING ERRCODE = '22023'; END IF;
  command_action := CASE WHEN p_action = 'approve' THEN 'expense_approve' ELSE 'expense_reject' END;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, command_action, p_expense_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> command_action OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.accounting_expenses WHERE organization_id = p_org_id AND id = p_expense_id; RETURN; END IF;
  SELECT * INTO expense_row FROM public.accounting_expenses WHERE organization_id = p_org_id AND id = p_expense_id FOR UPDATE;
  IF expense_row.id IS NULL THEN RAISE EXCEPTION 'Expense was not found.' USING ERRCODE = 'P0002'; END IF;
  IF expense_row.status NOT IN ('draft', 'pending_approval') THEN RAISE EXCEPTION 'Only draft or pending expenses can be reviewed.' USING ERRCODE = '55000'; END IF;
  IF expense_row.version <> p_expected_version THEN RAISE EXCEPTION 'Expense version conflict.' USING ERRCODE = '40001'; END IF;
  IF p_action = 'approve' THEN
    SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;
    credit_account := CASE WHEN p_paid_immediately THEN COALESCE(expense_row.payment_account_id, settings_row.default_bank_account_id, settings_row.default_cash_account_id) ELSE settings_row.default_accounts_payable_id END;
    IF credit_account IS NULL OR (expense_row.vat_amount > 0 AND settings_row.default_vat_receivable_id IS NULL) THEN RAISE EXCEPTION 'Expense posting accounts are incomplete.' USING ERRCODE = '23514'; END IF;
    lines := jsonb_build_array(jsonb_build_object('account_id', expense_row.category_account_id, 'debit', expense_row.amount_before_vat, 'credit', 0, 'description', expense_row.description, 'cost_center_id', expense_row.cost_center_id));
    IF expense_row.vat_amount > 0 THEN lines := lines || jsonb_build_array(jsonb_build_object('account_id', settings_row.default_vat_receivable_id, 'debit', expense_row.vat_amount, 'credit', 0, 'description', expense_row.description)); END IF;
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', credit_account, 'debit', 0, 'credit', expense_row.total_amount, 'description', expense_row.description, 'cost_center_id', expense_row.cost_center_id));
    SELECT * INTO journal_row FROM public.accounting_save_journal(p_org_id, p_actor_user_id,
      public.accounting_child_command_id(p_command_id, 'expense-journal'), p_request_id, NULL, 0,
      jsonb_build_object('entryDate', expense_row.expense_date, 'description', 'Approve expense ' || expense_row.expense_no,
        'sourceModule', CASE WHEN p_paid_immediately THEN 'expense_paid' ELSE 'expense' END,
        'sourceId', expense_row.id, 'status', 'posted', 'lines', lines));
    UPDATE public.accounting_expenses SET status = CASE WHEN p_paid_immediately THEN 'paid' ELSE 'approved' END,
      paid_status = CASE WHEN p_paid_immediately THEN 'paid' ELSE 'unpaid' END,
      approved_by = p_actor_user_id, approved_at = now(), paid_at = CASE WHEN p_paid_immediately THEN now() ELSE NULL END,
      journal_entry_id = journal_row.id, version = version + 1, updated_at = now()
    WHERE id = expense_row.id RETURNING * INTO expense_row;
  ELSE
    UPDATE public.accounting_expenses SET status = 'rejected', rejection_reason = NULLIF(btrim(p_reason), ''),
      version = version + 1, updated_at = now() WHERE id = expense_row.id RETURNING * INTO expense_row;
  END IF;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'accounting.expense_' || CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    'accounting_expenses', expense_row.id::text, 'success', 200,
    jsonb_build_object('expense_no', expense_row.expense_no, 'status', expense_row.status, 'journal_entry_id', journal_row.id, 'reason', NULLIF(btrim(p_reason), ''), 'version', expense_row.version));
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('expense_id', expense_row.id, 'status', expense_row.status, 'journal_entry_id', journal_row.id, 'version', expense_row.version)
  WHERE id = command_row.id;
  RETURN NEXT expense_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_save_payment(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_payment_id uuid, p_expected_version integer, p_post boolean, p_payload jsonb
)
RETURNS SETOF public.accounting_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  payment_row public.accounting_payments%ROWTYPE;
  invoice_row public.accounting_invoices%ROWTYPE;
  expense_row public.accounting_expenses%ROWTYPE;
  run_row public.payroll_runs%ROWTYPE;
  journal_row public.accounting_journal_entries%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  action_value text := CASE WHEN p_payment_id IS NULL THEN 'payment_create' WHEN p_post THEN 'payment_post' ELSE 'payment_update' END;
  hash_value text := encode(digest(jsonb_build_object('payment_id', p_payment_id, 'expected_version', p_expected_version, 'post', p_post, 'payload', p_payload)::text, 'sha256'), 'hex');
  actor_role_value text;
  type_value text := COALESCE(NULLIF(p_payload->>'type', ''), 'manual');
  direction_value text := COALESCE(NULLIF(p_payload->>'direction', ''), 'outbound');
  amount_value numeric(14,2) := round(COALESCE((p_payload->>'amount')::numeric, 0), 2);
  bank_account uuid;
  counterpart_account uuid;
  lines jsonb;
  already_paid numeric(14,2);
  remaining numeric(14,2);
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('finance_manager', 'accountant');
  IF actor_role_value IS NULL OR (p_post AND actor_role_value <> 'finance_manager') THEN RAISE EXCEPTION 'Required accounting access is missing.' USING ERRCODE = '42501'; END IF;
  IF type_value NOT IN ('customer_receipt', 'vendor_payment', 'payroll_payment', 'employee_advance', 'manual')
     OR direction_value NOT IN ('inbound', 'outbound') OR amount_value <= 0 THEN RAISE EXCEPTION 'Payment input is invalid.' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, action_value, p_payment_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> action_value OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.accounting_payments WHERE organization_id = p_org_id AND id = command_row.entity_id; RETURN; END IF;
  SELECT * INTO settings_row FROM public.accounting_settings WHERE organization_id = p_org_id;

  IF p_payment_id IS NULL THEN
    INSERT INTO public.accounting_payments (organization_id, payment_no, payment_date, type, direction, amount,
      currency, account_id, counterpart_account_id, cost_center_id, customer_id, vendor_id, employee_id,
      invoice_id, expense_id, advance_request_id, payroll_id, description, reference_no, method, notes,
      attachment_url, status, created_by, version)
    VALUES (p_org_id, public.next_accounting_document_number(p_org_id, 'payment', COALESCE(settings_row.payment_prefix, 'PAY'), (p_payload->>'paymentDate')::date),
      (p_payload->>'paymentDate')::date, type_value, direction_value, amount_value, 'SAR',
      COALESCE(NULLIF(p_payload->>'accountId', '')::uuid, settings_row.default_bank_account_id, settings_row.default_cash_account_id),
      NULLIF(p_payload->>'counterpartAccountId', '')::uuid, NULLIF(p_payload->>'costCenterId', '')::uuid,
      NULLIF(p_payload->>'customerId', '')::uuid, NULLIF(p_payload->>'vendorId', '')::uuid,
      NULLIF(p_payload->>'employeeId', '')::uuid, NULLIF(p_payload->>'invoiceId', '')::uuid,
      NULLIF(p_payload->>'expenseId', '')::uuid, NULLIF(p_payload->>'advanceRequestId', '')::uuid,
      NULLIF(p_payload->>'payrollId', '')::uuid, NULLIF(btrim(p_payload->>'description'), ''),
      NULLIF(btrim(p_payload->>'referenceNo'), ''), NULLIF(btrim(p_payload->>'method'), ''),
      NULLIF(btrim(p_payload->>'notes'), ''), NULLIF(btrim(p_payload->>'attachmentUrl'), ''),
      'draft', p_actor_user_id, 0)
    RETURNING * INTO payment_row;
  ELSE
    SELECT * INTO payment_row FROM public.accounting_payments WHERE organization_id = p_org_id AND id = p_payment_id FOR UPDATE;
    IF payment_row.id IS NULL THEN RAISE EXCEPTION 'Payment was not found.' USING ERRCODE = 'P0002'; END IF;
    IF payment_row.status <> 'draft' THEN RAISE EXCEPTION 'Only draft payments can be changed or posted.' USING ERRCODE = '55000'; END IF;
    IF payment_row.version <> p_expected_version THEN RAISE EXCEPTION 'Payment version conflict.' USING ERRCODE = '40001'; END IF;
    IF NOT p_post THEN
      UPDATE public.accounting_payments SET payment_date = (p_payload->>'paymentDate')::date,
        type = type_value, direction = direction_value, amount = amount_value,
        account_id = COALESCE(NULLIF(p_payload->>'accountId', '')::uuid, settings_row.default_bank_account_id, settings_row.default_cash_account_id),
        counterpart_account_id = NULLIF(p_payload->>'counterpartAccountId', '')::uuid,
        cost_center_id = NULLIF(p_payload->>'costCenterId', '')::uuid,
        customer_id = NULLIF(p_payload->>'customerId', '')::uuid, vendor_id = NULLIF(p_payload->>'vendorId', '')::uuid,
        employee_id = NULLIF(p_payload->>'employeeId', '')::uuid, invoice_id = NULLIF(p_payload->>'invoiceId', '')::uuid,
        expense_id = NULLIF(p_payload->>'expenseId', '')::uuid, advance_request_id = NULLIF(p_payload->>'advanceRequestId', '')::uuid,
        payroll_id = NULLIF(p_payload->>'payrollId', '')::uuid, description = NULLIF(btrim(p_payload->>'description'), ''),
        reference_no = NULLIF(btrim(p_payload->>'referenceNo'), ''), method = NULLIF(btrim(p_payload->>'method'), ''),
        notes = NULLIF(btrim(p_payload->>'notes'), ''), attachment_url = NULLIF(btrim(p_payload->>'attachmentUrl'), ''),
        version = version + 1, updated_at = now()
      WHERE id = payment_row.id RETURNING * INTO payment_row;
    END IF;
  END IF;

  IF p_post THEN
    bank_account := payment_row.account_id;
    counterpart_account := CASE payment_row.type
      WHEN 'customer_receipt' THEN settings_row.default_accounts_receivable_id
      WHEN 'vendor_payment' THEN settings_row.default_accounts_payable_id
      WHEN 'payroll_payment' THEN settings_row.default_salary_payable_id
      WHEN 'employee_advance' THEN settings_row.default_employee_advances_id
      ELSE payment_row.counterpart_account_id END;
    IF bank_account IS NULL OR counterpart_account IS NULL OR bank_account = counterpart_account THEN RAISE EXCEPTION 'Payment posting accounts are incomplete or invalid.' USING ERRCODE = '23514'; END IF;
    IF payment_row.type = 'manual' AND NULLIF(btrim(COALESCE(payment_row.description, payment_row.notes, '')), '') IS NULL THEN RAISE EXCEPTION 'Manual payment description is required.' USING ERRCODE = '23514'; END IF;

    IF payment_row.invoice_id IS NOT NULL THEN
      SELECT * INTO invoice_row FROM public.accounting_invoices WHERE organization_id = p_org_id AND id = payment_row.invoice_id FOR UPDATE;
      IF invoice_row.id IS NULL OR invoice_row.status NOT IN ('issued', 'partially_paid') OR payment_row.type <> 'customer_receipt'
         OR payment_row.amount > invoice_row.balance_due THEN RAISE EXCEPTION 'Invoice payment is invalid.' USING ERRCODE = '23514'; END IF;
    END IF;
    IF payment_row.expense_id IS NOT NULL THEN
      SELECT * INTO expense_row FROM public.accounting_expenses WHERE organization_id = p_org_id AND id = payment_row.expense_id FOR UPDATE;
      SELECT COALESCE(sum(amount), 0) INTO already_paid FROM public.accounting_payments WHERE organization_id = p_org_id
        AND expense_id = payment_row.expense_id AND status = 'posted' AND id <> payment_row.id;
      IF expense_row.id IS NULL OR expense_row.status NOT IN ('approved', 'paid') OR payment_row.type <> 'vendor_payment'
         OR payment_row.amount > expense_row.total_amount - already_paid THEN RAISE EXCEPTION 'Expense payment is invalid.' USING ERRCODE = '23514'; END IF;
    END IF;
    IF payment_row.payroll_id IS NOT NULL THEN
      SELECT * INTO run_row FROM public.payroll_runs WHERE org_id = p_org_id AND id = payment_row.payroll_id FOR UPDATE;
      IF run_row.id IS NULL OR run_row.status <> 'approved' OR payment_row.type <> 'payroll_payment'
         OR payment_row.amount <> run_row.total_net OR NOT EXISTS (
           SELECT 1 FROM public.accounting_source_postings
           WHERE organization_id = p_org_id AND source_module = 'payroll'
             AND source_id = run_row.id AND status = 'posted'
         ) THEN RAISE EXCEPTION 'Payroll payment must exactly settle a posted, approved payroll run.' USING ERRCODE = '23514'; END IF;
    END IF;

    lines := CASE WHEN payment_row.direction = 'inbound' THEN jsonb_build_array(
      jsonb_build_object('account_id', bank_account, 'debit', payment_row.amount, 'credit', 0, 'description', COALESCE(payment_row.description, payment_row.payment_no), 'cost_center_id', payment_row.cost_center_id),
      jsonb_build_object('account_id', counterpart_account, 'debit', 0, 'credit', payment_row.amount, 'description', COALESCE(payment_row.description, payment_row.payment_no), 'cost_center_id', payment_row.cost_center_id)
    ) ELSE jsonb_build_array(
      jsonb_build_object('account_id', counterpart_account, 'debit', payment_row.amount, 'credit', 0, 'description', COALESCE(payment_row.description, payment_row.payment_no), 'cost_center_id', payment_row.cost_center_id),
      jsonb_build_object('account_id', bank_account, 'debit', 0, 'credit', payment_row.amount, 'description', COALESCE(payment_row.description, payment_row.payment_no), 'cost_center_id', payment_row.cost_center_id)
    ) END;
    SELECT * INTO journal_row FROM public.accounting_save_journal(p_org_id, p_actor_user_id,
      public.accounting_child_command_id(p_command_id, 'payment-journal'), p_request_id, NULL, 0,
      jsonb_build_object('entryDate', payment_row.payment_date, 'description', 'Post payment ' || payment_row.payment_no,
        'sourceModule', 'payment_' || payment_row.type, 'sourceId', payment_row.id, 'status', 'posted', 'lines', lines));
    UPDATE public.accounting_payments SET status = 'posted', posted_by = p_actor_user_id, posted_at = now(),
      journal_entry_id = journal_row.id, version = version + 1, updated_at = now()
    WHERE id = payment_row.id RETURNING * INTO payment_row;
    IF invoice_row.id IS NOT NULL THEN
      UPDATE public.accounting_invoices SET paid_amount = paid_amount + payment_row.amount,
        balance_due = balance_due - payment_row.amount,
        status = CASE WHEN balance_due - payment_row.amount = 0 THEN 'paid' ELSE 'partially_paid' END,
        version = version + 1, updated_at = now() WHERE id = invoice_row.id;
    END IF;
    IF expense_row.id IS NOT NULL THEN
      remaining := round(expense_row.total_amount - already_paid - payment_row.amount, 2);
      UPDATE public.accounting_expenses SET paid_status = CASE WHEN remaining = 0 THEN 'paid' ELSE 'partially_paid' END,
        status = CASE WHEN remaining = 0 THEN 'paid' ELSE 'approved' END,
        paid_at = CASE WHEN remaining = 0 THEN now() ELSE NULL END, version = version + 1, updated_at = now()
      WHERE id = expense_row.id;
    END IF;
    IF run_row.id IS NOT NULL THEN
      UPDATE public.payslips SET status = 'paid', paid_by = p_actor_user_id, paid_at = now(), updated_at = now()
      WHERE payroll_run_id = run_row.id AND status = 'approved';
      UPDATE public.payroll_runs SET status = 'paid', paid_by = p_actor_user_id, paid_at = now(),
        version = version + 1, updated_at = now() WHERE id = run_row.id RETURNING * INTO run_row;
      event_payload := jsonb_build_object('event_type', 'payroll.run_paid', 'payroll_run_id', run_row.id,
        'month', run_row.month, 'version', run_row.version, 'payment_id', payment_row.id, 'amount', payment_row.amount);
      INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
        status, request_id, actor_user_id, occurred_at, processed_at)
      VALUES (p_org_id, 'payroll', run_row.id::text || ':paid:' || run_row.version::text, run_row.version,
        event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id,
        p_actor_user_id, now(), now()) RETURNING id INTO event_id;
      INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
      VALUES (p_org_id, event_id, 'payroll.run_paid', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
    END IF;
  END IF;

  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    CASE WHEN p_post THEN 'accounting.payment_posted' WHEN p_payment_id IS NULL THEN 'accounting.payment_created' ELSE 'accounting.payment_updated' END,
    'accounting_payments', payment_row.id::text, 'success', CASE WHEN p_payment_id IS NULL THEN 201 ELSE 200 END,
    jsonb_build_object('payment_no', payment_row.payment_no, 'type', payment_row.type, 'amount', payment_row.amount,
      'status', payment_row.status, 'journal_entry_id', journal_row.id, 'version', payment_row.version));
  UPDATE public.accounting_commands SET entity_id = payment_row.id, status = 'completed', completed_at = now(),
    result = jsonb_build_object('payment_id', payment_row.id, 'payment_no', payment_row.payment_no,
      'status', payment_row.status, 'journal_entry_id', journal_row.id, 'version', payment_row.version)
  WHERE id = command_row.id;
  RETURN NEXT payment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_close_period(
  p_org_id uuid, p_period_id uuid, p_actor_user_id uuid, p_command_id uuid,
  p_request_id uuid, p_expected_version integer
)
RETURNS SETOF public.accounting_periods
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  period_row public.accounting_periods%ROWTYPE;
  actor_role_value text;
  hash_value text := encode(digest(jsonb_build_object('period_id', p_period_id, 'expected_version', p_expected_version)::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.accounting_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'period_close', p_period_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'period_close' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for a different accounting command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.accounting_periods WHERE organization_id = p_org_id AND id = p_period_id; RETURN; END IF;
  SELECT * INTO period_row FROM public.accounting_periods WHERE organization_id = p_org_id AND id = p_period_id FOR UPDATE;
  IF period_row.id IS NULL THEN RAISE EXCEPTION 'Accounting period was not found.' USING ERRCODE = 'P0002'; END IF;
  IF period_row.status <> 'open' OR period_row.version <> p_expected_version THEN RAISE EXCEPTION 'Accounting period state or version conflict.' USING ERRCODE = '40001'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_journal_entries WHERE organization_id = p_org_id AND entry_date BETWEEN period_row.start_date AND period_row.end_date AND status IN ('draft', 'pending_approval'))
     OR EXISTS (SELECT 1 FROM public.accounting_invoices WHERE organization_id = p_org_id AND invoice_date BETWEEN period_row.start_date AND period_row.end_date AND status = 'draft')
     OR EXISTS (SELECT 1 FROM public.accounting_expenses WHERE organization_id = p_org_id AND expense_date BETWEEN period_row.start_date AND period_row.end_date AND status IN ('draft', 'pending_approval'))
     OR EXISTS (SELECT 1 FROM public.accounting_payments WHERE organization_id = p_org_id AND payment_date BETWEEN period_row.start_date AND period_row.end_date AND status = 'draft') THEN
    RAISE EXCEPTION 'Accounting period has unresolved draft documents.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.accounting_periods SET status = 'closed', closed_by = p_actor_user_id, closed_at = now(), version = version + 1
  WHERE id = period_row.id RETURNING * INTO period_row;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'accounting.period_closed',
    'accounting_periods', period_row.id::text, 'success', 200,
    jsonb_build_object('name', period_row.name, 'start_date', period_row.start_date, 'end_date', period_row.end_date, 'version', period_row.version));
  UPDATE public.accounting_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('period_id', period_row.id, 'status', period_row.status, 'version', period_row.version)
  WHERE id = command_row.id;
  RETURN NEXT period_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_child_command_id(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_save_invoice(uuid, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_issue_invoice(uuid, uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_save_expense(uuid, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_transition_expense(uuid, uuid, uuid, uuid, uuid, integer, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_save_payment(uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_close_period(uuid, uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_child_command_id(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_save_invoice(uuid, uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_issue_invoice(uuid, uuid, uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_save_expense(uuid, uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_transition_expense(uuid, uuid, uuid, uuid, uuid, integer, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_save_payment(uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_close_period(uuid, uuid, uuid, uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.accounting_save_payment(uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb) IS
  'Atomically creates/updates/posts a payment and settles its linked invoice, expense, or approved payroll run.';
