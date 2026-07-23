-- Phase 3: GL workflows, approvals, recurring journals, recognition schedules,
-- opening balances, and period close checklists.

------------------------------------------------------------
-- 1. Journal header extensions
------------------------------------------------------------

ALTER TABLE public.accounting_journal_entries
  ADD COLUMN IF NOT EXISTS document_date date,
  ADD COLUMN IF NOT EXISTS posting_date date,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS auto_reverse_on date,
  ADD COLUMN IF NOT EXISTS recurrence_source_id uuid,
  ADD COLUMN IF NOT EXISTS approval_policy_id uuid,
  ADD COLUMN IF NOT EXISTS risk_flags text[];

------------------------------------------------------------
-- 2. Approval policies
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  document_type text NOT NULL CHECK (document_type IN ('journal', 'payment', 'expense', 'invoice', 'budget', 'write_off', 'period_reopen')),
  min_amount numeric(20,2),
  max_amount numeric(20,2),
  currency_code text,
  source_module text,
  branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  required_steps integer NOT NULL DEFAULT 1 CHECK (required_steps >= 1),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name_ar)
);

ALTER TABLE public.accounting_approval_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_approval_policies_select ON public.accounting_approval_policies
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 3. Approval requests and steps
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.accounting_approval_policies(id) ON DELETE CASCADE,
  policy_version integer NOT NULL DEFAULT 1,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  current_step integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  submitted_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_approval_requests_select ON public.accounting_approval_requests
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.accounting_approval_policies(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number >= 1),
  required_capability text NOT NULL DEFAULT 'accounting.journal.approve',
  required_approver_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, step_number)
);

ALTER TABLE public.accounting_approval_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_approval_steps_select ON public.accounting_approval_steps
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.accounting_approval_requests(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject', 'return')),
  actor_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_approval_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_approval_decisions_select ON public.accounting_approval_decisions
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 4. Recurring journal templates and schedules
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_recurring_journal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  description text,
  branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  book_id uuid REFERENCES public.accounting_books(id) ON DELETE SET NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_recurring_journal_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_recurring_templates_select ON public.accounting_recurring_journal_templates
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_recurring_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.accounting_recurring_journal_templates(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE CASCADE,
  debit numeric(20,2) NOT NULL DEFAULT 0,
  credit numeric(20,2) NOT NULL DEFAULT 0,
  description text,
  cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_recurring_journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_recurring_lines_select ON public.accounting_recurring_journal_lines
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.accounting_recurring_journal_templates(id) ON DELETE CASCADE,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
  start_date date NOT NULL,
  end_date date,
  next_run_date date NOT NULL,
  auto_submit boolean NOT NULL DEFAULT false,
  auto_post boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_recurring_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_recurring_schedules_select ON public.accounting_recurring_schedules
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_recurring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.accounting_recurring_schedules(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, run_date)
);

ALTER TABLE public.accounting_recurring_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_recurring_runs_select ON public.accounting_recurring_runs
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 5. Recognition schedules (accruals, prepayments, deferred revenue)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_recognition_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  schedule_type text NOT NULL CHECK (schedule_type IN ('accrual', 'prepayment', 'deferred_revenue')),
  source_document_type text,
  source_document_id uuid,
  total_amount numeric(20,2) NOT NULL,
  recognized_amount numeric(20,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(20,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  debit_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  credit_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  recognition_method text NOT NULL DEFAULT 'straight_line' CHECK (recognition_method IN ('straight_line', 'custom')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'terminated', 'completed')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_recognition_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_recognition_schedules_select ON public.accounting_recognition_schedules
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_recognition_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.accounting_recognition_schedules(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_date date NOT NULL,
  amount numeric(20,2) NOT NULL,
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, period_date)
);

ALTER TABLE public.accounting_recognition_schedule_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_recognition_lines_select ON public.accounting_recognition_schedule_lines
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 6. Opening balance imports
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_opening_balance_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  batch_type text NOT NULL CHECK (batch_type IN ('trial_balance', 'customer_items', 'vendor_items', 'asset_register', 'bank_positions', 'historical_journals')),
  name text NOT NULL,
  as_of_date date NOT NULL,
  total_debit numeric(20,2) NOT NULL DEFAULT 0,
  total_credit numeric(20,2) NOT NULL DEFAULT 0,
  row_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'approved', 'posted', 'locked', 'rejected')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_opening_balance_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_opening_batches_select ON public.accounting_opening_balance_batches
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 7. Period close checklists
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_close_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_close_checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_close_templates_select ON public.accounting_close_checklist_templates
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  period_id uuid REFERENCES public.accounting_periods(id) ON DELETE SET NULL,
  checklist_template_id uuid REFERENCES public.accounting_close_checklist_templates(id) ON DELETE SET NULL,
  close_type text NOT NULL CHECK (close_type IN ('soft', 'hard')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
  started_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_close_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_close_runs_select ON public.accounting_close_runs
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_close_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_run_id uuid NOT NULL REFERENCES public.accounting_close_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_order integer NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped', 'exception')),
  assignee_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  completed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  completed_at timestamptz,
  exception_reason text,
  exception_approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_close_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_close_tasks_select ON public.accounting_close_tasks
  FOR SELECT USING (organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

------------------------------------------------------------
-- 8. Extend accounting periods with close states
------------------------------------------------------------

ALTER TABLE public.accounting_periods
  ADD COLUMN IF NOT EXISTS close_type text CHECK (close_type IN ('soft', 'hard')),
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopen_reason text,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

------------------------------------------------------------
-- 9. Expand commands for GL workflow actions
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
  'close_run_start', 'close_task_complete', 'close_run_complete'
));
