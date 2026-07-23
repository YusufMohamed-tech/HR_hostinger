-- Phase 2: Chart of accounts extensions, generalized financial dimensions, and allocations.
-- Adds account control fields, entity/template model, dimension types/values/policies,
-- journal line dimensions, and allocation rules.

------------------------------------------------------------
-- 1. Account extensions
------------------------------------------------------------

ALTER TABLE public.accounting_accounts
  ADD COLUMN IF NOT EXISTS level integer,
  ADD COLUMN IF NOT EXISTS path text,
  ADD COLUMN IF NOT EXISTS sort_order integer,
  ADD COLUMN IF NOT EXISTS statement_group text,
  ADD COLUMN IF NOT EXISTS is_posting_account boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS control_type text NOT NULL DEFAULT 'none'
    CHECK (control_type IN ('none', 'customer', 'vendor', 'asset', 'bank', 'cash', 'employee', 'tax')),
  ADD COLUMN IF NOT EXISTS manual_posting_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS account_template_id uuid;

------------------------------------------------------------
-- 2. Account templates (workspace-level shared charts)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_account_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_account_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_account_templates_select ON public.accounting_account_templates
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.accounting_account_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.accounting_account_templates(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype text,
  parent_code text,
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  level integer,
  is_posting_account boolean NOT NULL DEFAULT true,
  control_type text NOT NULL DEFAULT 'none',
  statement_group text,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, code)
);

ALTER TABLE public.accounting_account_template_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_account_template_lines_select ON public.accounting_account_template_lines
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 3. Generalized dimension types
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_dimension_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  category text NOT NULL DEFAULT 'custom'
    CHECK (category IN ('branch', 'cost_center', 'profit_center', 'department', 'region', 'project', 'contract', 'product_line', 'employee', 'location', 'custom')),
  is_hierarchical boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_dimension_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_dimension_types_select ON public.accounting_dimension_types
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 4. Dimension values
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_dimension_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dimension_type_id uuid NOT NULL REFERENCES public.accounting_dimension_types(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  parent_id uuid REFERENCES public.accounting_dimension_values(id) ON DELETE SET NULL,
  reference_table text,
  reference_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dimension_type_id, code)
);

ALTER TABLE public.accounting_dimension_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_dimension_values_select ON public.accounting_dimension_values
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE INDEX idx_accounting_dimension_values_type
  ON public.accounting_dimension_values (organization_id, dimension_type_id, is_active);

------------------------------------------------------------
-- 5. Dimension policies (per-account dimension requirements)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_dimension_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE CASCADE,
  account_type text,
  dimension_type_id uuid NOT NULL REFERENCES public.accounting_dimension_types(id) ON DELETE CASCADE,
  requirement text NOT NULL DEFAULT 'optional' CHECK (requirement IN ('required', 'optional', 'blocked')),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_dimension_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_dimension_policies_select ON public.accounting_dimension_policies
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE INDEX idx_accounting_dimension_policies_account
  ON public.accounting_dimension_policies (organization_id, account_id, dimension_type_id);

------------------------------------------------------------
-- 6. Dimension combinations (valid/blocked value pairings)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_dimension_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  dimension_value_ids uuid[] NOT NULL,
  is_allowed boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_dimension_combinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_dimension_combinations_select ON public.accounting_dimension_combinations
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 7. Journal line dimensions (normalized per-line dimension values)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_journal_line_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_line_id uuid NOT NULL REFERENCES public.accounting_journal_lines(id) ON DELETE CASCADE,
  dimension_type_id uuid NOT NULL REFERENCES public.accounting_dimension_types(id) ON DELETE CASCADE,
  dimension_value_id uuid NOT NULL REFERENCES public.accounting_dimension_values(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journal_line_id, dimension_type_id)
);

ALTER TABLE public.accounting_journal_line_dimensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_journal_line_dimensions_select ON public.accounting_journal_line_dimensions
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE INDEX idx_accounting_jld_line
  ON public.accounting_journal_line_dimensions (journal_line_id);

