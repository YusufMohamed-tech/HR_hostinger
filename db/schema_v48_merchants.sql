-- Merchant (small business / sub-dealer) tier for the field-agent SIM chain.
-- Additive only. Chain: stock -> field_agent -> merchant -> customer.
-- Conventions match schema_v47_field_agents.sql.
--   NOTE: new enum values are compared via ::text in policies to stay safe
--   inside the same transaction they are added in.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'merchant';
ALTER TYPE public.sim_status ADD VALUE IF NOT EXISTS 'with_merchant';
ALTER TYPE public.sim_transfer_type ADD VALUE IF NOT EXISTS 'assign_to_merchant';
ALTER TYPE public.sim_transfer_type ADD VALUE IF NOT EXISTS 'return_from_merchant';

-- ---------------------------------------------------------------------------
-- Per-agent accountability price (what the agent owes the organization per SIM).
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_agents
  ADD COLUMN IF NOT EXISTS sim_price numeric NOT NULL DEFAULT 0 CHECK (sim_price >= 0);

-- ---------------------------------------------------------------------------
-- 1. merchants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name       text NOT NULL,
  owner_name          text,
  phone               text,
  location            text,
  sim_price           numeric NOT NULL DEFAULT 0 CHECK (sim_price >= 0),          -- merchant owes agent per SIM
  commission_rate     numeric NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_merchants_agent ON public.merchants (agent_id);
CREATE INDEX IF NOT EXISTS idx_merchants_org ON public.merchants (organization_id);

-- Returns the merchants.id row that belongs to the current auth user, or NULL.
CREATE OR REPLACE FUNCTION public.current_merchant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.merchants
  WHERE user_id = auth.uid()
    AND organization_id = public.current_org_id()
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- sim_units: merchant ownership columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS current_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS sold_by_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL;
ALTER TABLE public.sim_units
  ADD COLUMN IF NOT EXISTS merchant_assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sim_units_current_merchant
  ON public.sim_units (current_merchant_id);

-- ---------------------------------------------------------------------------
-- sim_transfers: merchant endpoints
-- ---------------------------------------------------------------------------
ALTER TABLE public.sim_transfers
  ADD COLUMN IF NOT EXISTS from_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL;
ALTER TABLE public.sim_transfers
  ADD COLUMN IF NOT EXISTS to_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. merchant_sim_requests (re-order the merchant places to its agent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_sim_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id         uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  quantity            integer NOT NULL CHECK (quantity > 0),
  sim_type            text,
  notes               text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'delivered')),
  reviewed_by         uuid REFERENCES auth.users(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_sim_requests_merchant
  ON public.merchant_sim_requests (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_sim_requests_agent
  ON public.merchant_sim_requests (agent_id);

-- ---------------------------------------------------------------------------
-- 3. merchant_cash_collections (agent collects cash from merchant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_cash_collections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id         uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  amount              numeric NOT NULL CHECK (amount > 0),
  payment_method      text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer')),
  collected_by        uuid NOT NULL REFERENCES auth.users(id),
  collection_date     date NOT NULL DEFAULT CURRENT_DATE,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_cash_collections_merchant
  ON public.merchant_cash_collections (merchant_id);

-- ---------------------------------------------------------------------------
-- 4. merchant_commissions (merchant's reward per sale, paid by the agent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_commissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id         uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  sim_unit_id         uuid NOT NULL REFERENCES public.sim_units(id) ON DELETE CASCADE,
  sale_price          numeric NOT NULL CHECK (sale_price >= 0),
  commission_rate     numeric NOT NULL CHECK (commission_rate >= 0),
  commission_amount   numeric NOT NULL CHECK (commission_amount >= 0),
  is_paid             boolean NOT NULL DEFAULT false,
  paid_at             timestamptz,
  paid_by             uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sim_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_commissions_merchant
  ON public.merchant_commissions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_commissions_org_paid
  ON public.merchant_commissions (organization_id, is_paid);

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.merchants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_sim_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_commissions     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Policies: merchants
-- ---------------------------------------------------------------------------
-- Visible to managers, the owning agent, and the merchant themselves.
DROP POLICY IF EXISTS merchants_select ON public.merchants;
CREATE POLICY merchants_select ON public.merchants
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
        OR user_id = auth.uid()
      )
    )
  );

-- Managers or the owning agent can create/update merchants.
DROP POLICY IF EXISTS merchants_write ON public.merchants;
CREATE POLICY merchants_write ON public.merchants
  FOR ALL USING (
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

-- ---------------------------------------------------------------------------
-- sim_units: extend SELECT so merchants see their own SIMs.
-- (Managers + owning agent already covered by current_agent_id.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sim_units_select ON public.sim_units;
CREATE POLICY sim_units_select ON public.sim_units
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR current_agent_id = public.current_field_agent_id()
        OR current_merchant_id = public.current_merchant_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Policies: merchant_sim_requests
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS merchant_sim_requests_select ON public.merchant_sim_requests;
CREATE POLICY merchant_sim_requests_select ON public.merchant_sim_requests
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

-- Merchants create their own re-orders.
DROP POLICY IF EXISTS merchant_sim_requests_insert ON public.merchant_sim_requests;
CREATE POLICY merchant_sim_requests_insert ON public.merchant_sim_requests
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

-- The owning agent (or managers) reviews re-orders.
DROP POLICY IF EXISTS merchant_sim_requests_update ON public.merchant_sim_requests;
CREATE POLICY merchant_sim_requests_update ON public.merchant_sim_requests
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

-- ---------------------------------------------------------------------------
-- Policies: merchant_cash_collections
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS merchant_cash_collections_select ON public.merchant_cash_collections;
CREATE POLICY merchant_cash_collections_select ON public.merchant_cash_collections
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

-- Agents (or managers) record cash collected from merchants.
DROP POLICY IF EXISTS merchant_cash_collections_write ON public.merchant_cash_collections;
CREATE POLICY merchant_cash_collections_write ON public.merchant_cash_collections
  FOR ALL USING (
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

-- ---------------------------------------------------------------------------
-- Policies: merchant_commissions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS merchant_commissions_select ON public.merchant_commissions;
CREATE POLICY merchant_commissions_select ON public.merchant_commissions
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

-- Agents (or managers) manage merchant commission payouts.
DROP POLICY IF EXISTS merchant_commissions_write ON public.merchant_commissions;
CREATE POLICY merchant_commissions_write ON public.merchant_commissions
  FOR ALL USING (
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

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'merchants',
    'merchant_sim_requests',
    'merchant_cash_collections',
    'merchant_commissions'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      tbl,
      tbl
    );
  END LOOP;
END $$;
