-- Sales shift targets and reminder prompts. Additive and production-safe.

ALTER TABLE public.sales_company_assignments
  ADD COLUMN IF NOT EXISTS daily_target numeric NOT NULL DEFAULT 0 CHECK (daily_target >= 0),
  ADD COLUMN IF NOT EXISTS target_notes text;

CREATE INDEX IF NOT EXISTS idx_sales_company_assignments_daily_target
  ON public.sales_company_assignments(organization_id, user_id, company_id, daily_target);

CREATE TABLE IF NOT EXISTS public.sales_shift_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  sales_agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  prompt_date date NOT NULL DEFAULT current_date,
  prompt_type text NOT NULL CHECK (prompt_type IN ('hourly', 'mid_shift', 'end_shift')),
  prompt_key text NOT NULL,
  target_amount numeric NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  achieved_amount numeric NOT NULL DEFAULT 0 CHECK (achieved_amount >= 0),
  required_percent numeric NOT NULL DEFAULT 0 CHECK (required_percent >= 0),
  action text CHECK (action IN ('shown', 'snoozed', 'acknowledged', 'submitted_reason')),
  reason text,
  snoozed_until timestamptz,
  notified_at timestamptz,
  reason_submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_agent_id, company_id, prompt_date, prompt_type, prompt_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_shift_prompts_agent_date
  ON public.sales_shift_prompts(organization_id, sales_agent_id, prompt_date DESC, prompt_type);

CREATE INDEX IF NOT EXISTS idx_sales_shift_prompts_company_date
  ON public.sales_shift_prompts(organization_id, company_id, prompt_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_shift_prompts_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_shift_prompts_updated_at
      BEFORE UPDATE ON public.sales_shift_prompts
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.sales_shift_prompts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_shift_prompts'
      AND policyname = 'sales_shift_prompts_select'
  ) THEN
    CREATE POLICY sales_shift_prompts_select ON public.sales_shift_prompts
      FOR SELECT USING (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND (
            sales_agent_id = auth.uid()
            OR public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_shift_prompts'
      AND policyname = 'sales_shift_prompts_insert'
  ) THEN
    CREATE POLICY sales_shift_prompts_insert ON public.sales_shift_prompts
      FOR INSERT WITH CHECK (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND sales_agent_id = auth.uid()
          AND public.current_role() IN ('sales', 'sales_manager')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_shift_prompts'
      AND policyname = 'sales_shift_prompts_update'
  ) THEN
    CREATE POLICY sales_shift_prompts_update ON public.sales_shift_prompts
      FOR UPDATE USING (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND (
            sales_agent_id = auth.uid()
            OR public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
          )
        )
      )
      WITH CHECK (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND (
            sales_agent_id = auth.uid()
            OR public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
          )
        )
      );
  END IF;
END $$;
