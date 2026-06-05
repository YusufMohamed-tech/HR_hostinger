-- Sales module schema. Additive only.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'sales_manager';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'sales';

CREATE TABLE IF NOT EXISTS public.sales_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  unit text,
  category text,
  price numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_agent_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT current_date,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total_discount numeric NOT NULL DEFAULT 0 CHECK (total_discount >= 0),
  grand_total numeric NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  reviewed_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_agent_id, log_date),
  CHECK (jsonb_typeof(items) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_sales_products_org_active
  ON public.sales_products(organization_id, is_active, name);

CREATE INDEX IF NOT EXISTS idx_sales_products_org_category
  ON public.sales_products(organization_id, category);

CREATE INDEX IF NOT EXISTS idx_sales_logs_org_date
  ON public.sales_logs(organization_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_logs_agent_date
  ON public.sales_logs(sales_agent_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_logs_status
  ON public.sales_logs(organization_id, status);

ALTER TABLE public.sales_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_products_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_products_updated_at
      BEFORE UPDATE ON public.sales_products
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sales_logs_updated_at'
  ) THEN
    CREATE TRIGGER trg_sales_logs_updated_at
      BEFORE UPDATE ON public.sales_logs
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_products'
      AND policyname = 'sales_products_select'
  ) THEN
    CREATE POLICY sales_products_select ON public.sales_products
      FOR SELECT USING (
        organization_id = public.current_org_id()
        OR auth.role() = 'service_role'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_products'
      AND policyname = 'sales_products_insert'
  ) THEN
    CREATE POLICY sales_products_insert ON public.sales_products
      FOR INSERT WITH CHECK (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_products'
      AND policyname = 'sales_products_update'
  ) THEN
    CREATE POLICY sales_products_update ON public.sales_products
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_products'
      AND policyname = 'sales_products_delete'
  ) THEN
    CREATE POLICY sales_products_delete ON public.sales_products
      FOR DELETE USING (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_logs'
      AND policyname = 'sales_logs_select'
  ) THEN
    CREATE POLICY sales_logs_select ON public.sales_logs
      FOR SELECT USING (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND (
            public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
            OR sales_agent_id = auth.uid()
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_logs'
      AND policyname = 'sales_logs_insert'
  ) THEN
    CREATE POLICY sales_logs_insert ON public.sales_logs
      FOR INSERT WITH CHECK (
        auth.role() = 'service_role'
        OR (
          organization_id = public.current_org_id()
          AND public.current_role() = 'sales'
          AND sales_agent_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sales_logs'
      AND policyname = 'sales_logs_update'
  ) THEN
    CREATE POLICY sales_logs_update ON public.sales_logs
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
  END IF;
END $$;
