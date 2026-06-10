-- Sales log edit requests. Additive and production-safe.

CREATE TABLE IF NOT EXISTS public.sales_log_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_log_id uuid NOT NULL REFERENCES public.sales_logs(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  sales_agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_changes text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_log_edit_requests_org_status
  ON public.sales_log_edit_requests(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_log_edit_requests_log
  ON public.sales_log_edit_requests(sales_log_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_log_edit_requests_agent
  ON public.sales_log_edit_requests(organization_id, sales_agent_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_log_edit_requests_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_log_edit_requests_updated_at
      BEFORE UPDATE ON public.sales_log_edit_requests
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.sales_log_edit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_log_edit_requests_select ON public.sales_log_edit_requests;
CREATE POLICY sales_log_edit_requests_select ON public.sales_log_edit_requests
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

DROP POLICY IF EXISTS sales_log_edit_requests_insert ON public.sales_log_edit_requests;
CREATE POLICY sales_log_edit_requests_insert ON public.sales_log_edit_requests
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND sales_agent_id = auth.uid()
      AND public.current_role() IN ('sales', 'sales_manager')
    )
  );

DROP POLICY IF EXISTS sales_log_edit_requests_update ON public.sales_log_edit_requests;
CREATE POLICY sales_log_edit_requests_update ON public.sales_log_edit_requests
  FOR UPDATE USING (
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
