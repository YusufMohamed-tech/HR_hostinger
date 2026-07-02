-- schema_v45_auto_flow_fixes.sql
-- Bug fixes for auto-financial flows (Phase 1–7 hardening)

-- =============================================================================
-- accounting_source_postings: store error message for failed auto-posts
-- Allows admins to diagnose failures from the dashboard without trawling logs.
-- =============================================================================
ALTER TABLE accounting_source_postings ADD COLUMN IF NOT EXISTS error_message text;

-- =============================================================================
-- employee_assets: track how many months have been depreciated
-- Prevents over-depreciation after useful_life_months is exhausted.
-- =============================================================================
ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS months_depreciated integer NOT NULL DEFAULT 0;

-- Backfill months_depreciated for existing assets based on last_depreciation_date
-- and purchase_date (approximate). Assets without last_depreciation_date stay at 0.
UPDATE employee_assets
SET months_depreciated = GREATEST(0,
  EXTRACT(YEAR FROM AGE(last_depreciation_date, COALESCE(purchase_date, last_depreciation_date))) * 12 +
  EXTRACT(MONTH FROM AGE(last_depreciation_date, COALESCE(purchase_date, last_depreciation_date)))
)::integer
WHERE last_depreciation_date IS NOT NULL;

-- =============================================================================
-- payslips: ensure GOSI columns exist (also in v44, safe to repeat)
-- =============================================================================
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_gosi numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employer_gosi numeric(14,2) NOT NULL DEFAULT 0;

-- =============================================================================
-- accounting_settings: ensure all v44 auto-post columns exist (safe to repeat)
-- =============================================================================
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_sales boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_payroll boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_advances boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_assets boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_eosb boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_gosi_payable_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_gosi_expense_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_eosb_expense_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_eosb_provision_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_leave_encashment_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_allowances_expense_id uuid REFERENCES accounting_accounts(id);
