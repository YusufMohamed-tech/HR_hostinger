-- SIM packages, trader onboarding details, package-based sales, and trader payments.
-- Additive only. Internal table names keep "merchant" for the trader/small-business tier.

-- ---------------------------------------------------------------------------
-- 1. Package catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sim_packages (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider                   text NOT NULL DEFAULT 'virgin',
  package_name               text NOT NULL,
  internet_allowance         text,
  minutes_allowance          text,
  validity                   text,
  base_price                 numeric NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  sale_price                 numeric NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  tax_included               boolean NOT NULL DEFAULT true,
  agent_commission_type      text NOT NULL DEFAULT 'percentage'
                               CHECK (agent_commission_type IN ('percentage', 'flat')),
  agent_commission_value     numeric NOT NULL DEFAULT 0 CHECK (agent_commission_value >= 0),
  merchant_commission_type   text NOT NULL DEFAULT 'percentage'
                               CHECK (merchant_commission_type IN ('percentage', 'flat')),
  merchant_commission_value  numeric NOT NULL DEFAULT 0 CHECK (merchant_commission_value >= 0),
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by                 uuid REFERENCES auth.users(id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, package_name)
);

CREATE INDEX IF NOT EXISTS idx_sim_packages_org_provider
  ON public.sim_packages (organization_id, provider, status);

-- Seed the initial Virgin package list for every existing organization.
INSERT INTO public.sim_packages (
  organization_id,
  provider,
  package_name,
  internet_allowance,
  minutes_allowance,
  validity,
  base_price,
  sale_price,
  tax_included
)
SELECT o.id, p.provider, p.package_name, p.internet_allowance, p.minutes_allowance, p.validity,
       p.base_price, p.sale_price, true
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('virgin', 'Baqah 110', '2 GB', '745 minutes', NULL::text, 126.50::numeric, 63.25::numeric),
    ('virgin', 'Baqah 150', '56 GB', 'Unlimited minutes', NULL::text, 172.50::numeric, 86.25::numeric),
    ('virgin', 'Baqah 365', 'Unlimited internet', 'Unlimited minutes', NULL::text, 419.75::numeric, 209.88::numeric)
) AS p(provider, package_name, internet_allowance, minutes_allowance, validity, base_price, sale_price)
ON CONFLICT (organization_id, provider, package_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Trader onboarding details
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS place_photo_url text;

-- ---------------------------------------------------------------------------
-- 3. SIM provider and sold package linkage
-- ---------------------------------------------------------------------------
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'virgin';
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS sold_package_id uuid REFERENCES public.sim_packages(id) ON DELETE SET NULL;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS sold_package_name text;

CREATE INDEX IF NOT EXISTS idx_sim_units_provider_status
  ON public.sim_units (organization_id, provider, status);
CREATE INDEX IF NOT EXISTS idx_sim_units_sold_package
  ON public.sim_units (sold_package_id);

-- ---------------------------------------------------------------------------
-- 4. Rich sale ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sim_sales (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sim_unit_id                uuid NOT NULL REFERENCES public.sim_units(id) ON DELETE CASCADE,
  package_id                 uuid NOT NULL REFERENCES public.sim_packages(id) ON DELETE RESTRICT,
  seller_type                text NOT NULL CHECK (seller_type IN ('agent', 'merchant')),
  agent_id                   uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  merchant_id                uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  sale_price                 numeric NOT NULL CHECK (sale_price >= 0),
  customer_name              text,
  agent_commission_type      text NOT NULL DEFAULT 'percentage'
                               CHECK (agent_commission_type IN ('percentage', 'flat')),
  agent_commission_value     numeric NOT NULL DEFAULT 0 CHECK (agent_commission_value >= 0),
  agent_commission_amount    numeric NOT NULL DEFAULT 0 CHECK (agent_commission_amount >= 0),
  merchant_commission_type   text CHECK (merchant_commission_type IN ('percentage', 'flat')),
  merchant_commission_value  numeric CHECK (merchant_commission_value IS NULL OR merchant_commission_value >= 0),
  merchant_commission_amount numeric CHECK (merchant_commission_amount IS NULL OR merchant_commission_amount >= 0),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  sold_at                    timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sim_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_sim_sales_agent
  ON public.sim_sales (organization_id, agent_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_sales_merchant
  ON public.sim_sales (organization_id, merchant_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_sales_package
  ON public.sim_sales (organization_id, package_id, sold_at DESC);

-- Keep commission records tied to the package rule used at sale time.
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS sim_package_id uuid REFERENCES public.sim_packages(id) ON DELETE SET NULL;
ALTER TABLE public.agent_commissions
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'percentage'
    CHECK (commission_type IN ('percentage', 'flat'));

ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS sim_package_id uuid REFERENCES public.sim_packages(id) ON DELETE SET NULL;
ALTER TABLE public.merchant_commissions
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'percentage'
    CHECK (commission_type IN ('percentage', 'flat'));

-- ---------------------------------------------------------------------------
-- 5. Trader payments requiring confirmation
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchant_cash_collections
  DROP CONSTRAINT IF EXISTS merchant_cash_collections_payment_method_check;

ALTER TABLE public.merchant_cash_collections
  ADD CONSTRAINT merchant_cash_collections_payment_method_check
  CHECK (payment_method IN ('cash', 'bank_transfer', 'visa', 'electronic'));

ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'rejected'));
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS payment_proof_url text;
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id);
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id);
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS rejection_reason text;

