-- Sales telecom company scope. Additive and production-safe.

CREATE TABLE IF NOT EXISTS public.sales_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  code text,
  brand_color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS public.sales_company_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_role text NOT NULL CHECK (assignment_role IN ('sales', 'manager')),
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

ALTER TABLE public.sales_products
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL;

ALTER TABLE public.sales_logs
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL;

ALTER TABLE public.sales_logs
  DROP CONSTRAINT IF EXISTS sales_logs_sales_agent_id_log_date_key;

CREATE INDEX IF NOT EXISTS idx_sales_companies_org_active
  ON public.sales_companies(organization_id, is_active, name);

CREATE INDEX IF NOT EXISTS idx_sales_company_assignments_company
  ON public.sales_company_assignments(organization_id, company_id, assignment_role, is_active);

CREATE INDEX IF NOT EXISTS idx_sales_company_assignments_user
  ON public.sales_company_assignments(organization_id, user_id, assignment_role, is_active, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_sales_products_company_active
  ON public.sales_products(organization_id, company_id, is_active, name);

CREATE INDEX IF NOT EXISTS idx_sales_logs_company_date
  ON public.sales_logs(organization_id, company_id, log_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_companies_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_companies_updated_at
      BEFORE UPDATE ON public.sales_companies
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_company_assignments_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_company_assignments_updated_at
      BEFORE UPDATE ON public.sales_company_assignments
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.sales_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_company_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_companies'
      AND policyname = 'sales_companies_select'
  ) THEN
    CREATE POLICY sales_companies_select ON public.sales_companies
      FOR SELECT USING (
        auth.role() = 'service_role'
        OR organization_id = public.current_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_companies'
      AND policyname = 'sales_companies_manage'
  ) THEN
    CREATE POLICY sales_companies_manage ON public.sales_companies
      FOR ALL USING (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND public.current_role() IN ('admin', 'hr_admin')
        )
      )
      WITH CHECK (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND public.current_role() IN ('admin', 'hr_admin')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_company_assignments'
      AND policyname = 'sales_company_assignments_select'
  ) THEN
    CREATE POLICY sales_company_assignments_select ON public.sales_company_assignments
      FOR SELECT USING (
        auth.role() = 'service_role'
        OR organization_id = public.current_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_company_assignments'
      AND policyname = 'sales_company_assignments_manage'
  ) THEN
    CREATE POLICY sales_company_assignments_manage ON public.sales_company_assignments
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
  END IF;
END $$;

WITH telecoms(name, slug, code, brand_color) AS (
  VALUES
    ('stc', 'stc', 'STC', '#4f008c'),
    ('Mobily', 'mobily', 'MOBILY', '#00a651'),
    ('Zain KSA', 'zain', 'ZAIN', '#8cc63f'),
    ('Salam', 'salam', 'SALAM', '#00a3e0'),
    ('Virgin Mobile KSA', 'virgin-mobile', 'VIRGIN', '#e10a17'),
    ('Lebara KSA', 'lebara', 'LEBARA', '#f58220'),
    ('Red Bull MOBILE', 'red-bull-mobile', 'RBM', '#1b2a57')
)
INSERT INTO public.sales_companies (organization_id, name, slug, code, brand_color, is_active)
SELECT org.id, telecoms.name, telecoms.slug, telecoms.code, telecoms.brand_color, true
FROM public.organizations org
CROSS JOIN telecoms
ON CONFLICT (organization_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    code = EXCLUDED.code,
    brand_color = EXCLUDED.brand_color,
    is_active = true;

UPDATE public.sales_products product
SET company_id = company.id
FROM public.sales_companies company
WHERE product.company_id IS NULL
  AND company.organization_id = product.organization_id
  AND company.slug = 'stc';

UPDATE public.sales_logs log
SET company_id = company.id
FROM public.sales_companies company
WHERE log.company_id IS NULL
  AND company.organization_id = log.organization_id
  AND company.slug = 'stc';