CREATE INDEX idx_accounting_jld_dimension
  ON public.accounting_journal_line_dimensions (organization_id, dimension_type_id, dimension_value_id);

------------------------------------------------------------
-- 8. Allocation rules
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_allocation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  source_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  source_dimension_type_id uuid REFERENCES public.accounting_dimension_types(id) ON DELETE SET NULL,
  source_dimension_value_id uuid REFERENCES public.accounting_dimension_values(id) ON DELETE SET NULL,
  method text NOT NULL DEFAULT 'percentage' CHECK (method IN ('percentage', 'fixed', 'driver')),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'annually', 'on_demand')),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_allocation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_allocation_rules_select ON public.accounting_allocation_rules
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 9. Allocation rule lines (targets and weights)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_allocation_rule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.accounting_allocation_rules(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_dimension_type_id uuid REFERENCES public.accounting_dimension_types(id) ON DELETE SET NULL,
  target_dimension_value_id uuid REFERENCES public.accounting_dimension_values(id) ON DELETE SET NULL,
  target_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  weight numeric(10,4) NOT NULL DEFAULT 0 CHECK (weight >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_allocation_rule_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_allocation_rule_lines_select ON public.accounting_allocation_rule_lines
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 10. Allocation runs (execution log)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_allocation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.accounting_allocation_rules(id) ON DELETE CASCADE,
  rule_version integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  source_balance numeric(20,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
  journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  reversal_journal_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, rule_id, period_start, period_end)
);

ALTER TABLE public.accounting_allocation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_allocation_runs_select ON public.accounting_allocation_runs
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 11. Allocation driver values (for driver-based methods)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_allocation_driver_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.accounting_allocation_rules(id) ON DELETE CASCADE,
  dimension_value_id uuid NOT NULL REFERENCES public.accounting_dimension_values(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  driver_value numeric(20,4) NOT NULL DEFAULT 0 CHECK (driver_value >= 0),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, dimension_value_id, period_start)
);

ALTER TABLE public.accounting_allocation_driver_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_allocation_driver_values_select ON public.accounting_allocation_driver_values
  FOR SELECT USING (
    organization_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

------------------------------------------------------------
-- 12. Expand accounting_commands for dimension operations
------------------------------------------------------------

ALTER TABLE public.accounting_commands DROP CONSTRAINT IF EXISTS accounting_commands_action_check;
ALTER TABLE public.accounting_commands ADD CONSTRAINT accounting_commands_action_check CHECK (action IN (
  'journal_create', 'journal_update', 'journal_post', 'journal_reverse', 'journal_cancel',
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
  'account_template_save'
));

------------------------------------------------------------
-- 13. Backfill existing cost centers as dimension values
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_backfill_cost_center_dimensions(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dim_type_id uuid;
  backfill_count integer := 0;
BEGIN
  INSERT INTO public.accounting_dimension_types (
    organization_id, code, name_ar, name_en, category, is_hierarchical, sort_order
  ) VALUES (
    p_org_id, 'COST_CENTER', 'مركز التكلفة', 'Cost Center', 'cost_center', false, 1
  ) ON CONFLICT (organization_id, code) DO NOTHING;

  SELECT id INTO dim_type_id FROM public.accounting_dimension_types
  WHERE organization_id = p_org_id AND code = 'COST_CENTER';

  INSERT INTO public.accounting_dimension_values (
    organization_id, dimension_type_id, code, name_ar, name_en,
    reference_table, reference_id, is_active
  )
  SELECT
    p_org_id, dim_type_id, cc.code, cc.name_ar, cc.name_en,
    'accounting_cost_centers', cc.id, cc.is_active
  FROM public.accounting_cost_centers cc
  WHERE cc.organization_id = p_org_id
  ON CONFLICT (organization_id, dimension_type_id, code) DO NOTHING;

  GET DIAGNOSTICS backfill_count = ROW_COUNT;
  RETURN backfill_count;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_backfill_cost_center_dimensions(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_backfill_cost_center_dimensions(uuid)
TO service_role;
