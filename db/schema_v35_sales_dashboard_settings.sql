-- Sales dashboard configurable targets. Additive and production-safe.

CREATE TABLE IF NOT EXISTS public.sales_dashboard_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE CASCADE,
  channel_title text NOT NULL DEFAULT 'Modern Trade Western Channel',
  partner_label text NOT NULL DEFAULT 'chessboard_company',
  monthly_target integer NOT NULL DEFAULT 2270 CHECK (monthly_target >= 0),
  working_days integer NOT NULL DEFAULT 30 CHECK (working_days BETWEEN 1 AND 31),
  focus_1_label text NOT NULL DEFAULT 'Yalla 20',
  focus_1_query text NOT NULL DEFAULT 'Yalla 20',
  focus_2_label text NOT NULL DEFAULT 'Yalla 30',
  focus_2_query text NOT NULL DEFAULT 'Yalla 30',
  focus_3_label text NOT NULL DEFAULT 'Above the Yalla 30',
  focus_3_query text NOT NULL DEFAULT 'above:30',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_dashboard_settings_org_company
  ON public.sales_dashboard_settings(organization_id, company_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_dashboard_settings_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_dashboard_settings_updated_at
      BEFORE UPDATE ON public.sales_dashboard_settings
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.sales_dashboard_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_dashboard_settings_select ON public.sales_dashboard_settings;
CREATE POLICY sales_dashboard_settings_select ON public.sales_dashboard_settings
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS sales_dashboard_settings_manage ON public.sales_dashboard_settings;
CREATE POLICY sales_dashboard_settings_manage ON public.sales_dashboard_settings
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
    )
  );
