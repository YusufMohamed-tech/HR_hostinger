-- Field Agent Management (SIM distribution) foundation. Additive only.
-- Mirrors conventions from schema_v46_promoter_kiosk.sql:
--   * ALTER TYPE org_role ADD VALUE at top (current_role() returns text, so safe)
--   * SECURITY DEFINER helper functions for RLS
--   * service_role bypass on every policy
--   * FOR ALL policies carry matching WITH CHECK
--   * touch_updated_at trigger attached via loop

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'field_agent';

-- ---------------------------------------------------------------------------
-- Enums (idempotent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sim_status') THEN
    CREATE TYPE public.sim_status AS ENUM ('in_stock', 'with_agent', 'sold', 'returned');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sim_transfer_type') THEN
    CREATE TYPE public.sim_transfer_type AS ENUM (
      'assign_to_agent',
      'return_to_stock',
      'sold',
      'initial_import'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_field_agents()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
      (
        SELECT role::text IN ('admin', 'hr_admin', 'sales_manager')
        FROM public.org_members
        WHERE user_id = auth.uid()
          AND org_id = public.current_org_id()
        LIMIT 1
      ),
      false
    );
$$;

-- ---------------------------------------------------------------------------
-- 1. field_agents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           text NOT NULL,
  phone               text NOT NULL,
  national_id         text NOT NULL,
  region              text,
  commission_rate     numeric NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  max_sim_capacity    integer CHECK (max_sim_capacity IS NULL OR max_sim_capacity >= 0),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  joined_at           date NOT NULL DEFAULT CURRENT_DATE,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- Returns the field_agents.id row that belongs to the current auth user in the
-- current org (or NULL). Defined after field_agents so the SQL body validates.
CREATE OR REPLACE FUNCTION public.current_field_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.field_agents
  WHERE user_id = auth.uid()
    AND organization_id = public.current_org_id()
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. sim_units  (core inventory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sim_units (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  iccid               text NOT NULL,
  sim_type            text NOT NULL DEFAULT 'prepaid',
  price               numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  status              public.sim_status NOT NULL DEFAULT 'in_stock',
  current_agent_id    uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  assigned_at         timestamptz,
  sold_at             timestamptz,
  sold_by_agent_id    uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  sold_price          numeric CHECK (sold_price IS NULL OR sold_price >= 0),
  customer_name       text,
  added_by            uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, iccid)
);

CREATE INDEX IF NOT EXISTS idx_sim_units_org_status
  ON public.sim_units (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_sim_units_current_agent
  ON public.sim_units (current_agent_id);

-- ---------------------------------------------------------------------------
-- 3. sim_transfers  (append-only audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sim_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sim_unit_id         uuid NOT NULL REFERENCES public.sim_units(id) ON DELETE CASCADE,
  transfer_type       public.sim_transfer_type NOT NULL,
  from_agent_id       uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  to_agent_id         uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  performed_by        uuid NOT NULL REFERENCES auth.users(id),
  notes               text,
  transfer_date       timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_transfers_sim
  ON public.sim_transfers (sim_unit_id);
CREATE INDEX IF NOT EXISTS idx_sim_transfers_org_date
  ON public.sim_transfers (organization_id, transfer_date DESC);

-- ---------------------------------------------------------------------------
-- 4. agent_cash_collections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_cash_collections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  amount              numeric NOT NULL CHECK (amount > 0),
  payment_method      text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer')),
  collected_by        uuid NOT NULL REFERENCES auth.users(id),
  collection_date     date NOT NULL DEFAULT CURRENT_DATE,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_cash_collections_agent
  ON public.agent_cash_collections (agent_id);

-- ---------------------------------------------------------------------------
-- 5. agent_sim_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_sim_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_agent_sim_requests_agent
  ON public.agent_sim_requests (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_sim_requests_org_status
  ON public.agent_sim_requests (organization_id, status);

-- ---------------------------------------------------------------------------
-- 6. agent_commissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_commissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_agent_commissions_agent
  ON public.agent_commissions (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_org_paid
  ON public.agent_commissions (organization_id, is_paid);

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_agents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sim_units             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sim_transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sim_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_commissions     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Policies: field_agents
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS field_agents_select ON public.field_agents;
CREATE POLICY field_agents_select ON public.field_agents
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS field_agents_write ON public.field_agents;
CREATE POLICY field_agents_write ON public.field_agents
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

-- ---------------------------------------------------------------------------
-- Policies: sim_units
-- ---------------------------------------------------------------------------
-- Managers see everything; agents see only their own assigned SIMs.
DROP POLICY IF EXISTS sim_units_select ON public.sim_units;
CREATE POLICY sim_units_select ON public.sim_units
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR current_agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS sim_units_write ON public.sim_units;
CREATE POLICY sim_units_write ON public.sim_units
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

-- ---------------------------------------------------------------------------
-- Policies: sim_transfers (append-only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sim_transfers_select ON public.sim_transfers;
CREATE POLICY sim_transfers_select ON public.sim_transfers
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR from_agent_id = public.current_field_agent_id()
        OR to_agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS sim_transfers_insert ON public.sim_transfers;
CREATE POLICY sim_transfers_insert ON public.sim_transfers
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR (transfer_type = 'sold' AND from_agent_id = public.current_field_agent_id())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Policies: agent_cash_collections
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agent_cash_collections_select ON public.agent_cash_collections;
CREATE POLICY agent_cash_collections_select ON public.agent_cash_collections
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS agent_cash_collections_write ON public.agent_cash_collections;
CREATE POLICY agent_cash_collections_write ON public.agent_cash_collections
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

-- ---------------------------------------------------------------------------
-- Policies: agent_sim_requests
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agent_sim_requests_select ON public.agent_sim_requests;
CREATE POLICY agent_sim_requests_select ON public.agent_sim_requests
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );

-- Agents may create their own requests.
DROP POLICY IF EXISTS agent_sim_requests_insert ON public.agent_sim_requests;
CREATE POLICY agent_sim_requests_insert ON public.agent_sim_requests
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );

-- Only managers review (update) requests.
DROP POLICY IF EXISTS agent_sim_requests_update ON public.agent_sim_requests;
CREATE POLICY agent_sim_requests_update ON public.agent_sim_requests
  FOR UPDATE USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

-- ---------------------------------------------------------------------------
-- Policies: agent_commissions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agent_commissions_select ON public.agent_commissions;
CREATE POLICY agent_commissions_select ON public.agent_commissions
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_field_agents()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS agent_commissions_write ON public.agent_commissions;
CREATE POLICY agent_commissions_write ON public.agent_commissions
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_field_agents())
  );

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'field_agents',
    'sim_units',
    'agent_cash_collections',
    'agent_sim_requests',
    'agent_commissions'
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
