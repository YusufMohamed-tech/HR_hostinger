-- Phase 8: VAT management, ZATCA e-invoicing, withholding tax.

------------------------------------------------------------
-- 1. Tax codes (extended)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  tax_type text NOT NULL CHECK (tax_type IN ('vat', 'withholding', 'excise', 'customs', 'exempt', 'zero_rated', 'reverse_charge')),
  rate numeric(8,4) NOT NULL DEFAULT 0,
  is_inclusive boolean NOT NULL DEFAULT false,
  account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  reverse_charge_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  zatca_category_code text,
  zatca_exemption_reason_code text,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_tax_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_tax_codes_select ON public.accounting_tax_codes
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 2. VAT returns
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_vat_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  due_date date NOT NULL,
  standard_sales numeric(20,2) NOT NULL DEFAULT 0,
  zero_rated_sales numeric(20,2) NOT NULL DEFAULT 0,
  exempt_sales numeric(20,2) NOT NULL DEFAULT 0,
  output_vat numeric(20,2) NOT NULL DEFAULT 0,
  standard_purchases numeric(20,2) NOT NULL DEFAULT 0,
  import_purchases numeric(20,2) NOT NULL DEFAULT 0,
  input_vat numeric(20,2) NOT NULL DEFAULT 0,
  adjustments numeric(20,2) NOT NULL DEFAULT 0,
  net_vat numeric(20,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'filed', 'paid', 'amended')),
  filed_at timestamptz,
  payment_reference text,
  paid_at timestamptz,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  filed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_vat_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_vat_returns_select ON public.accounting_vat_returns
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. ZATCA e-invoice submissions
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_zatca_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.accounting_invoices(id) ON DELETE SET NULL,
  credit_note_id uuid REFERENCES public.accounting_credit_notes(id) ON DELETE SET NULL,
  debit_note_id uuid REFERENCES public.accounting_debit_notes(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN ('standard_invoice', 'simplified_invoice', 'credit_note', 'debit_note')),
  submission_type text NOT NULL DEFAULT 'reporting' CHECK (submission_type IN ('reporting', 'clearance')),
  invoice_hash text,
  qr_code text,
  xml_content text,
  zatca_uuid text,
  zatca_status text NOT NULL DEFAULT 'pending' CHECK (zatca_status IN ('pending', 'submitted', 'cleared', 'reported', 'rejected', 'warning')),
  zatca_response_code text,
  zatca_response_message text,
  zatca_warnings text[],
  submitted_at timestamptz,
  cleared_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_zatca_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_zatca_submissions_select ON public.accounting_zatca_submissions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. ZATCA device / CSR credentials
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_zatca_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  otp text,
  csr_common_name text,
  csr_serial_number text,
  compliance_request_id text,
  production_request_id text,
  certificate text,
  private_key_encrypted text,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'simulation', 'production')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'compliance_passed', 'production_ready', 'active', 'revoked')),
  last_sequence_number integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_zatca_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_zatca_devices_select ON public.accounting_zatca_devices
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Withholding tax certificates
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_withholding_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  certificate_no text NOT NULL,
  party_id uuid REFERENCES public.accounting_parties(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.accounting_payments(id) ON DELETE SET NULL,
  tax_code_id uuid REFERENCES public.accounting_tax_codes(id) ON DELETE SET NULL,
  gross_amount numeric(20,2) NOT NULL,
  withholding_rate numeric(8,4) NOT NULL,
  withholding_amount numeric(20,2) NOT NULL,
  net_amount numeric(20,2) NOT NULL,
  issue_date date NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'filed', 'cancelled')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, certificate_no)
);

ALTER TABLE public.accounting_withholding_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_withholding_certificates_select ON public.accounting_withholding_certificates
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Expand commands for VAT/ZATCA actions
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
  'withholding_certificate_save'
));
