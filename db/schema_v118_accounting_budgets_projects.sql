-- Phase 7: Enhanced budgets, project accounting, commitments and encumbrances.

------------------------------------------------------------
-- 1. Budget versions and revisions
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_budget_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES public.accounting_budgets(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  name text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'superseded')),
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, version_number)
);

ALTER TABLE public.accounting_budget_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_budget_versions_select ON public.accounting_budget_versions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 2. Budget transfers
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_budget_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES public.accounting_budgets(id) ON DELETE CASCADE,
  transfer_date date NOT NULL,
  from_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  from_cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  to_cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  amount numeric(20,2) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_budget_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_budget_transfers_select ON public.accounting_budget_transfers
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. Projects
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description text,
  project_type text NOT NULL DEFAULT 'internal' CHECK (project_type IN ('internal', 'external', 'capital', 'grant')),
  customer_id uuid REFERENCES public.accounting_customers(id) ON DELETE SET NULL,
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  manager_id uuid,
  start_date date,
  end_date date,
  budget_amount numeric(20,2),
  consumed_amount numeric(20,2) NOT NULL DEFAULT 0,
  committed_amount numeric(20,2) NOT NULL DEFAULT 0,
  revenue_recognition_method text CHECK (revenue_recognition_method IN ('completed_contract', 'percentage_of_completion', 'time_and_materials')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_projects_select ON public.accounting_projects
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. Project tasks / WBS
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.accounting_projects(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES public.accounting_project_tasks(id) ON DELETE SET NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  budget_amount numeric(20,2),
  consumed_amount numeric(20,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_project_tasks_select ON public.accounting_project_tasks
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Commitments and encumbrances
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  commitment_type text NOT NULL CHECK (commitment_type IN ('purchase_order', 'contract', 'reservation')),
  reference_no text NOT NULL,
  description text,
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.accounting_projects(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  commitment_date date NOT NULL,
  expected_delivery_date date,
  original_amount numeric(20,2) NOT NULL,
  consumed_amount numeric(20,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(20,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_consumed', 'consumed', 'cancelled', 'expired')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference_no)
);

ALTER TABLE public.accounting_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_commitments_select ON public.accounting_commitments
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Commitment consumption (linked to actual invoices/expenses)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_commitment_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commitment_id uuid NOT NULL REFERENCES public.accounting_commitments(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('invoice', 'expense', 'journal', 'payment')),
  source_id uuid NOT NULL,
  amount numeric(20,2) NOT NULL,
  consumption_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_commitment_consumptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_commitment_consumptions_select ON public.accounting_commitment_consumptions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Budget control rules
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_budget_control_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  control_level text NOT NULL DEFAULT 'warning' CHECK (control_level IN ('none', 'warning', 'block')),
  threshold_percent numeric(5,2) NOT NULL DEFAULT 100,
  applies_to text NOT NULL DEFAULT 'expense' CHECK (applies_to IN ('expense', 'commitment', 'both')),
  check_scope text NOT NULL DEFAULT 'account' CHECK (check_scope IN ('account', 'cost_center', 'project', 'account_cost_center')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_budget_control_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_budget_control_rules_select ON public.accounting_budget_control_rules
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 8. Expand commands
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
  'asset_dispose', 'asset_maintenance_save',
  'party_save', 'credit_note_save', 'credit_note_issue',
  'debit_note_save', 'debit_note_issue',
  'nontrade_save', 'nontrade_settle', 'nontrade_write_off',
  'payment_allocate', 'dunning_action_create',
  'project_save', 'project_task_save',
  'commitment_save', 'commitment_consume', 'commitment_cancel',
  'budget_version_save', 'budget_transfer_save', 'budget_transfer_approve',
  'budget_control_rule_save'
));
