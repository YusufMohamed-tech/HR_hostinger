-- Phase 6: AR, AP, nontrade receivables/payables, unified party model.

------------------------------------------------------------
-- 1. Unified party model (business partners)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer', 'vendor', 'employee', 'intercompany', 'government', 'other')),
  code text,
  name_ar text NOT NULL,
  name_en text,
  vat_number text,
  commercial_registration text,
  national_id text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text DEFAULT 'SA',
  bank_name text,
  iban text,
  swift_code text,
  payment_terms_days integer DEFAULT 30,
  credit_limit numeric(20,2),
  ar_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ap_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  linked_customer_id uuid REFERENCES public.accounting_customers(id) ON DELETE SET NULL,
  linked_vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  linked_employee_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_parties_select ON public.accounting_parties
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_parties_type ON public.accounting_parties(organization_id, party_type);

------------------------------------------------------------
-- 2. AR – Credit notes, debit notes, advance receipts
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  note_no text NOT NULL,
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.accounting_customers(id) ON DELETE SET NULL,
  original_invoice_id uuid REFERENCES public.accounting_invoices(id) ON DELETE SET NULL,
  note_date date NOT NULL,
  reason text,
  subtotal numeric(20,2) NOT NULL DEFAULT 0,
  vat_amount numeric(20,2) NOT NULL DEFAULT 0,
  total_amount numeric(20,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'SAR',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'applied', 'cancelled')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, note_no)
);

ALTER TABLE public.accounting_credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_credit_notes_select ON public.accounting_credit_notes
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_debit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  note_no text NOT NULL,
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  original_invoice_id uuid,
  note_date date NOT NULL,
  reason text,
  subtotal numeric(20,2) NOT NULL DEFAULT 0,
  vat_amount numeric(20,2) NOT NULL DEFAULT 0,
  total_amount numeric(20,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'SAR',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'applied', 'cancelled')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, note_no)
);

ALTER TABLE public.accounting_debit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_debit_notes_select ON public.accounting_debit_notes
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. Nontrade receivables / payables
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_nontrade_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('receivable', 'payable')),
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  description_ar text NOT NULL,
  description_en text,
  amount numeric(20,2) NOT NULL,
  outstanding_amount numeric(20,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  due_date date,
  account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_settled', 'settled', 'written_off', 'cancelled')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  reference text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_nontrade_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_nontrade_items_select ON public.accounting_nontrade_items
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. Payment allocations (receipt → invoice matching)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.accounting_payments(id) ON DELETE CASCADE,
  allocated_type text NOT NULL CHECK (allocated_type IN ('invoice', 'credit_note', 'debit_note', 'nontrade')),
  allocated_id uuid NOT NULL,
  amount numeric(20,2) NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL
);

ALTER TABLE public.accounting_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_payment_allocations_select ON public.accounting_payment_allocations
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Aging snapshots (materialized for performance)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_aging_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  aging_type text NOT NULL CHECK (aging_type IN ('ar', 'ap')),
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  current_amount numeric(20,2) NOT NULL DEFAULT 0,
  days_1_30 numeric(20,2) NOT NULL DEFAULT 0,
  days_31_60 numeric(20,2) NOT NULL DEFAULT 0,
  days_61_90 numeric(20,2) NOT NULL DEFAULT 0,
  days_91_120 numeric(20,2) NOT NULL DEFAULT 0,
  over_120 numeric(20,2) NOT NULL DEFAULT 0,
  total numeric(20,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_aging_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_aging_snapshots_select ON public.accounting_aging_snapshots
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_aging_snapshots_type ON public.accounting_aging_snapshots(organization_id, aging_type, snapshot_date DESC);

------------------------------------------------------------
-- 6. Dunning / collection follow-up
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_dunning_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  overdue_days_trigger integer NOT NULL DEFAULT 30,
  action_type text NOT NULL CHECK (action_type IN ('reminder', 'warning', 'suspension', 'legal')),
  template_text text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_dunning_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_dunning_policies_select ON public.accounting_dunning_policies
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_dunning_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.accounting_dunning_policies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.accounting_parties(id) ON DELETE CASCADE,
  action_date date NOT NULL,
  overdue_amount numeric(20,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'resolved')),
  notes text,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_dunning_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_dunning_actions_select ON public.accounting_dunning_actions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Expand commands for AR/AP actions
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
  'payment_allocate', 'dunning_action_create'
));
