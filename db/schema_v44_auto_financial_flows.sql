-- schema_v44_auto_financial_flows.sql
-- Automatic Financial Flows: schema changes for all phases

-- =============================================================================
-- Settings: Auto-posting toggles and new default account references
-- =============================================================================
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_sales boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_payroll boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_advances boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_assets boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_eosb boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_gosi_payable_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_eosb_expense_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_eosb_provision_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_leave_encashment_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_allowances_expense_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_gosi_expense_id uuid REFERENCES accounting_accounts(id);

-- =============================================================================
-- Asset Inventory: depreciation support columns
-- =============================================================================
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS purchase_price numeric(14,2) DEFAULT 0;
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS useful_life_months integer DEFAULT 60;
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS salvage_value numeric(14,2) DEFAULT 0;
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS depreciation_method text DEFAULT 'straight_line';
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS capitalized_journal_id uuid REFERENCES accounting_journal_entries(id);
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS last_depreciation_date date;

-- =============================================================================
-- Employees: EOSB-related columns
-- =============================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_type text; -- 'resignation', 'termination', 'end_of_contract'

-- =============================================================================
-- EOSB Accruals tracking table
-- =============================================================================
CREATE TABLE IF NOT EXISTS eosb_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  month text NOT NULL,
  years_of_service numeric(5,2) NOT NULL,
  daily_rate numeric(14,2) NOT NULL,
  monthly_accrual numeric(14,2) NOT NULL,
  cumulative_accrual numeric(14,2) NOT NULL,
  journal_entry_id uuid REFERENCES accounting_journal_entries(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, employee_id, month)
);

ALTER TABLE eosb_accruals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eosb_accruals_select" ON eosb_accruals
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "eosb_accruals_insert" ON eosb_accruals
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
        AND role IN ('admin', 'hr_admin', 'finance_manager', 'accountant')
    )
  );

-- =============================================================================
-- Advance requests: link to journal entry
-- =============================================================================
ALTER TABLE advance_requests ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES accounting_journal_entries(id);

-- =============================================================================
-- Payslips: add GOSI columns for tracking
-- =============================================================================
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_gosi numeric(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employer_gosi numeric(14,2) DEFAULT 0;

-- =============================================================================
-- Seed new accounts (idempotent via ON CONFLICT)
-- These will be created per-org via the auto-posting initialization
-- =============================================================================
