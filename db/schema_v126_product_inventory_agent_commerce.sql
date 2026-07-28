-- Phase 4: serialized product custody, agent acknowledgment, returns, sales,
-- price exceptions, voids, collections, operational balances, and durable
-- event evidence. General-ledger posting is intentionally deferred to Phase 5.

CREATE OR REPLACE FUNCTION public.can_sell_assigned_products()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
      (
        SELECT member.role::text = 'field_agent'
          AND EXISTS (
            SELECT 1
            FROM public.field_agents agent
            WHERE agent.organization_id = member.org_id
              AND agent.user_id = member.user_id
              AND agent.status = 'active'
          )
        FROM public.org_members member
        WHERE member.user_id = auth.uid()
          AND member.org_id = public.current_org_id()
        LIMIT 1
      ),
      false
    );
$$;

CREATE TABLE IF NOT EXISTS public.product_inventory_commerce_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  require_agent_acknowledgment boolean NOT NULL DEFAULT true,
  default_price_tolerance_percent numeric(5,2) NOT NULL DEFAULT 10
    CHECK (default_price_tolerance_percent BETWEEN 0 AND 100),
  max_handover_units integer NOT NULL DEFAULT 200
    CHECK (max_handover_units BETWEEN 1 AND 500),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.product_inventory_commerce_settings (organization_id)
SELECT organization.id
FROM public.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.product_commerce_number_sequences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number_type text NOT NULL CHECK (number_type IN ('handover', 'sale', 'collection')),
  sequence_year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, number_type, sequence_year)
);

CREATE OR REPLACE FUNCTION public.next_product_commerce_number(
  p_org_id uuid,
  p_number_type text,
  p_business_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sequence_value integer;
  year_value integer := EXTRACT(YEAR FROM COALESCE(p_business_date, CURRENT_DATE))::integer;
  prefix_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_number_type NOT IN ('handover', 'sale', 'collection') THEN
    RAISE EXCEPTION 'Unsupported product commerce number type.' USING ERRCODE = '22023';
  END IF;
  prefix_value := CASE p_number_type
    WHEN 'handover' THEN 'PH'
    WHEN 'sale' THEN 'PS'
    ELSE 'PC'
  END;
  INSERT INTO public.product_commerce_number_sequences (
    organization_id, number_type, sequence_year, last_number
  )
  VALUES (p_org_id, p_number_type, year_value, 1)
  ON CONFLICT (organization_id, number_type, sequence_year)
  DO UPDATE SET
    last_number = public.product_commerce_number_sequences.last_number + 1,
    updated_at = now()
  RETURNING last_number INTO sequence_value;
  RETURN prefix_value || '-' || year_value::text || '-' || lpad(sequence_value::text, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_handovers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  handover_no text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('issued', 'accepted', 'completed', 'cancelled')),
  require_acknowledgment boolean NOT NULL DEFAULT true,
  notes text,
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, handover_no)
);

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS current_handover_id uuid
    REFERENCES public.product_handovers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.product_handover_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  handover_id uuid NOT NULL REFERENCES public.product_handovers(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  planned_sale_price_snapshot numeric(14,2) NOT NULL CHECK (planned_sale_price_snapshot > 0),
  minimum_sale_price numeric(14,2) NOT NULL CHECK (minimum_sale_price > 0),
  maximum_sale_price numeric(14,2) NOT NULL CHECK (maximum_sale_price > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tax_included boolean NOT NULL DEFAULT true,
  line_status text NOT NULL CHECK (
    line_status IN ('pending', 'accepted', 'sold', 'returned', 'voided', 'cancelled')
  ),
  accepted_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_sale_price <= maximum_sale_price),
  UNIQUE (handover_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.agent_product_sales (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_no text NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_name text,
  customer_phone text,
  customer_reference text,
  payment_method text NOT NULL CHECK (
    payment_method IN ('cash', 'bank_transfer', 'card', 'electronic', 'agent_credit')
  ),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  accounting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_status IN ('pending', 'not_required', 'posted', 'failed', 'reversed')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  return_disposition text CHECK (
    return_disposition IS NULL OR return_disposition IN ('sellable', 'damaged')
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sale_no)
);

CREATE TABLE IF NOT EXISTS public.agent_product_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.agent_product_sales(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  handover_id uuid NOT NULL REFERENCES public.product_handovers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  serial_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  unit_cost_snapshot numeric(14,2) NOT NULL CHECK (unit_cost_snapshot > 0),
  planned_sale_price_snapshot numeric(14,2) NOT NULL CHECK (planned_sale_price_snapshot > 0),
  minimum_sale_price_snapshot numeric(14,2) NOT NULL CHECK (minimum_sale_price_snapshot > 0),
  maximum_sale_price_snapshot numeric(14,2) NOT NULL CHECK (maximum_sale_price_snapshot > 0),
  actual_sale_price numeric(14,2) NOT NULL CHECK (actual_sale_price > 0),
  net_amount numeric(14,2) NOT NULL CHECK (net_amount >= 0),
  vat_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  gross_profit numeric(14,2) NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  commission_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(commission_rule_snapshot) = 'object'),
  agent_commission_amount numeric(14,2) NOT NULL DEFAULT 0
    CHECK (agent_commission_amount >= 0),
  price_override_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, unit_id)
);

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS current_sale_id uuid
    REFERENCES public.agent_product_sales(id) ON DELETE SET NULL;

