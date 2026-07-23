-- Phase 9: Intercompany transactions and consolidation.

------------------------------------------------------------
-- 1. Intercompany agreements
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_intercompany_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  to_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  agreement_type text NOT NULL CHECK (agreement_type IN ('service', 'loan', 'cost_sharing', 'management_fee', 'royalty', 'transfer_pricing')),
  name_ar text NOT NULL,
  name_en text,
  description text,
  frequency text CHECK (frequency IN ('monthly', 'quarterly', 'annually', 'on_demand')),
  amount numeric(20,2),
  currency_code text NOT NULL DEFAULT 'SAR',
  from_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_intercompany_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_ic_agreements_select ON public.accounting_intercompany_agreements
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 2. Intercompany transactions
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_intercompany_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agreement_id uuid REFERENCES public.accounting_intercompany_agreements(id) ON DELETE SET NULL,
  from_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  to_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  amount numeric(20,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  description text,
  from_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  to_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'confirmed', 'disputed', 'cancelled')),
  confirmed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_intercompany_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_ic_transactions_select ON public.accounting_intercompany_transactions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. Intercompany balances
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_intercompany_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  to_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  receivable_amount numeric(20,2) NOT NULL DEFAULT 0,
  payable_amount numeric(20,2) NOT NULL DEFAULT 0,
  net_amount numeric(20,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'SAR',
  is_reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, from_entity_id, to_entity_id, as_of_date)
);

ALTER TABLE public.accounting_intercompany_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_ic_balances_select ON public.accounting_intercompany_balances
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. Consolidation groups
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_consolidation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  parent_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  consolidation_currency text NOT NULL DEFAULT 'SAR',
  method text NOT NULL DEFAULT 'full' CHECK (method IN ('full', 'proportional', 'equity')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_consolidation_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_conso_groups_select ON public.accounting_consolidation_groups
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_consolidation_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.accounting_consolidation_groups(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  ownership_percent numeric(5,2) NOT NULL DEFAULT 100,
  consolidation_method text NOT NULL DEFAULT 'full' CHECK (consolidation_method IN ('full', 'proportional', 'equity', 'excluded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, entity_id)
);

ALTER TABLE public.accounting_consolidation_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_conso_members_select ON public.accounting_consolidation_group_members
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Consolidation runs
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_consolidation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.accounting_consolidation_groups(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  consolidation_date date NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'approved', 'published')),
  elimination_journal_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  translation_journal_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  minority_interest numeric(20,2),
  total_assets numeric(20,2),
  total_equity numeric(20,2),
  total_revenue numeric(20,2),
  net_income numeric(20,2),
  run_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_consolidation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_conso_runs_select ON public.accounting_consolidation_runs
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Elimination entries (IC eliminations)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_elimination_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.accounting_consolidation_groups(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  elimination_type text NOT NULL CHECK (elimination_type IN ('ic_receivable_payable', 'ic_revenue_expense', 'ic_investment', 'ic_dividend', 'unrealized_profit')),
  from_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  is_auto boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_elimination_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_elimination_rules_select ON public.accounting_elimination_rules
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Expand commands for intercompany/consolidation
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
  'budget_control_rule_save',
  'tax_code_save', 'vat_return_save', 'vat_return_file',
  'zatca_submit', 'zatca_device_save',
  'withholding_certificate_save',
  'ic_agreement_save', 'ic_transaction_save', 'ic_transaction_confirm',
  'consolidation_group_save', 'consolidation_run_start', 'consolidation_run_approve',
  'elimination_rule_save'
));