UPDATE public.merchant_cash_collections
SET submitted_by = COALESCE(submitted_by, collected_by),
    confirmed_by = COALESCE(confirmed_by, collected_by),
    confirmed_at = COALESCE(confirmed_at, created_at),
    status = COALESCE(status, 'confirmed')
WHERE submitted_by IS NULL
   OR confirmed_by IS NULL
   OR confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_cash_collections_status
  ON public.merchant_cash_collections (organization_id, status);

-- Public buckets for uploaded trader place photos and payment proof images.
-- The API stores generated public URLs in the business tables.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('merchant-place-photos', 'merchant-place-photos', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('merchant-payment-proofs', 'merchant-payment-proofs', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.sim_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sim_sales    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sim_packages_select ON public.sim_packages;
CREATE POLICY sim_packages_select ON public.sim_packages
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS sim_packages_write ON public.sim_packages;
CREATE POLICY sim_packages_write ON public.sim_packages
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

DROP POLICY IF EXISTS sim_sales_select ON public.sim_sales;
CREATE POLICY sim_sales_select ON public.sim_sales
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
        OR merchant_id = public.current_merchant_id()
      )
    )
  );

DROP POLICY IF EXISTS sim_sales_write ON public.sim_sales;
CREATE POLICY sim_sales_write ON public.sim_sales
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
        OR merchant_id = public.current_merchant_id()
      )
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
        OR merchant_id = public.current_merchant_id()
      )
    )
  );

-- Replace the old trader payment write policy so traders can submit payments,
-- while agents/managers still confirm or reject them.
DROP POLICY IF EXISTS merchant_cash_collections_write ON public.merchant_cash_collections;
DROP POLICY IF EXISTS merchant_cash_collections_insert ON public.merchant_cash_collections;
CREATE POLICY merchant_cash_collections_insert ON public.merchant_cash_collections
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
        OR merchant_id = public.current_merchant_id()
      )
    )
  );

DROP POLICY IF EXISTS merchant_cash_collections_update ON public.merchant_cash_collections;
CREATE POLICY merchant_cash_collections_update ON public.merchant_cash_collections
  FOR UPDATE USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (public.can_manage_field_agents() OR agent_id = public.current_field_agent_id())
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (public.can_manage_field_agents() OR agent_id = public.current_field_agent_id())
    )
  );

-- updated_at triggers
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['sim_packages']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      tbl,
      tbl
    );
  END LOOP;
END $$;
