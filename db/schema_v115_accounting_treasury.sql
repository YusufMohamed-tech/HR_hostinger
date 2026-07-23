-- Phase 4: Treasury, cash management, and bank reconciliation.

------------------------------------------------------------
-- 1. Bank accounts
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE CASCADE,
  bank_name_ar text NOT NULL,
  bank_name_en text,
  branch_name text,
  iban text,
  account_number text,
  swift_code text,
  currency_code text NOT NULL DEFAULT 'SAR',
  opening_balance numeric(20,2) NOT NULL DEFAULT 0,
  current_balance numeric(20,2) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, iban)
);

ALTER TABLE public.accounting_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_bank_accounts_select ON public.accounting_bank_accounts
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 2. Bank statements (imported feeds)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  opening_balance numeric(20,2) NOT NULL DEFAULT 0,
  closing_balance numeric(20,2) NOT NULL DEFAULT 0,
  total_debits numeric(20,2) NOT NULL DEFAULT 0,
  total_credits numeric(20,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  import_source text CHECK (import_source IN ('manual', 'csv', 'mt940', 'camt053', 'api')),
  file_url text,
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported', 'in_progress', 'reconciled', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_bank_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_bank_statements_select ON public.accounting_bank_statements
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. Bank statement lines (individual transactions)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL REFERENCES public.accounting_bank_statements(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  value_date date,
  amount numeric(20,2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  description text,
  reference text,
  counterparty_name text,
  counterparty_iban text,
  category text,
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'reconciled', 'excluded')),
  matched_payment_id uuid REFERENCES public.accounting_payments(id) ON DELETE SET NULL,
  matched_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_bank_statement_lines_select ON public.accounting_bank_statement_lines
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_statement ON public.accounting_bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_account ON public.accounting_bank_statement_lines(bank_account_id, transaction_date);

------------------------------------------------------------
-- 4. Bank reconciliations
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  statement_id uuid REFERENCES public.accounting_bank_statements(id) ON DELETE SET NULL,
  reconciliation_date date NOT NULL,
  statement_balance numeric(20,2) NOT NULL,
  book_balance numeric(20,2) NOT NULL,
  adjusted_book_balance numeric(20,2),
  difference numeric(20,2) NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'approved')),
  reconciled_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_bank_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_bank_reconciliations_select ON public.accounting_bank_reconciliations
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Reconciliation matches (many-to-many)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reconciliation_id uuid NOT NULL REFERENCES public.accounting_bank_reconciliations(id) ON DELETE CASCADE,
  statement_line_id uuid NOT NULL REFERENCES public.accounting_bank_statement_lines(id) ON DELETE CASCADE,
  matched_type text NOT NULL CHECK (matched_type IN ('payment', 'journal_entry', 'manual')),
  matched_record_id uuid,
  match_method text NOT NULL DEFAULT 'manual' CHECK (match_method IN ('auto_exact', 'auto_fuzzy', 'manual', 'rule_based')),
  confidence numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_reconciliation_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_reconciliation_matches_select ON public.accounting_reconciliation_matches
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Cash positions (treasury view)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_cash_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  position_date date NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  opening_balance numeric(20,2) NOT NULL DEFAULT 0,
  inflows numeric(20,2) NOT NULL DEFAULT 0,
  outflows numeric(20,2) NOT NULL DEFAULT 0,
  closing_balance numeric(20,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'SAR',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bank_account_id, position_date)
);

ALTER TABLE public.accounting_cash_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_cash_positions_select ON public.accounting_cash_positions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Cash forecasts
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_cash_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  forecast_date date NOT NULL,
  horizon_days integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_cash_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_cash_forecasts_select ON public.accounting_cash_forecasts
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_cash_forecast_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid NOT NULL REFERENCES public.accounting_cash_forecasts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  line_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('receivable', 'payable', 'payroll', 'tax', 'loan', 'capex', 'other_inflow', 'other_outflow')),
  description text,
  amount numeric(20,2) NOT NULL,
  probability numeric(5,2) DEFAULT 100,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_cash_forecast_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_cash_forecast_lines_select ON public.accounting_cash_forecast_lines
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 8. Payment batches (bulk payments)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.accounting_bank_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  payment_date date NOT NULL,
  total_amount numeric(20,2) NOT NULL DEFAULT 0,
  payment_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent_to_bank', 'processed', 'partially_processed', 'failed')),
  file_format text CHECK (file_format IN ('sarie', 'swift', 'csv', 'xml')),
  file_url text,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_payment_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_payment_batches_select ON public.accounting_payment_batches
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_payment_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.accounting_payment_batches(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.accounting_payments(id) ON DELETE SET NULL,
  beneficiary_name text NOT NULL,
  beneficiary_iban text,
  beneficiary_bank text,
  amount numeric(20,2) NOT NULL,
  reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'rejected')),
  bank_reference text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_payment_batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_payment_batch_items_select ON public.accounting_payment_batch_items
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 9. Expand commands for treasury actions
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
  'cash_forecast_save', 'payment_batch_save', 'payment_batch_approve', 'payment_batch_send'
));
