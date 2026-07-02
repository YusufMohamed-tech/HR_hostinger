-- =============================================================================
-- V43: Financial Reporting Module
-- Budget tables, cash flow classification, reporting indexes, materialized view
-- =============================================================================

-- 1. Add cash_flow_category to accounting_accounts
ALTER TABLE accounting_accounts
  ADD COLUMN IF NOT EXISTS cash_flow_category TEXT;

COMMENT ON COLUMN accounting_accounts.cash_flow_category IS 'Cash flow classification: operating, investing, financing, or NULL';

-- 2. Budget tables
CREATE TABLE IF NOT EXISTS accounting_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'closed')),
  created_by UUID REFERENCES profiles(user_id),
  approved_by UUID REFERENCES profiles(user_id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name, fiscal_year)
);

CREATE TABLE IF NOT EXISTS accounting_budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id UUID NOT NULL REFERENCES accounting_budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID REFERENCES accounting_cost_centers(id),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(budget_id, account_id, cost_center_id, month)
);

-- 3. Reporting indexes
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_date
  ON accounting_journal_lines(account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_journal_lines_cost_center
  ON accounting_journal_lines(cost_center_id) WHERE cost_center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_posted_org_date
  ON accounting_journal_entries(organization_id, entry_date) WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS idx_journal_entries_status_org
  ON accounting_journal_entries(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_status_date
  ON accounting_invoices(organization_id, status, invoice_date);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_date
  ON accounting_invoices(organization_id, customer_id, invoice_date);

CREATE INDEX IF NOT EXISTS idx_expenses_status_date
  ON accounting_expenses(organization_id, status, expense_date);

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_date
  ON accounting_expenses(organization_id, vendor_id, expense_date);

CREATE INDEX IF NOT EXISTS idx_payments_type_date
  ON accounting_payments(organization_id, type, payment_date);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget
  ON accounting_budget_lines(budget_id, account_id, month);

-- 4. RLS for budget tables
ALTER TABLE accounting_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_budget_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_select" ON accounting_budgets
  FOR SELECT USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager', 'accountant', 'finance_viewer'))
  );

CREATE POLICY "budget_insert" ON accounting_budgets
  FOR INSERT WITH CHECK (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager', 'accountant'))
  );

CREATE POLICY "budget_update" ON accounting_budgets
  FOR UPDATE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager', 'accountant'))
  );

CREATE POLICY "budget_delete" ON accounting_budgets
  FOR DELETE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager'))
  );

CREATE POLICY "budget_lines_select" ON accounting_budget_lines
  FOR SELECT USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager', 'accountant', 'finance_viewer'))
  );

CREATE POLICY "budget_lines_insert" ON accounting_budget_lines
  FOR INSERT WITH CHECK (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager', 'accountant'))
  );

CREATE POLICY "budget_lines_update" ON accounting_budget_lines
  FOR UPDATE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager', 'accountant'))
  );

CREATE POLICY "budget_lines_delete" ON accounting_budget_lines
  FOR DELETE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR EXISTS (SELECT 1 FROM org_members WHERE org_id = organization_id AND user_id = auth.uid() AND role IN ('admin', 'finance_manager'))
  );

-- 5. Materialized view for monthly account balances (for fast reporting)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_account_balances AS
SELECT
  je.organization_id,
  jl.account_id,
  DATE_TRUNC('month', je.entry_date)::date AS period,
  SUM(jl.debit) AS total_debit,
  SUM(jl.credit) AS total_credit,
  SUM(jl.debit - jl.credit) AS net_movement
FROM accounting_journal_lines jl
JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
WHERE je.status IN ('posted', 'reversed')
GROUP BY je.organization_id, jl.account_id, DATE_TRUNC('month', je.entry_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_account_balances_pk
  ON mv_account_balances(organization_id, account_id, period);

-- 6. Financial transactions unified view
CREATE OR REPLACE VIEW financial_transactions AS
SELECT
  je.id,
  je.organization_id AS org_id,
  je.entry_date AS transaction_date,
  CASE
    WHEN je.source_module = 'invoice' THEN 'invoice_issued'
    WHEN je.source_module = 'expense' THEN 'expense_accrual'
    WHEN je.source_module = 'expense_paid' THEN 'expense_payment'
    WHEN je.source_module = 'payroll' THEN 'salary_accrual'
    WHEN je.source_module = 'payment_customer_receipt' THEN 'customer_receipt'
    WHEN je.source_module = 'payment_vendor_payment' THEN 'vendor_payment'
    WHEN je.source_module = 'payment_payroll_payment' THEN 'payroll_payment'
    WHEN je.source_module = 'payment_employee_advance' THEN 'advance_disbursement'
    WHEN je.source_module = 'payment_manual' THEN 'manual_payment'
    WHEN je.source_module = 'sales_log' THEN 'sales_revenue'
    WHEN je.source_module = 'reversal' THEN 'journal_reversed'
    WHEN je.source_module = 'manual' THEN 'journal_posted'
    ELSE je.source_module
  END AS transaction_type,
  CASE
    WHEN je.source_module IN ('payment_customer_receipt', 'sales_log') THEN 'inflow'
    WHEN je.source_module IN ('payment_vendor_payment', 'payment_payroll_payment', 'payment_employee_advance', 'expense_paid') THEN 'outflow'
    WHEN je.source_module IN ('invoice', 'expense', 'payroll') THEN 'obligation'
    ELSE 'adjustment'
  END AS direction,
  je.total_debit AS amount,
  je.currency,
  je.status,
  je.source_module,
  je.source_id,
  je.description,
  je.created_by,
  je.created_at
FROM accounting_journal_entries je
WHERE je.status IN ('posted', 'reversed');
