-- Phase 10: Reporting engine, governed views, data imports, audit log views.

------------------------------------------------------------
-- 1. Report definitions (configurable report library)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  category text NOT NULL CHECK (category IN ('financial', 'management', 'tax', 'regulatory', 'operational', 'custom')),
  report_type text NOT NULL CHECK (report_type IN ('trial_balance', 'profit_loss', 'balance_sheet', 'cash_flow', 'general_ledger', 'aging', 'budget_variance', 'custom_query')),
  description text,
  parameters jsonb NOT NULL DEFAULT '{}',
  layout jsonb NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_report_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_report_defs_select ON public.accounting_report_definitions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 2. Report schedules (automated delivery)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_definition_id uuid NOT NULL REFERENCES public.accounting_report_definitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
  delivery_method text NOT NULL CHECK (delivery_method IN ('email', 'download', 'sftp', 'api_webhook')),
  recipients jsonb NOT NULL DEFAULT '[]',
  parameters jsonb NOT NULL DEFAULT '{}',
  output_format text NOT NULL DEFAULT 'pdf' CHECK (output_format IN ('pdf', 'xlsx', 'csv', 'json')),
  next_run_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_report_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_report_schedules_select ON public.accounting_report_schedules
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. Report runs (execution history)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_definition_id uuid NOT NULL REFERENCES public.accounting_report_definitions(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.accounting_report_schedules(id) ON DELETE SET NULL,
  parameters jsonb NOT NULL DEFAULT '{}',
  output_format text NOT NULL DEFAULT 'pdf',
  file_url text,
  file_size_bytes integer,
  row_count integer,
  execution_time_ms integer,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message text,
  run_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.accounting_report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_report_runs_select ON public.accounting_report_runs
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. Governed views (role-scoped data access)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_governed_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description text,
  base_table text NOT NULL,
  allowed_columns text[] NOT NULL DEFAULT '{}',
  filter_conditions jsonb NOT NULL DEFAULT '{}',
  required_role text NOT NULL DEFAULT 'Finance_Viewer',
  required_entity_scope boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_governed_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_governed_views_select ON public.accounting_governed_views
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Data import definitions
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_import_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  target_table text NOT NULL,
  column_mapping jsonb NOT NULL DEFAULT '{}',
  validation_rules jsonb NOT NULL DEFAULT '{}',
  default_values jsonb NOT NULL DEFAULT '{}',
  file_format text NOT NULL DEFAULT 'csv' CHECK (file_format IN ('csv', 'xlsx', 'json', 'xml')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_import_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_import_defs_select ON public.accounting_import_definitions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Data import runs
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_definition_id uuid REFERENCES public.accounting_import_definitions(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_url text,
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validating', 'validated', 'importing', 'completed', 'failed', 'cancelled')),
  errors jsonb DEFAULT '[]',
  run_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.accounting_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_import_runs_select ON public.accounting_import_runs
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Audit log views (searchable accounting audit trail)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_audit_log_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  actor_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  actor_name text,
  changes jsonb,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_audit_log_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_audit_log_select ON public.accounting_audit_log_views
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.accounting_audit_log_views(organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.accounting_audit_log_views(organization_id, actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON public.accounting_audit_log_views(organization_id, created_at DESC);

------------------------------------------------------------
-- 8. Dashboard widgets (configurable)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  widget_type text NOT NULL CHECK (widget_type IN ('kpi', 'chart', 'table', 'alert', 'shortcut')),
  title_ar text NOT NULL,
  title_en text,
  config jsonb NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  size text NOT NULL DEFAULT 'medium' CHECK (size IN ('small', 'medium', 'large', 'full')),
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_dashboard_widgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_widgets_select ON public.accounting_dashboard_widgets
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 9. Final command constraint (complete set)
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
  'elimination_rule_save',
  'report_definition_save', 'report_schedule_save', 'report_run',
  'import_definition_save', 'import_run',
  'governed_view_save', 'dashboard_widget_save'
));