ALTER TABLE public.product_inventory_movements
  ADD COLUMN IF NOT EXISTS handover_id uuid
    REFERENCES public.product_handovers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_id uuid
    REFERENCES public.agent_product_sales(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.product_price_override_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  handover_id uuid NOT NULL REFERENCES public.product_handovers(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  requested_price numeric(14,2) NOT NULL CHECK (requested_price > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  used_sale_id uuid REFERENCES public.agent_product_sales(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_product_sale_lines
  ADD CONSTRAINT agent_product_sale_lines_override_fk
  FOREIGN KEY (price_override_request_id)
  REFERENCES public.product_price_override_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_price_override_one_pending_idx
  ON public.product_price_override_requests (organization_id, unit_id, agent_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.agent_product_collections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  collection_no text NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (
    payment_method IN ('cash', 'bank_transfer', 'card', 'electronic')
  ),
  reference text,
  collection_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  accounting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_status IN ('pending', 'not_required', 'posted', 'failed', 'reversed')),
  collected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  collected_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, collection_no)
);

ALTER TABLE public.product_inventory_commands
  DROP CONSTRAINT IF EXISTS product_inventory_commands_action_check;
ALTER TABLE public.product_inventory_commands
  ADD CONSTRAINT product_inventory_commands_action_check CHECK (
    action IN (
      'receipt_draft_save', 'receipt_confirm', 'receipt_cancel',
      'handover_issue', 'handover_accept', 'agent_return',
      'price_override_request', 'price_override_review',
      'sale', 'sale_void', 'collection_post'
    )
  );

CREATE INDEX IF NOT EXISTS product_handovers_org_status_idx
  ON public.product_handovers (organization_id, status, agent_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS product_handover_lines_unit_idx
  ON public.product_handover_lines (organization_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_product_sales_org_date_idx
  ON public.agent_product_sales (organization_id, status, agent_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS agent_product_sale_lines_unit_idx
  ON public.agent_product_sale_lines (organization_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_product_collections_agent_idx
  ON public.agent_product_collections (organization_id, agent_id, collection_date DESC);
CREATE INDEX IF NOT EXISTS product_price_override_status_idx
  ON public.product_price_override_requests (organization_id, status, agent_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS product_inventory_movements_handover_idx
  ON public.product_inventory_movements (organization_id, handover_id, movement_at DESC)
  WHERE handover_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_inventory_movements_sale_idx
  ON public.product_inventory_movements (organization_id, sale_id, movement_at DESC)
  WHERE sale_id IS NOT NULL;

ALTER TABLE public.product_inventory_commerce_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_commerce_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_handover_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_product_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_product_sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_override_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_product_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_inventory_commerce_settings_select
  ON public.product_inventory_commerce_settings
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (public.can_manage_product_inventory() OR public.can_sell_assigned_products())
    )
  );
CREATE POLICY product_handovers_select ON public.product_handovers
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );
CREATE POLICY product_handover_lines_select ON public.product_handover_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR EXISTS (
          SELECT 1 FROM public.product_handovers handover
          WHERE handover.id = handover_id
            AND handover.organization_id = organization_id
            AND handover.agent_id = public.current_field_agent_id()
        )
      )
    )
  );
CREATE POLICY agent_product_sales_select ON public.agent_product_sales
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );
CREATE POLICY agent_product_sale_lines_select ON public.agent_product_sale_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR EXISTS (
          SELECT 1 FROM public.agent_product_sales sale
          WHERE sale.id = sale_id
            AND sale.organization_id = organization_id
            AND sale.agent_id = public.current_field_agent_id()
        )
      )
    )
  );
CREATE POLICY product_price_override_requests_select
  ON public.product_price_override_requests
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_product_inventory()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );
CREATE POLICY agent_product_collections_select
  ON public.agent_product_collections
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS product_inventory_units_select ON public.product_inventory_units;
CREATE POLICY product_inventory_units_select ON public.product_inventory_units
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR current_agent_id = public.current_field_agent_id()
        OR sold_by_agent_id = public.current_field_agent_id()
      )
    )
  );

DROP POLICY IF EXISTS product_inventory_movements_select ON public.product_inventory_movements;
CREATE POLICY product_inventory_movements_select ON public.product_inventory_movements
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR from_agent_id = public.current_field_agent_id()
        OR to_agent_id = public.current_field_agent_id()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.guard_product_commerce_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.product_commerce_command', true) IS DISTINCT FROM 'trusted' THEN
    RAISE EXCEPTION 'Product commerce rows are command-owned.'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE table_name_value text;
