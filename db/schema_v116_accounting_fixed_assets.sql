-- Phase 5: Fixed assets – lifecycle, depreciation, revaluation, disposal.

------------------------------------------------------------
-- 1. Asset categories
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  parent_id uuid REFERENCES public.accounting_asset_categories(id) ON DELETE SET NULL,
  asset_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  depreciation_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  accumulated_depreciation_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  disposal_gain_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  disposal_loss_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  default_useful_life_months integer,
  default_depreciation_method text DEFAULT 'straight_line' CHECK (default_depreciation_method IN ('straight_line', 'declining_balance', 'double_declining', 'sum_of_years', 'units_of_production')),
  default_salvage_rate numeric(5,2) DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_asset_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_asset_categories_select ON public.accounting_asset_categories
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 2. Fixed asset register
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.accounting_asset_categories(id) ON DELETE SET NULL,
  asset_number text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description text,
  serial_number text,
  barcode text,
  location text,
  custodian_employee_id uuid,
  acquisition_date date NOT NULL,
  in_service_date date,
  acquisition_cost numeric(20,2) NOT NULL,
  salvage_value numeric(20,2) NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL,
  depreciation_method text NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line', 'declining_balance', 'double_declining', 'sum_of_years', 'units_of_production')),
  depreciation_start_date date,
  accumulated_depreciation numeric(20,2) NOT NULL DEFAULT 0,
  net_book_value numeric(20,2) NOT NULL,
  current_value numeric(20,2),
  currency_code text NOT NULL DEFAULT 'SAR',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'fully_depreciated', 'disposed', 'impaired', 'suspended')),
  disposal_date date,
  disposal_amount numeric(20,2),
  disposal_method text CHECK (disposal_method IN ('sale', 'scrap', 'donation', 'write_off', 'transfer')),
  disposal_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  purchase_invoice_id uuid,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  warranty_expiry_date date,
  insurance_policy text,
  insurance_expiry_date date,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_number)
);

ALTER TABLE public.accounting_fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_fixed_assets_select ON public.accounting_fixed_assets
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON public.accounting_fixed_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON public.accounting_fixed_assets(organization_id, status);

------------------------------------------------------------
-- 3. Depreciation schedules (per-asset plan)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_depreciation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.accounting_fixed_assets(id) ON DELETE CASCADE,
  period_date date NOT NULL,
  amount numeric(20,2) NOT NULL,
  accumulated_amount numeric(20,2) NOT NULL,
  remaining_value numeric(20,2) NOT NULL,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'posted', 'skipped', 'adjusted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_date)
);

ALTER TABLE public.accounting_depreciation_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_depreciation_schedules_select ON public.accounting_depreciation_schedules
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. Depreciation runs (batch posting)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  asset_count integer NOT NULL DEFAULT 0,
  total_depreciation numeric(20,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed', 'failed')),
  run_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_depreciation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_depreciation_runs_select ON public.accounting_depreciation_runs
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Asset revaluations
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_asset_revaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.accounting_fixed_assets(id) ON DELETE CASCADE,
  revaluation_date date NOT NULL,
  previous_value numeric(20,2) NOT NULL,
  new_value numeric(20,2) NOT NULL,
  adjustment_amount numeric(20,2) NOT NULL,
  reason text,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_asset_revaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_asset_revaluations_select ON public.accounting_asset_revaluations
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Asset transfers
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_asset_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.accounting_fixed_assets(id) ON DELETE CASCADE,
  transfer_date date NOT NULL,
  from_branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  to_branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  from_location text,
  to_location text,
  from_custodian_id uuid,
  to_custodian_id uuid,
  reason text,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_asset_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_asset_transfers_select ON public.accounting_asset_transfers
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Asset maintenance
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_asset_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.accounting_fixed_assets(id) ON DELETE CASCADE,
  maintenance_date date NOT NULL,
  maintenance_type text NOT NULL CHECK (maintenance_type IN ('preventive', 'corrective', 'upgrade', 'inspection')),
  description text,
  cost numeric(20,2) NOT NULL DEFAULT 0,
  capitalize boolean NOT NULL DEFAULT false,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  next_maintenance_date date,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_asset_maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_asset_maintenance_select ON public.accounting_asset_maintenance
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 8. Expand commands for fixed asset actions
------------------------------------------------------------

ALTER TABLE public.accounting_commands DROP CONSTRAINT IF EXISTS accounting_commands_action_check;
ALTER TABLE public.accounting_commands ADD CONSTRAINT accounting_commands_action_check CHECK (action IN (
  'journal_create', 'journal_update', 'journal_post', 'journal_reverse', 'journal_cancel',
  'journal_submit', 'journal_approve', 'journal_reject',
  'invoice_create', 'invoice_update', 'invoice_issue',
  'expense_create', 'expense_update', 'expense_approve', 'expense_reject',
  'payment_create', 'payment_update', 'payment_post',
  'period_close', 'period_reopen', 'budget_create', 'budget_update', 'budget_approve',
  'master_save', 'master_deactivate',
  'entity_save', 'entity_status_change',
  'branch_save', 'branch_deactivate',
  'book_save', 'scope_save', 'scope_revoke',
  'currency_save', 'rate_save', 'rate_approve',
  'calendar_save',
  'dimension_type_save', 'dimension_value_save',
  'dimension_policy_save', 'allocation_rule_save',
  'account_template_save',
  'recurring_template_save', 'recurring_schedule_save',
  'recognition_schedule_save', 'recognition_run',
  'opening_balance_save', 'opening_balance_approve', 'opening_balance_post',
  'close_run_start', 'close_task_complete', 'close_run_complete',
  'bank_account_save', 'bank_statement_import',
  'reconciliation_start', 'reconciliation_match', 'reconciliation_complete',
  'cash_forecast_save', 'payment_batch_save', 'payment_batch_approve', 'payment_batch_send',
  'asset_category_save', 'asset_register', 'asset_activate',
  'asset_depreciation_run', 'asset_revalue', 'asset_transfer',
  'asset_dispose', 'asset_maintenance_save'
));