BEGIN
  FOREACH table_name_value IN ARRAY ARRAY[
    'product_handovers',
    'product_handover_lines',
    'agent_product_sales',
    'agent_product_sale_lines',
    'product_price_override_requests',
    'agent_product_collections'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
      'guard_' || table_name_value || '_write', table_name_value);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.guard_product_commerce_write()',
      'guard_' || table_name_value || '_write', table_name_value
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
      'trg_' || table_name_value || '_updated_at', table_name_value);
    IF table_name_value NOT IN ('agent_product_sale_lines') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
        'trg_' || table_name_value || '_updated_at', table_name_value
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.execute_product_commerce_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_commands%ROWTYPE;
  actor_role_value text;
  actor_agent_id uuid;
  custody_agent_id uuid;
  payload_hash_value text;
  entity_id_value uuid;
  expected_version_value integer;
  topic_value text;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
  result_value jsonb;
  handover_row public.product_handovers%ROWTYPE;
  sale_row public.agent_product_sales%ROWTYPE;
  unit_row public.product_inventory_units%ROWTYPE;
  override_row public.product_price_override_requests%ROWTYPE;
  agent_row public.field_agents%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
  units_value jsonb;
  unit_count_value integer;
  affected_count_value integer;
  outstanding_value numeric(14,2);
  price_value numeric(14,2);
  minimum_price_value numeric(14,2);
  maximum_price_value numeric(14,2);
  vat_rate_value numeric(5,2);
  tax_included_value boolean;
  net_value numeric(14,2);
  vat_value numeric(14,2);
  total_value numeric(14,2);
  commission_value numeric(14,2);
  disposition_value text;
  decision_value text;
  date_value date;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_action IS NULL
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Product commerce command input is invalid.'
      USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN (
    'handover_issue', 'handover_accept', 'agent_return',
    'price_override_request', 'price_override_review',
    'sale', 'sale_void', 'collection_post'
  ) THEN
    RAISE EXCEPTION 'Unsupported product commerce action.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text, agent.id
  INTO actor_role_value, actor_agent_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.field_agents agent
    ON agent.organization_id = member.org_id
   AND agent.user_id = member.user_id
   AND agent.status = 'active'
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'sales_manager', 'onground_agent_manager', 'field_agent'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL
     OR (actor_role_value = 'field_agent' AND actor_agent_id IS NULL) THEN
    RAISE EXCEPTION 'Product commerce access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_hash_value := encode(
    digest(jsonb_build_object('action', p_action, 'payload', p_payload)::text, 'sha256'),
    'hex'
  );
  INSERT INTO public.product_inventory_commands (
    organization_id, idempotency_key, action, entity_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, p_action,
    NULLIF(p_payload->>'entity_id', '')::uuid,
    payload_hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> p_action
     OR command_row.payload_hash <> payload_hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Product commerce idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO settings_row
  FROM public.product_inventory_commerce_settings
  WHERE organization_id = p_org_id;
  IF settings_row.organization_id IS NULL THEN
    INSERT INTO public.product_inventory_commerce_settings (organization_id)
    VALUES (p_org_id)
    RETURNING * INTO settings_row;
  END IF;

  PERFORM set_config('app.product_commerce_command', 'trusted', true);

  IF p_action = 'handover_issue' THEN
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can issue product custody.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'handover_id', '')::uuid;
    IF entity_id_value IS NULL THEN
      RAISE EXCEPTION 'Handover id is required.' USING ERRCODE = '23514';
    END IF;
    units_value := COALESCE(p_payload->'units', '[]'::jsonb);
    IF jsonb_typeof(units_value) <> 'array' THEN
      RAISE EXCEPTION 'Handover units must be an array.' USING ERRCODE = '23514';
    END IF;
    unit_count_value := jsonb_array_length(units_value);
    IF unit_count_value < 1 OR unit_count_value > settings_row.max_handover_units THEN
      RAISE EXCEPTION 'Handover unit count is outside the configured limit.'
        USING ERRCODE = '23514';
    END IF;
    IF (
      SELECT count(DISTINCT item.value->>'unit_id')
      FROM jsonb_array_elements(units_value) item(value)
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Handover unit ids must be unique.' USING ERRCODE = '23505';
    END IF;

    SELECT * INTO agent_row
    FROM public.field_agents agent
    WHERE agent.organization_id = p_org_id
      AND agent.id = NULLIF(p_payload->>'agent_id', '')::uuid
      AND agent.status = 'active'
    FOR UPDATE;
    IF agent_row.id IS NULL THEN
      RAISE EXCEPTION 'Active field agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO warehouse_row
    FROM public.inventory_warehouses warehouse
    WHERE warehouse.organization_id = p_org_id
      AND warehouse.id = NULLIF(p_payload->>'warehouse_id', '')::uuid
      AND warehouse.is_active
    FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'Active warehouse was not found.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM unit.id
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements(units_value) item(value)
      ON unit.id = (item.value->>'unit_id')::uuid
    WHERE unit.organization_id = p_org_id
    ORDER BY unit.id
    FOR UPDATE OF unit;
    IF (
      SELECT count(*)
      FROM public.product_inventory_units unit
      JOIN jsonb_array_elements(units_value) item(value)
        ON unit.id = (item.value->>'unit_id')::uuid
      WHERE unit.organization_id = p_org_id
        AND unit.status = 'in_stock'
        AND unit.warehouse_id = warehouse_row.id
        AND unit.current_agent_id IS NULL
        AND unit.current_handover_id IS NULL
        AND unit.current_sale_id IS NULL
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Only available units in the selected warehouse can be issued.'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.product_handovers (
      id, organization_id, handover_no, warehouse_id, agent_id,
      status, require_acknowledgment, notes, issued_by,
      accepted_by, accepted_at
    )
    VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'handover', CURRENT_DATE),
      warehouse_row.id, agent_row.id,
      CASE
        WHEN COALESCE(
          NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
          settings_row.require_agent_acknowledgment
        ) THEN 'issued'
        ELSE 'accepted'
      END,
      COALESCE(
        NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
        settings_row.require_agent_acknowledgment
      ),
      NULLIF(btrim(p_payload->>'notes'), ''),
      p_actor_user_id,
      CASE
        WHEN COALESCE(
          NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
          settings_row.require_agent_acknowledgment
        ) THEN NULL ELSE p_actor_user_id
      END,
      CASE
        WHEN COALESCE(
          NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
          settings_row.require_agent_acknowledgment
        ) THEN NULL ELSE now()
      END
    )
    RETURNING * INTO handover_row;

    INSERT INTO public.product_handover_lines (
      organization_id, handover_id, unit_id, product_id,
      planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price,
      currency, tax_included, line_status, accepted_at
    )
    SELECT
      p_org_id, handover_row.id, unit.id, unit.product_id,
      unit.planned_sale_price_snapshot,
      COALESCE(
        NULLIF(item.value->>'minimum_sale_price', '')::numeric,
        greatest(
          0.01,
          round(
            unit.planned_sale_price_snapshot
            * (1 - settings_row.default_price_tolerance_percent / 100),
            2
          )
        )
      ),
      COALESCE(
        NULLIF(item.value->>'maximum_sale_price', '')::numeric,
        round(
          unit.planned_sale_price_snapshot
          * (1 + settings_row.default_price_tolerance_percent / 100),
          2
        )
      ),
      unit.currency, receipt_line.tax_included,
      CASE WHEN handover_row.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
      CASE WHEN handover_row.status = 'accepted' THEN now() END
    FROM jsonb_array_elements(units_value) item(value)
    JOIN public.product_inventory_units unit
      ON unit.organization_id = p_org_id
     AND unit.id = (item.value->>'unit_id')::uuid
    JOIN public.product_receipt_lines receipt_line
      ON receipt_line.organization_id = p_org_id
     AND receipt_line.id = unit.receipt_line_id;

    IF EXISTS (
      SELECT 1 FROM public.product_handover_lines line
      WHERE line.organization_id = p_org_id
        AND line.handover_id = handover_row.id
        AND line.minimum_sale_price > line.maximum_sale_price
    ) THEN
      RAISE EXCEPTION 'Handover sale-price boundaries are invalid.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.product_inventory_units unit
    SET status = CASE WHEN handover_row.status = 'accepted' THEN 'with_agent' ELSE 'in_transit' END,
        warehouse_id = NULL,
        current_agent_id = handover_row.agent_id,
        current_handover_id = handover_row.id,
        assigned_at = now(),
        version = version + 1,
        updated_at = now()
    FROM jsonb_array_elements(units_value) item(value)
    WHERE unit.organization_id = p_org_id
      AND unit.id = (item.value->>'unit_id')::uuid;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      from_warehouse_id, to_agent_id, handover_id,
      reason, performed_by, metadata
    )
    SELECT
      p_org_id, (item.value->>'unit_id')::uuid, 'handover_issued',
      warehouse_row.id, handover_row.agent_id, handover_row.id,
      NULLIF(btrim(p_payload->>'notes'), ''), p_actor_user_id,
      jsonb_build_object(
        'handover_no', handover_row.handover_no,
        'command_id', p_command_id,
        'require_acknowledgment', handover_row.require_acknowledgment
      )
    FROM jsonb_array_elements(units_value) item(value);

    IF handover_row.status = 'accepted' THEN
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type,
        to_agent_id, handover_id, reason, performed_by, metadata
      )
      SELECT
        p_org_id, (item.value->>'unit_id')::uuid, 'handover_accepted',
        handover_row.agent_id, handover_row.id,
        'Immediate manager-approved custody', p_actor_user_id,
        jsonb_build_object('handover_no', handover_row.handover_no, 'command_id', p_command_id)
      FROM jsonb_array_elements(units_value) item(value);
    END IF;

    topic_value := 'product_inventory.handover_issued';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'handover_id', handover_row.id,
      'handover_no', handover_row.handover_no,
      'agent_id', handover_row.agent_id,
      'agent_user_id', agent_row.user_id,
      'unit_count', unit_count_value,
      'status', handover_row.status,
      'version', handover_row.version
    );
    result_value := jsonb_build_object(
      'handover', to_jsonb(handover_row),
      'unit_count', unit_count_value
    );

  ELSIF p_action = 'handover_accept' THEN
    entity_id_value := NULLIF(p_payload->>'handover_id', '')::uuid;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    SELECT * INTO handover_row
    FROM public.product_handovers handover
    WHERE handover.organization_id = p_org_id
      AND handover.id = entity_id_value
    FOR UPDATE;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Product handover was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF handover_row.status <> 'issued' OR handover_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Handover is no longer awaiting this acceptance.'
        USING ERRCODE = '40001';
    END IF;
    IF actor_role_value = 'field_agent' AND actor_agent_id <> handover_row.agent_id THEN
      RAISE EXCEPTION 'Agents can accept only their own handovers.'
        USING ERRCODE = '42501';
    END IF;

    PERFORM unit.id
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.current_handover_id = handover_row.id
    ORDER BY unit.id
    FOR UPDATE;
    UPDATE public.product_inventory_units
    SET status = 'with_agent',
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id
      AND current_handover_id = handover_row.id
      AND current_agent_id = handover_row.agent_id
      AND status = 'in_transit';
    GET DIAGNOSTICS affected_count_value = ROW_COUNT;
    IF affected_count_value < 1 OR affected_count_value <> (
      SELECT count(*) FROM public.product_handover_lines line
      WHERE line.organization_id = p_org_id
        AND line.handover_id = handover_row.id
        AND line.line_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Handover unit state changed before acceptance.'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.product_handover_lines
    SET line_status = 'accepted',
        accepted_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id
      AND handover_id = handover_row.id
      AND line_status = 'pending';

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      to_agent_id, handover_id, reason, performed_by, metadata
    )
    SELECT
      p_org_id, line.unit_id, 'handover_accepted',
      handover_row.agent_id, handover_row.id,
      'Agent custody acknowledgment', p_actor_user_id,
      jsonb_build_object('handover_no', handover_row.handover_no, 'command_id', p_command_id)
    FROM public.product_handover_lines line
    WHERE line.organization_id = p_org_id
      AND line.handover_id = handover_row.id;

    UPDATE public.product_handovers
    SET status = 'accepted',
        accepted_by = p_actor_user_id,
        accepted_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = handover_row.id
    RETURNING * INTO handover_row;

    topic_value := 'product_inventory.handover_accepted';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'handover_id', handover_row.id,
      'handover_no', handover_row.handover_no,
      'agent_id', handover_row.agent_id,
      'agent_user_id', (
        SELECT user_id FROM public.field_agents WHERE id = handover_row.agent_id
      ),
      'unit_count', affected_count_value,
      'status', handover_row.status,
      'version', handover_row.version
    );
    result_value := jsonb_build_object(
      'handover', to_jsonb(handover_row),
      'unit_count', affected_count_value
    );

  ELSIF p_action = 'agent_return' THEN
    entity_id_value := NULLIF(p_payload->>'return_id', '')::uuid;
    IF entity_id_value IS NULL THEN
      RAISE EXCEPTION 'Return id is required.' USING ERRCODE = '23514';
    END IF;
    units_value := COALESCE(p_payload->'unit_ids', '[]'::jsonb);
    IF jsonb_typeof(units_value) <> 'array' THEN
      RAISE EXCEPTION 'Return unit ids must be an array.' USING ERRCODE = '23514';
    END IF;
    unit_count_value := jsonb_array_length(units_value);
    IF unit_count_value < 1 OR unit_count_value > 200 OR (
      SELECT count(DISTINCT item.value)
      FROM jsonb_array_elements_text(units_value) item(value)
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Return requires 1-200 unique unit ids.'
        USING ERRCODE = '23514';
    END IF;
    IF length(btrim(COALESCE(p_payload->>'reason', ''))) < 3 THEN
      RAISE EXCEPTION 'Return reason is required.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO warehouse_row
    FROM public.inventory_warehouses warehouse
    WHERE warehouse.organization_id = p_org_id
      AND warehouse.id = NULLIF(p_payload->>'warehouse_id', '')::uuid
      AND warehouse.is_active
    FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'Return warehouse was not found.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM unit.id
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value)
      ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id
    ORDER BY unit.id
    FOR UPDATE OF unit;
    IF (
      SELECT count(*)
      FROM public.product_inventory_units unit
      JOIN jsonb_array_elements_text(units_value) item(value)
        ON unit.id = item.value::uuid
      WHERE unit.organization_id = p_org_id
        AND unit.current_sale_id IS NULL
        AND (
          unit.status = 'with_agent'
          OR (
            unit.status = 'in_transit'
            AND actor_role_value IN ('admin', 'sales_manager', 'onground_agent_manager')
          )
        )
        AND (
          actor_role_value IN ('admin', 'sales_manager', 'onground_agent_manager')
          OR unit.current_agent_id = actor_agent_id
        )
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Only owned unsold custody units can be returned.'
        USING ERRCODE = '55000';
    END IF;
    IF (
      SELECT count(DISTINCT unit.current_agent_id)
      FROM public.product_inventory_units unit
      JOIN jsonb_array_elements_text(units_value) item(value)
        ON unit.id = item.value::uuid
      WHERE unit.organization_id = p_org_id
    ) <> 1 THEN
      RAISE EXCEPTION 'One return command must contain custody from one agent.'
        USING ERRCODE = '23514';
    END IF;
    SELECT unit.current_agent_id INTO custody_agent_id
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value)
      ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id
    LIMIT 1;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      to_warehouse_id, from_agent_id, handover_id,
      reason, performed_by, metadata
    )
    SELECT
      p_org_id, unit.id, 'agent_return',
      warehouse_row.id, unit.current_agent_id, unit.current_handover_id,
      btrim(p_payload->>'reason'), p_actor_user_id,
      jsonb_build_object('command_id', p_command_id)
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value)
      ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id;

    UPDATE public.product_handover_lines line
    SET line_status = 'returned',
        closed_at = now(),
        updated_at = now()
    FROM public.product_inventory_units unit,
      jsonb_array_elements_text(units_value) item(value)
    WHERE unit.organization_id = p_org_id
      AND unit.id = item.value::uuid
      AND line.organization_id = p_org_id
      AND line.handover_id = unit.current_handover_id
      AND line.unit_id = unit.id
      AND line.line_status IN ('pending', 'accepted');

    UPDATE public.product_inventory_units unit
    SET status = 'in_stock',
        warehouse_id = warehouse_row.id,
        current_agent_id = NULL,
        current_handover_id = NULL,
        assigned_at = NULL,
        version = version + 1,
        updated_at = now()
    FROM jsonb_array_elements_text(units_value) item(value)
    WHERE unit.organization_id = p_org_id
      AND unit.id = item.value::uuid;

    UPDATE public.product_handovers handover
    SET status = 'completed',
        completed_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE handover.organization_id = p_org_id
      AND handover.id IN (
        SELECT DISTINCT line.handover_id
        FROM public.product_handover_lines line
        WHERE line.organization_id = p_org_id
          AND line.unit_id IN (
            SELECT item.value::uuid FROM jsonb_array_elements_text(units_value) item(value)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.product_handover_lines open_line
        WHERE open_line.organization_id = p_org_id
          AND open_line.handover_id = handover.id
          AND open_line.line_status IN ('pending', 'accepted')
      );

    topic_value := 'product_inventory.agent_returned';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'return_id', entity_id_value,
      'agent_id', custody_agent_id,
      'warehouse_id', warehouse_row.id,
      'unit_count', unit_count_value,
      'reason', btrim(p_payload->>'reason'),
      'version', 1
    );
    result_value := jsonb_build_object(
      'return_id', entity_id_value,
      'unit_count', unit_count_value,
      'warehouse_id', warehouse_row.id
    );

  ELSIF p_action = 'price_override_request' THEN
    IF actor_role_value <> 'field_agent' THEN
      RAISE EXCEPTION 'Only the assigned agent can request a sale-price exception.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'request_id', '')::uuid;
    price_value := COALESCE(NULLIF(p_payload->>'requested_price', '')::numeric, 0);
    IF entity_id_value IS NULL OR price_value <= 0
       OR length(btrim(COALESCE(p_payload->>'reason', ''))) < 5 THEN
      RAISE EXCEPTION 'Price exception id, price, and reason are required.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
    FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status <> 'with_agent'
       OR unit_row.current_agent_id <> actor_agent_id
       OR unit_row.current_handover_id IS NULL THEN
      RAISE EXCEPTION 'Price exception requires a unit in the agent custody.'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.product_price_override_requests (
      id, organization_id, unit_id, handover_id, agent_id,
      requested_price, currency, reason, requested_by
    )
    VALUES (
      entity_id_value, p_org_id, unit_row.id, unit_row.current_handover_id,
      actor_agent_id, price_value, unit_row.currency,
      btrim(p_payload->>'reason'), p_actor_user_id
    )
    RETURNING * INTO override_row;

    topic_value := 'product_inventory.price_override_requested';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'request_id', override_row.id,
      'unit_id', override_row.unit_id,
      'agent_id', override_row.agent_id,
      'requested_price', override_row.requested_price,
      'currency', override_row.currency,
      'version', override_row.version
    );
    result_value := jsonb_build_object('request', to_jsonb(override_row));

  ELSIF p_action = 'price_override_review' THEN
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can review price exceptions.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'request_id', '')::uuid;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    decision_value := lower(btrim(COALESCE(p_payload->>'decision', '')));
    IF decision_value NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Price exception decision is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO override_row
    FROM public.product_price_override_requests request
    WHERE request.organization_id = p_org_id AND request.id = entity_id_value
    FOR UPDATE;
    IF override_row.id IS NULL THEN
      RAISE EXCEPTION 'Price exception request was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF override_row.status <> 'pending'
       OR override_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Price exception request changed before review.'
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_price_override_requests
    SET status = decision_value,
        reviewed_by = p_actor_user_id,
        reviewed_at = now(),
        review_note = NULLIF(btrim(p_payload->>'review_note'), ''),
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = override_row.id
    RETURNING * INTO override_row;

    topic_value := 'product_inventory.price_override_reviewed';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'request_id', override_row.id,
      'unit_id', override_row.unit_id,
      'agent_id', override_row.agent_id,
      'decision', override_row.status,
      'requested_price', override_row.requested_price,
      'currency', override_row.currency,
      'version', override_row.version
    );
    result_value := jsonb_build_object('request', to_jsonb(override_row));

  ELSIF p_action = 'sale' THEN
    IF actor_role_value <> 'field_agent' THEN
      RAISE EXCEPTION 'Only an active field agent can record a product sale.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'sale_id', '')::uuid;
    price_value := COALESCE(NULLIF(p_payload->>'actual_sale_price', '')::numeric, 0);
    date_value := COALESCE(NULLIF(p_payload->>'sale_date', '')::date, CURRENT_DATE);
    IF entity_id_value IS NULL OR price_value <= 0
       OR p_payload->>'payment_method' NOT IN (
         'cash', 'bank_transfer', 'card', 'electronic', 'agent_credit'
       ) THEN
      RAISE EXCEPTION 'Sale id, actual price, and payment method are required.'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
    FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status <> 'with_agent'
       OR unit_row.current_agent_id <> actor_agent_id
       OR unit_row.current_handover_id IS NULL
       OR unit_row.current_sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only an unsold unit in the current agent custody can be sold.'
        USING ERRCODE = '55000';
    END IF;

    SELECT
      line.minimum_sale_price,
      line.maximum_sale_price,
      line.tax_included
    INTO minimum_price_value, maximum_price_value, tax_included_value
    FROM public.product_handover_lines line
    WHERE line.organization_id = p_org_id
      AND line.handover_id = unit_row.current_handover_id
      AND line.unit_id = unit_row.id
      AND line.line_status = 'accepted'
    FOR UPDATE;
    IF minimum_price_value IS NULL THEN
      RAISE EXCEPTION 'Accepted handover price policy was not found.'
        USING ERRCODE = '55000';
    END IF;

    IF price_value < minimum_price_value OR price_value > maximum_price_value
       OR price_value < unit_row.unit_cost_snapshot THEN
      SELECT * INTO override_row
      FROM public.product_price_override_requests request
      WHERE request.organization_id = p_org_id
        AND request.id = NULLIF(p_payload->>'price_override_request_id', '')::uuid
        AND request.unit_id = unit_row.id
        AND request.handover_id = unit_row.current_handover_id
        AND request.agent_id = actor_agent_id
        AND request.status = 'approved'
        AND request.requested_price = price_value
      FOR UPDATE;
      IF override_row.id IS NULL THEN
        RAISE EXCEPTION 'The sale price is outside policy and needs manager approval.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT COALESCE(tax.rate, 0)
    INTO vat_rate_value
    FROM public.sales_products product
    LEFT JOIN public.accounting_tax_rates tax
      ON tax.organization_id = p_org_id
     AND tax.id = product.tax_rate_id
     AND tax.is_active
    WHERE product.organization_id = p_org_id
      AND product.id = unit_row.product_id;
    vat_rate_value := COALESCE(vat_rate_value, 0);
    IF tax_included_value AND vat_rate_value > 0 THEN
      net_value := round(price_value / (1 + vat_rate_value / 100), 2);
      vat_value := price_value - net_value;
      total_value := price_value;
    ELSE
      net_value := price_value;
      vat_value := round(price_value * vat_rate_value / 100, 2);
      total_value := price_value + vat_value;
    END IF;

    SELECT CASE product.agent_commission_type
      WHEN 'flat' THEN product.agent_commission_value
      WHEN 'percentage' THEN round(net_value * product.agent_commission_value / 100, 2)
      ELSE 0
    END
    INTO commission_value
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id AND product.id = unit_row.product_id;
    commission_value := COALESCE(commission_value, 0);

    INSERT INTO public.agent_product_sales (
      id, organization_id, sale_no, agent_id, sale_date,
      customer_name, customer_phone, customer_reference, payment_method,
      subtotal, discount, vat_amount, total_amount, status,
      accounting_status, created_by
    )
    VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'sale', date_value),
      actor_agent_id, date_value,
      NULLIF(btrim(p_payload->>'customer_name'), ''),
      NULLIF(btrim(p_payload->>'customer_phone'), ''),
      NULLIF(btrim(p_payload->>'customer_reference'), ''),
      p_payload->>'payment_method',
      net_value, 0, vat_value, total_value, 'active',
      CASE WHEN unit_row.ownership_type = 'consignment' THEN 'not_required' ELSE 'pending' END,
      p_actor_user_id
    )
    RETURNING * INTO sale_row;

    INSERT INTO public.agent_product_sale_lines (
      organization_id, sale_id, unit_id, handover_id, product_id,
      serial_snapshot, product_name_snapshot, unit_cost_snapshot,
      planned_sale_price_snapshot, minimum_sale_price_snapshot,
      maximum_sale_price_snapshot, actual_sale_price, net_amount,
      vat_rate, vat_amount, total_amount, gross_profit, currency,
      commission_rule_snapshot, agent_commission_amount,
      price_override_request_id
    )
    SELECT
      p_org_id, sale_row.id, unit_row.id, unit_row.current_handover_id,
      unit_row.product_id, unit_row.raw_serial_number, product.name,
      unit_row.unit_cost_snapshot, unit_row.planned_sale_price_snapshot,
      minimum_price_value, maximum_price_value, price_value, net_value,
      vat_rate_value, vat_value, total_value,
      net_value - unit_row.unit_cost_snapshot, unit_row.currency,
      jsonb_build_object(
        'type', product.agent_commission_type,
        'value', product.agent_commission_value,
        'base', 'net_amount'
      ),
      commission_value, override_row.id
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id AND product.id = unit_row.product_id;

    UPDATE public.product_price_override_requests
    SET status = 'used',
        used_sale_id = sale_row.id,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = override_row.id;

    UPDATE public.product_handover_lines
    SET line_status = 'sold',
        closed_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id
      AND handover_id = unit_row.current_handover_id
      AND unit_id = unit_row.id
      AND line_status = 'accepted';

    UPDATE public.product_inventory_units
    SET status = 'sold',
        current_agent_id = NULL,
        sold_at = now(),
        sold_by_agent_id = actor_agent_id,
        current_sale_id = sale_row.id,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = unit_row.id;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      from_agent_id, handover_id, sale_id,
      reason, performed_by, metadata
    )
    VALUES (
      p_org_id, unit_row.id, 'sale', actor_agent_id,
      unit_row.current_handover_id, sale_row.id,
      'Serialized product sold by assigned agent', p_actor_user_id,
      jsonb_build_object(
        'sale_no', sale_row.sale_no,
        'actual_sale_price', price_value,
        'total_amount', total_value,
        'command_id', p_command_id
      )
    );

    UPDATE public.product_handovers handover
    SET status = 'completed',
        completed_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE handover.organization_id = p_org_id
      AND handover.id = unit_row.current_handover_id
      AND NOT EXISTS (
        SELECT 1 FROM public.product_handover_lines open_line
        WHERE open_line.organization_id = p_org_id
          AND open_line.handover_id = handover.id
          AND open_line.line_status IN ('pending', 'accepted')
      );

    topic_value := 'product_inventory.sale_recorded';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'sale_id', sale_row.id,
      'sale_no', sale_row.sale_no,
      'unit_id', unit_row.id,
      'agent_id', actor_agent_id,
      'agent_user_id', p_actor_user_id,
      'total_amount', sale_row.total_amount,
      'net_amount', sale_row.subtotal,
      'vat_amount', sale_row.vat_amount,
      'unit_cost', unit_row.unit_cost_snapshot,
      'gross_profit', net_value - unit_row.unit_cost_snapshot,
      'accounting_status', sale_row.accounting_status,
      'version', sale_row.version
    );
    result_value := jsonb_build_object('sale', to_jsonb(sale_row));

  ELSIF p_action = 'sale_void' THEN
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can void a product sale.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'sale_id', '')::uuid;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    disposition_value := lower(btrim(COALESCE(p_payload->>'return_disposition', 'sellable')));
    IF disposition_value NOT IN ('sellable', 'damaged')
       OR length(btrim(COALESCE(p_payload->>'reason', ''))) < 5 THEN
      RAISE EXCEPTION 'Void reason and valid return disposition are required.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO sale_row
    FROM public.agent_product_sales sale
    WHERE sale.organization_id = p_org_id AND sale.id = entity_id_value
    FOR UPDATE;
    IF sale_row.id IS NULL THEN
      RAISE EXCEPTION 'Product sale was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF sale_row.status <> 'active' OR sale_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Sale is no longer active at the requested version.'
        USING ERRCODE = '40001';
    END IF;
    SELECT unit.* INTO unit_row
    FROM public.product_inventory_units unit
    JOIN public.agent_product_sale_lines line
      ON line.organization_id = p_org_id
     AND line.sale_id = sale_row.id
     AND line.unit_id = unit.id
    WHERE unit.organization_id = p_org_id
    FOR UPDATE OF unit;
    IF unit_row.id IS NULL OR unit_row.status <> 'sold'
       OR unit_row.current_sale_id <> sale_row.id THEN
      RAISE EXCEPTION 'Sold unit state changed before sale void.'
        USING ERRCODE = '40001';
    END IF;
    SELECT * INTO handover_row
    FROM public.product_handovers handover
    WHERE handover.organization_id = p_org_id
      AND handover.id = unit_row.current_handover_id;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Original handover was not found.' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      to_warehouse_id, from_agent_id, handover_id, sale_id,
      reason, performed_by, metadata
    )
    VALUES (
      p_org_id, unit_row.id, 'sale_void',
      CASE WHEN disposition_value = 'sellable' THEN handover_row.warehouse_id END,
      sale_row.agent_id, handover_row.id, sale_row.id,
      btrim(p_payload->>'reason'), p_actor_user_id,
      jsonb_build_object(
        'sale_no', sale_row.sale_no,
        'return_disposition', disposition_value,
        'unit_cost_snapshot', unit_row.unit_cost_snapshot,
        'command_id', p_command_id
      )
    );

    UPDATE public.product_inventory_units
    SET status = CASE WHEN disposition_value = 'sellable' THEN 'in_stock' ELSE 'damaged' END,
        warehouse_id = CASE WHEN disposition_value = 'sellable' THEN handover_row.warehouse_id ELSE NULL END,
        current_agent_id = NULL,
        current_handover_id = NULL,
        current_sale_id = NULL,
        assigned_at = NULL,
        sold_at = NULL,
        sold_by_agent_id = NULL,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = unit_row.id;

    UPDATE public.product_handover_lines
    SET line_status = 'voided',
        closed_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id
      AND handover_id = handover_row.id
      AND unit_id = unit_row.id;

    UPDATE public.agent_product_sales
    SET status = 'voided',
        voided_by = p_actor_user_id,
        voided_at = now(),
        void_reason = btrim(p_payload->>'reason'),
        return_disposition = disposition_value,
        accounting_status = CASE
          WHEN accounting_status = 'posted' THEN 'pending'
          WHEN accounting_status = 'not_required' THEN 'not_required'
          ELSE 'reversed'
        END,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = sale_row.id
    RETURNING * INTO sale_row;

    topic_value := 'product_inventory.sale_voided';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'sale_id', sale_row.id,
      'sale_no', sale_row.sale_no,
      'unit_id', unit_row.id,
      'agent_id', sale_row.agent_id,
      'total_amount', sale_row.total_amount,
      'return_disposition', disposition_value,
      'reason', sale_row.void_reason,
      'version', sale_row.version
    );
    result_value := jsonb_build_object('sale', to_jsonb(sale_row));

  ELSE
    IF actor_role_value NOT IN ('admin', 'sales_manager', 'onground_agent_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can post an agent collection.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'collection_id', '')::uuid;
    price_value := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
    date_value := COALESCE(NULLIF(p_payload->>'collection_date', '')::date, CURRENT_DATE);
    IF entity_id_value IS NULL OR price_value <= 0
       OR p_payload->>'payment_method' NOT IN (
         'cash', 'bank_transfer', 'card', 'electronic'
       ) THEN
      RAISE EXCEPTION 'Collection id, amount, and payment method are required.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO agent_row
    FROM public.field_agents agent
    WHERE agent.organization_id = p_org_id
      AND agent.id = NULLIF(p_payload->>'agent_id', '')::uuid
      AND agent.status = 'active'
    FOR UPDATE;
    IF agent_row.id IS NULL THEN
      RAISE EXCEPTION 'Active field agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT
      COALESCE((
        SELECT sum(sale.total_amount)
        FROM public.agent_product_sales sale
        WHERE sale.organization_id = p_org_id
          AND sale.agent_id = agent_row.id
          AND sale.status = 'active'
      ), 0)
      - COALESCE((
        SELECT sum(collection.amount)
        FROM public.agent_product_collections collection
        WHERE collection.organization_id = p_org_id
          AND collection.agent_id = agent_row.id
          AND collection.status = 'posted'
      ), 0)
    INTO outstanding_value;
    IF price_value > outstanding_value + 0.005 THEN
      RAISE EXCEPTION 'Collection exceeds the agent outstanding product balance.'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.agent_product_collections (
      id, organization_id, collection_no, agent_id, amount,
      payment_method, reference, collection_date, notes,
      status, accounting_status, collected_by
    )
    VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'collection', date_value),
      agent_row.id, price_value, p_payload->>'payment_method',
      NULLIF(btrim(p_payload->>'reference'), ''), date_value,
      NULLIF(btrim(p_payload->>'notes'), ''), 'posted', 'pending', p_actor_user_id
    )
    RETURNING collection_no INTO decision_value;

    topic_value := 'product_inventory.collection_posted';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'collection_id', entity_id_value,
      'agent_id', agent_row.id,
      'amount', price_value,
      'payment_method', p_payload->>'payment_method',
      'collection_date', date_value,
      'outstanding_after', outstanding_value - price_value,
      'accounting_status', 'pending',
      'version', 1
    );
    result_value := jsonb_build_object(
      'collection', (
        SELECT to_jsonb(collection)
        FROM public.agent_product_collections collection
        WHERE collection.organization_id = p_org_id AND collection.id = entity_id_value
      ),
      'outstanding_after', outstanding_value - price_value
    );
  END IF;

  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version,
    payload, payload_hash, status, request_id,
    actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_commerce',
    COALESCE(entity_id_value::text, p_command_id::text) || ':' || p_action,
    COALESCE((event_payload->>'version')::integer, 1),
    event_payload, event_hash_value, 'completed',
    p_request_id, p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;

  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, topic_value, event_payload, event_hash_value
  );

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    topic_value, 'product_inventory_commerce',
    COALESCE(entity_id_value::text, p_command_id::text),
    'success', 200,
    result_value - 'sale' - 'handover' - 'request' - 'collection'
  );

  UPDATE public.product_inventory_commands
  SET entity_id = entity_id_value,
      status = 'completed',
      result = result_value,
      completed_at = now()
  WHERE id = command_row.id;

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.next_product_commerce_number(uuid, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_product_commerce_number(uuid, text, date)
  TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_commerce_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_commerce_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_product_commerce_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS
  'Atomically moves serialized products through handover, agent custody, controlled sale, return, void, and collection workflows.';
