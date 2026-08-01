-- Serialized product distribution from field agents to their owned traders.
-- Additive and feature-flagged. Finance remains the owner of receiving and
-- warehouse-to-agent custody.

ALTER TABLE public.product_inventory_commerce_settings
  ADD COLUMN IF NOT EXISTS product_trader_distribution_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_trader_handover_acknowledgment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_trader_signature boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_onground_manager_on_behalf_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merchant_product_settlement_model text NOT NULL DEFAULT 'sale_proceeds'
    CHECK (merchant_product_settlement_model IN ('sale_proceeds')),
  ADD COLUMN IF NOT EXISTS net_product_commission_at_settlement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_trader_handover_units integer NOT NULL DEFAULT 100
    CHECK (max_trader_handover_units BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS trader_handover_expiry_hours integer NOT NULL DEFAULT 48
    CHECK (trader_handover_expiry_hours BETWEEN 1 AND 720);

ALTER TABLE public.sales_products
  ADD COLUMN IF NOT EXISTS merchant_sales_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trader_commission_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS trader_commission_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trader_commission_base text NOT NULL DEFAULT 'net_amount',
  ADD COLUMN IF NOT EXISTS agent_chain_commission_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS agent_chain_commission_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_chain_commission_base text NOT NULL DEFAULT 'net_amount';

ALTER TABLE public.sales_products
  DROP CONSTRAINT IF EXISTS sales_products_trader_commission_check;
ALTER TABLE public.sales_products
  ADD CONSTRAINT sales_products_trader_commission_check CHECK (
    trader_commission_type IN ('none', 'flat', 'percentage')
    AND trader_commission_value >= 0
    AND (trader_commission_type <> 'none' OR trader_commission_value = 0)
    AND (trader_commission_type <> 'percentage' OR trader_commission_value <= 100)
    AND trader_commission_base IN ('net_amount', 'gross_amount')
    AND agent_chain_commission_type IN ('none', 'flat', 'percentage')
    AND agent_chain_commission_value >= 0
    AND (agent_chain_commission_type <> 'none' OR agent_chain_commission_value = 0)
    AND (agent_chain_commission_type <> 'percentage' OR agent_chain_commission_value <= 100)
    AND agent_chain_commission_base IN ('net_amount', 'gross_amount')
  );

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS current_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_trader_handover_id uuid,
  ADD COLUMN IF NOT EXISTS merchant_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS sold_by_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merchant_sales_enabled_snapshot boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trader_commission_rule_snapshot jsonb NOT NULL DEFAULT '{"type":"none","value":0,"base":"net_amount"}'::jsonb,
  ADD COLUMN IF NOT EXISTS agent_chain_commission_rule_snapshot jsonb NOT NULL DEFAULT '{"type":"none","value":0,"base":"net_amount"}'::jsonb,
  ADD COLUMN IF NOT EXISTS custody_version integer NOT NULL DEFAULT 1 CHECK (custody_version >= 1);

UPDATE public.product_inventory_units unit
SET merchant_sales_enabled_snapshot = product.merchant_sales_enabled,
    trader_commission_rule_snapshot = jsonb_build_object(
      'type', product.trader_commission_type,
      'value', product.trader_commission_value,
      'base', product.trader_commission_base
    ),
    agent_chain_commission_rule_snapshot = jsonb_build_object(
      'type', product.agent_chain_commission_type,
      'value', product.agent_chain_commission_value,
      'base', product.agent_chain_commission_base
    )
FROM public.sales_products product
WHERE product.organization_id = unit.organization_id AND product.id = unit.product_id;

ALTER TABLE public.product_inventory_units
  DROP CONSTRAINT IF EXISTS product_inventory_units_status_check,
  DROP CONSTRAINT IF EXISTS product_inventory_units_custody_holder_check,
  DROP CONSTRAINT IF EXISTS product_inventory_units_trader_snapshot_check;
ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_status_check CHECK (status IN (
    'in_stock', 'reserved', 'in_transit', 'with_agent',
    'merchant_in_transit', 'with_merchant', 'with_custodian',
    'return_pending', 'return_approved', 'sold', 'returned', 'quarantine',
    'damaged', 'lost'
  )),
  ADD CONSTRAINT product_inventory_units_custody_holder_check CHECK (
    NOT (current_agent_id IS NOT NULL AND current_custodian_employee_id IS NOT NULL)
    AND NOT (current_merchant_id IS NOT NULL AND current_custodian_employee_id IS NOT NULL)
    AND (current_merchant_id IS NULL OR current_agent_id IS NOT NULL)
    AND (
      current_custodian_employee_id IS NULL
      OR (current_custodian_assignment_id IS NOT NULL
          AND current_project_id IS NOT NULL
          AND NULLIF(btrim(current_city_snapshot), '') IS NOT NULL)
    )
    AND (status NOT IN ('merchant_in_transit', 'with_merchant') OR (
      current_agent_id IS NOT NULL
      AND current_merchant_id IS NOT NULL
      AND current_trader_handover_id IS NOT NULL
    ))
    AND (current_merchant_id IS NULL OR status IN (
      'merchant_in_transit', 'with_merchant', 'return_pending', 'return_approved'
    ))
  ),
  ADD CONSTRAINT product_inventory_units_trader_snapshot_check CHECK (
    jsonb_typeof(trader_commission_rule_snapshot) = 'object'
    AND jsonb_typeof(agent_chain_commission_rule_snapshot) = 'object'
  );

CREATE INDEX IF NOT EXISTS product_inventory_units_merchant_custody_idx
  ON public.product_inventory_units (
    organization_id, current_merchant_id, status, product_id, merchant_assigned_at
  ) WHERE current_merchant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_inventory_units_agent_merchant_idx
  ON public.product_inventory_units (organization_id, current_agent_id, current_merchant_id, status);

CREATE TABLE IF NOT EXISTS public.product_trader_number_sequences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_year integer NOT NULL,
  last_number bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sequence_year)
);

CREATE OR REPLACE FUNCTION public.next_product_trader_handover_number(
  p_org_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  year_value integer := EXTRACT(YEAR FROM p_date)::integer;
  sequence_value bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.product_trader_number_sequences (
    organization_id, sequence_year, last_number
  ) VALUES (p_org_id, year_value, 1)
  ON CONFLICT (organization_id, sequence_year) DO UPDATE
  SET last_number = public.product_trader_number_sequences.last_number + 1,
      updated_at = now()
  RETURNING last_number INTO sequence_value;
  RETURN 'PTH-' || year_value::text || '-' || lpad(sequence_value::text, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_trader_handovers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  handover_no text NOT NULL,
  source_agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN (
    'draft', 'issued', 'partially_accepted', 'accepted', 'rejected', 'cancelled', 'completed'
  )),
  require_acknowledgment boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, handover_no)
);

ALTER TABLE public.product_inventory_units
  DROP CONSTRAINT IF EXISTS product_inventory_units_current_trader_handover_fk;
ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_current_trader_handover_fk
  FOREIGN KEY (current_trader_handover_id)
  REFERENCES public.product_trader_handovers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.product_trader_handover_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  handover_id uuid NOT NULL REFERENCES public.product_trader_handovers(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  serial_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  planned_sale_price_snapshot numeric(14,2) NOT NULL CHECK (planned_sale_price_snapshot > 0),
  minimum_sale_price_snapshot numeric(14,2) NOT NULL CHECK (minimum_sale_price_snapshot > 0),
  maximum_sale_price_snapshot numeric(14,2) NOT NULL CHECK (maximum_sale_price_snapshot > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  trader_commission_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(trader_commission_rule_snapshot) = 'object'),
  agent_chain_commission_rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(agent_chain_commission_rule_snapshot) = 'object'),
  commercial_terms_revision_snapshot integer NOT NULL DEFAULT 1 CHECK (commercial_terms_revision_snapshot > 0),
  line_status text NOT NULL DEFAULT 'pending' CHECK (line_status IN (
    'pending', 'accepted', 'rejected_missing', 'rejected_damaged',
    'sold', 'returned', 'cancelled'
  )),
  accepted_condition text CHECK (accepted_condition IS NULL OR accepted_condition IN ('new', 'open_box', 'refurbished', 'damaged')),
  acceptance_note text,
  accepted_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_sale_price_snapshot <= planned_sale_price_snapshot
    AND planned_sale_price_snapshot <= maximum_sale_price_snapshot),
  UNIQUE (handover_id, unit_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_trader_handover_one_open_unit_idx
  ON public.product_trader_handover_lines (organization_id, unit_id)
  WHERE line_status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS product_trader_handovers_actor_status_idx
  ON public.product_trader_handovers (
    organization_id, source_agent_id, merchant_id, status, issued_at DESC
  );
CREATE INDEX IF NOT EXISTS product_trader_handovers_expiry_idx
  ON public.product_trader_handovers (status, expires_at)
  WHERE status = 'issued';

CREATE TABLE IF NOT EXISTS public.product_trader_handover_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  handover_id uuid NOT NULL REFERENCES public.product_trader_handovers(id) ON DELETE CASCADE,
  merchant_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signature_data text NOT NULL CHECK (length(signature_data) BETWEEN 20 AND 1000000),
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handover_id, merchant_user_id)
);

CREATE TABLE IF NOT EXISTS public.product_trader_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'trader_handover_issue', 'trader_handover_accept',
    'trader_handover_reject', 'trader_handover_cancel'
  )),
  entity_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  error_code text,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.product_inventory_movements
  ADD COLUMN IF NOT EXISTS from_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_merchant_id uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trader_handover_id uuid REFERENCES public.product_trader_handovers(id) ON DELETE SET NULL;
ALTER TABLE public.product_inventory_movements
  DROP CONSTRAINT IF EXISTS product_inventory_movements_movement_type_check;
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_movement_type_check CHECK (movement_type IN (
    'receipt', 'reserve', 'handover_issued', 'handover_accepted',
    'employee_handover_issued', 'employee_handover_accepted',
    'trader_handover_issued', 'trader_handover_accepted',
    'trader_handover_rejected', 'trader_return',
    'agent_return', 'sale', 'sale_void', 'customer_return',
    'return_reserved', 'return_rejected', 'return_approved', 'return_received',
    'quarantine', 'damage', 'loss', 'adjustment'
  ));

CREATE INDEX IF NOT EXISTS product_inventory_movements_trader_idx
  ON public.product_inventory_movements (
    organization_id, trader_handover_id, to_merchant_id, movement_at DESC
  ) WHERE trader_handover_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.snapshot_product_trader_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  product_row public.sales_products%ROWTYPE;
BEGIN
  SELECT * INTO product_row FROM public.sales_products product
  WHERE product.organization_id = NEW.organization_id AND product.id = NEW.product_id;
  IF product_row.id IS NULL THEN
    RAISE EXCEPTION 'Product was not found.' USING ERRCODE = 'P0002';
  END IF;
  NEW.merchant_sales_enabled_snapshot := product_row.merchant_sales_enabled;
  NEW.trader_commission_rule_snapshot := jsonb_build_object(
    'type', product_row.trader_commission_type,
    'value', product_row.trader_commission_value,
    'base', product_row.trader_commission_base
  );
  NEW.agent_chain_commission_rule_snapshot := jsonb_build_object(
    'type', product_row.agent_chain_commission_type,
    'value', product_row.agent_chain_commission_value,
    'base', product_row.agent_chain_commission_base
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_product_trader_terms ON public.product_inventory_units;
CREATE TRIGGER trg_snapshot_product_trader_terms
  BEFORE INSERT ON public.product_inventory_units
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_product_trader_terms();

ALTER TABLE public.product_trader_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_handover_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_handover_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_trader_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_trader_handovers_select ON public.product_trader_handovers
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR source_agent_id = public.current_field_agent_id()
        OR merchant_id = public.current_merchant_id()
      )
    )
  );
CREATE POLICY product_trader_handover_lines_select ON public.product_trader_handover_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.product_trader_handovers handover
      WHERE handover.id = handover_id
        AND handover.organization_id = organization_id
        AND handover.organization_id = public.current_org_id()
        AND (
          public.can_view_product_inventory()
          OR handover.source_agent_id = public.current_field_agent_id()
          OR handover.merchant_id = public.current_merchant_id()
        )
    )
  );
CREATE POLICY product_trader_handover_signatures_select ON public.product_trader_handover_signatures
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR merchant_user_id = auth.uid()
      )
    )
  );
CREATE POLICY product_trader_service_write ON public.product_trader_handovers
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY product_trader_lines_service_write ON public.product_trader_handover_lines
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY product_trader_signatures_service_write ON public.product_trader_handover_signatures
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY product_trader_commands_service ON public.product_trader_commands
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

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
        OR current_merchant_id = public.current_merchant_id()
        OR sold_by_merchant_id = public.current_merchant_id()
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
        OR from_merchant_id = public.current_merchant_id()
        OR to_merchant_id = public.current_merchant_id()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.execute_product_trader_custody_command(
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
  actor_role_value text;
  actor_agent_id uuid;
  actor_merchant_id uuid;
  command_row public.product_trader_commands%ROWTYPE;
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
  handover_row public.product_trader_handovers%ROWTYPE;
  merchant_row public.merchants%ROWTYPE;
  source_agent_row public.field_agents%ROWTYPE;
  payload_hash_value text;
  unit_ids uuid[] := ARRAY[]::uuid[];
  accepted_ids uuid[] := ARRAY[]::uuid[];
  rejected_missing_ids uuid[] := ARRAY[]::uuid[];
  rejected_damaged_ids uuid[] := ARRAY[]::uuid[];
  affected_count integer := 0;
  accepted_count integer := 0;
  rejected_count integer := 0;
  expected_version_value integer;
  result_value jsonb;
  topic_value text;
  event_payload jsonb;
  event_hash text;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_action IS NULL
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Trader custody command input is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN (
    'trader_handover_issue', 'trader_handover_accept',
    'trader_handover_reject', 'trader_handover_cancel'
  ) THEN
    RAISE EXCEPTION 'Unsupported trader custody action.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text, agent.id, merchant.id
  INTO actor_role_value, actor_agent_id, actor_merchant_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.field_agents agent
    ON agent.organization_id = member.org_id AND agent.user_id = member.user_id
      AND agent.status = 'active'
  LEFT JOIN public.merchants merchant
    ON merchant.organization_id = member.org_id AND merchant.user_id = member.user_id
      AND merchant.status = 'active'
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager', 'onground_agent_manager', 'field_agent', 'merchant'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product trader distribution access is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO settings_row FROM public.product_inventory_commerce_settings
  WHERE organization_id = p_org_id;
  IF settings_row.organization_id IS NULL THEN
    INSERT INTO public.product_inventory_commerce_settings (organization_id)
    VALUES (p_org_id) RETURNING * INTO settings_row;
  END IF;
  IF NOT settings_row.product_trader_distribution_enabled THEN
    RAISE EXCEPTION 'Product trader distribution is disabled.' USING ERRCODE = '55000';
  END IF;

  payload_hash_value := encode(digest(jsonb_build_object(
    'action', p_action, 'payload', p_payload
  )::text, 'sha256'), 'hex');
  INSERT INTO public.product_trader_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_action,
    NULLIF(p_payload->>'handover_id', '')::uuid, payload_hash_value,
    p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.product_trader_commands command
  WHERE command.organization_id = p_org_id AND command.idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> p_action OR command_row.payload_hash <> payload_hash_value
     OR command_row.actor_user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Trader custody idempotency key was reused.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;

  IF p_action = 'trader_handover_issue' THEN
    IF actor_role_value = 'field_agent' THEN
      IF actor_agent_id IS NULL THEN
        RAISE EXCEPTION 'An active field-agent identity is required.' USING ERRCODE = '42501';
      END IF;
    ELSIF actor_role_value NOT IN ('admin', 'onground_agent_manager')
       OR NOT settings_row.allow_onground_manager_on_behalf_transfer THEN
      RAISE EXCEPTION 'Only the owning field agent can issue this handover.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO source_agent_row FROM public.field_agents agent
    WHERE agent.organization_id = p_org_id
      AND agent.id = COALESCE(NULLIF(p_payload->>'source_agent_id', '')::uuid, actor_agent_id)
      AND agent.status = 'active' FOR UPDATE;
    IF source_agent_row.id IS NULL
       OR (actor_role_value = 'field_agent' AND source_agent_row.id <> actor_agent_id) THEN
      RAISE EXCEPTION 'Active source field agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO merchant_row FROM public.merchants merchant
    WHERE merchant.organization_id = p_org_id
      AND merchant.id = NULLIF(p_payload->>'merchant_id', '')::uuid
      AND merchant.status = 'active' FOR UPDATE;
    IF merchant_row.id IS NULL OR merchant_row.agent_id <> source_agent_row.id THEN
      RAISE EXCEPTION 'Trader must be active and owned by the source agent.' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(array_agg(value::uuid ORDER BY value), ARRAY[]::uuid[])
    INTO unit_ids FROM jsonb_array_elements_text(COALESCE(p_payload->'unit_ids', '[]'::jsonb)) item(value);
    IF cardinality(unit_ids) < 1
       OR cardinality(unit_ids) > settings_row.max_trader_handover_units
       OR cardinality(ARRAY(SELECT DISTINCT unnest(unit_ids))) <> cardinality(unit_ids) THEN
      RAISE EXCEPTION 'Trader handover unit selection is invalid.' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id AND unit.id = ANY(unit_ids)
    ORDER BY unit.id FOR UPDATE;
    SELECT count(*) INTO affected_count FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id AND unit.id = ANY(unit_ids)
      AND unit.status = 'with_agent'
      AND unit.current_agent_id = source_agent_row.id
      AND unit.current_merchant_id IS NULL
      AND unit.current_trader_handover_id IS NULL
      AND unit.current_custodian_employee_id IS NULL
      AND unit.merchant_sales_enabled_snapshot;
    IF affected_count <> cardinality(unit_ids) THEN
      RAISE EXCEPTION 'All units must be accepted, trader-enabled stock held by the source agent.'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.product_trader_handovers (
      id, organization_id, handover_no, source_agent_id, merchant_id,
      status, require_acknowledgment, expires_at, issued_by, notes
    ) VALUES (
      NULLIF(p_payload->>'handover_id', '')::uuid, p_org_id,
      public.next_product_trader_handover_number(p_org_id, CURRENT_DATE),
      source_agent_row.id, merchant_row.id,
      CASE WHEN settings_row.require_trader_handover_acknowledgment THEN 'issued' ELSE 'accepted' END,
      settings_row.require_trader_handover_acknowledgment,
      now() + make_interval(hours => settings_row.trader_handover_expiry_hours),
      p_actor_user_id, NULLIF(btrim(p_payload->>'notes'), '')
    ) RETURNING * INTO handover_row;

    INSERT INTO public.product_trader_handover_lines (
      organization_id, handover_id, unit_id, product_id, serial_snapshot,
      product_name_snapshot, planned_sale_price_snapshot,
      minimum_sale_price_snapshot, maximum_sale_price_snapshot, currency,
      trader_commission_rule_snapshot, agent_chain_commission_rule_snapshot,
      commercial_terms_revision_snapshot, line_status, accepted_at
    )
    SELECT unit.organization_id, handover_row.id, unit.id, unit.product_id,
      unit.raw_serial_number, product.name, unit.planned_sale_price_snapshot,
      unit.minimum_sale_price_snapshot, unit.maximum_sale_price_snapshot,
      unit.currency, unit.trader_commission_rule_snapshot,
      unit.agent_chain_commission_rule_snapshot,
      unit.commercial_terms_revision_snapshot,
      CASE WHEN handover_row.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
      CASE WHEN handover_row.status = 'accepted' THEN now() END
    FROM public.product_inventory_units unit
    JOIN public.sales_products product
      ON product.organization_id = unit.organization_id AND product.id = unit.product_id
    WHERE unit.organization_id = p_org_id AND unit.id = ANY(unit_ids);

    UPDATE public.product_inventory_units SET
      status = CASE WHEN handover_row.status = 'accepted' THEN 'with_merchant' ELSE 'merchant_in_transit' END,
      current_merchant_id = merchant_row.id,
      current_trader_handover_id = handover_row.id,
      merchant_assigned_at = CASE WHEN handover_row.status = 'accepted' THEN now() END,
      custody_version = custody_version + 1, version = version + 1, updated_at = now()
    WHERE organization_id = p_org_id AND id = ANY(unit_ids);

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, from_agent_id, to_merchant_id,
      trader_handover_id, reason, performed_by, metadata
    ) SELECT p_org_id, unit_id, 'trader_handover_issued', source_agent_row.id,
      merchant_row.id, handover_row.id, NULLIF(btrim(p_payload->>'notes'), ''),
      p_actor_user_id, jsonb_build_object('command_id', p_command_id)
    FROM unnest(unit_ids) unit_id;
    topic_value := 'product_inventory.trader_handover_issued';
    result_value := jsonb_build_object(
      'handover', to_jsonb(handover_row), 'unit_count', cardinality(unit_ids)
    );

  ELSE
    SELECT * INTO handover_row FROM public.product_trader_handovers handover
    WHERE handover.organization_id = p_org_id
      AND handover.id = NULLIF(p_payload->>'handover_id', '')::uuid FOR UPDATE;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Trader product handover was not found.' USING ERRCODE = 'P0002';
    END IF;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    IF handover_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Trader handover version conflict.' USING ERRCODE = '40001';
    END IF;

    IF p_action IN ('trader_handover_accept', 'trader_handover_reject') THEN
      IF actor_role_value <> 'merchant' OR actor_merchant_id <> handover_row.merchant_id THEN
        RAISE EXCEPTION 'Only the assigned trader can respond to this handover.' USING ERRCODE = '42501';
      END IF;
      IF handover_row.status <> 'issued' OR handover_row.expires_at <= now() THEN
        RAISE EXCEPTION 'Only a current issued handover can be processed.' USING ERRCODE = '55000';
      END IF;
    ELSE
      IF actor_role_value = 'field_agent' AND actor_agent_id <> handover_row.source_agent_id THEN
        RAISE EXCEPTION 'Only the source agent can cancel this handover.' USING ERRCODE = '42501';
      END IF;
      IF actor_role_value NOT IN ('field_agent', 'admin', 'onground_agent_manager') THEN
        RAISE EXCEPTION 'Handover cancellation is not allowed.' USING ERRCODE = '42501';
      END IF;
      IF handover_row.status <> 'issued' THEN
        RAISE EXCEPTION 'Only an issued handover can be cancelled.' USING ERRCODE = '55000';
      END IF;
    END IF;

    IF p_action = 'trader_handover_accept' THEN
      SELECT COALESCE(array_agg(value::uuid ORDER BY value), ARRAY[]::uuid[])
      INTO accepted_ids FROM jsonb_array_elements_text(COALESCE(p_payload->'accepted_unit_ids', '[]'::jsonb)) item(value);
      SELECT COALESCE(array_agg((value->>'unit_id')::uuid ORDER BY value->>'unit_id'), ARRAY[]::uuid[])
      INTO rejected_missing_ids FROM jsonb_array_elements(COALESCE(p_payload->'rejected_units', '[]'::jsonb)) item(value)
      WHERE COALESCE(value->>'reason', 'missing') = 'missing';
      SELECT COALESCE(array_agg((value->>'unit_id')::uuid ORDER BY value->>'unit_id'), ARRAY[]::uuid[])
      INTO rejected_damaged_ids FROM jsonb_array_elements(COALESCE(p_payload->'rejected_units', '[]'::jsonb)) item(value)
      WHERE value->>'reason' = 'damaged';
      accepted_count := cardinality(accepted_ids);
      rejected_count := cardinality(rejected_missing_ids) + cardinality(rejected_damaged_ids);
      SELECT count(*) INTO affected_count FROM public.product_trader_handover_lines line
      WHERE line.organization_id = p_org_id AND line.handover_id = handover_row.id
        AND line.line_status = 'pending';
      IF accepted_count + rejected_count <> affected_count
         OR cardinality(ARRAY(
           SELECT DISTINCT id FROM unnest(accepted_ids || rejected_missing_ids || rejected_damaged_ids) id
         )) <> affected_count THEN
        RAISE EXCEPTION 'Every pending handover unit needs one acceptance decision.' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (
        SELECT 1 FROM unnest(accepted_ids || rejected_missing_ids || rejected_damaged_ids) id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.product_trader_handover_lines line
          WHERE line.organization_id = p_org_id AND line.handover_id = handover_row.id
            AND line.unit_id = id AND line.line_status = 'pending'
        )
      ) THEN
        RAISE EXCEPTION 'A handover decision references an invalid unit.' USING ERRCODE = '23514';
      END IF;
      IF settings_row.require_trader_signature
         AND length(COALESCE(p_payload->>'signature_data', '')) < 20 THEN
        RAISE EXCEPTION 'Trader signature is required.' USING ERRCODE = '23514';
      END IF;

      UPDATE public.product_trader_handover_lines SET
        line_status = 'accepted', accepted_condition = 'new',
        accepted_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND unit_id = ANY(accepted_ids) AND line_status = 'pending';
      UPDATE public.product_trader_handover_lines SET
        line_status = 'rejected_missing', closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND unit_id = ANY(rejected_missing_ids) AND line_status = 'pending';
      UPDATE public.product_trader_handover_lines SET
        line_status = 'rejected_damaged', accepted_condition = 'damaged',
        closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND unit_id = ANY(rejected_damaged_ids) AND line_status = 'pending';
      UPDATE public.product_inventory_units SET
        status = 'with_merchant', merchant_assigned_at = now(),
        custody_version = custody_version + 1, version = version + 1, updated_at = now()
      WHERE organization_id = p_org_id AND current_trader_handover_id = handover_row.id
        AND id = ANY(accepted_ids) AND status = 'merchant_in_transit';
      UPDATE public.product_inventory_units SET
        status = CASE WHEN id = ANY(rejected_damaged_ids) THEN 'quarantine' ELSE 'with_agent' END,
        current_merchant_id = NULL, current_trader_handover_id = NULL,
        merchant_assigned_at = NULL, custody_version = custody_version + 1,
        version = version + 1, updated_at = now()
      WHERE organization_id = p_org_id AND current_trader_handover_id = handover_row.id
        AND id = ANY(rejected_missing_ids || rejected_damaged_ids)
        AND status = 'merchant_in_transit';
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_agent_id, to_merchant_id,
        trader_handover_id, performed_by, metadata
      ) SELECT p_org_id, id, 'trader_handover_accepted', handover_row.source_agent_id,
        handover_row.merchant_id, handover_row.id, p_actor_user_id,
        jsonb_build_object('command_id', p_command_id)
      FROM unnest(accepted_ids) id;
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_merchant_id, to_agent_id,
        trader_handover_id, reason, performed_by, metadata
      ) SELECT p_org_id, id, 'trader_handover_rejected', handover_row.merchant_id,
        handover_row.source_agent_id, handover_row.id, 'Trader rejected during acceptance',
        p_actor_user_id, jsonb_build_object('command_id', p_command_id)
      FROM unnest(rejected_missing_ids || rejected_damaged_ids) id;
      IF settings_row.require_trader_signature THEN
        INSERT INTO public.product_trader_handover_signatures (
          organization_id, handover_id, merchant_user_id, signature_data
        ) VALUES (p_org_id, handover_row.id, p_actor_user_id, p_payload->>'signature_data');
      END IF;
      UPDATE public.product_trader_handovers SET
        status = CASE
          WHEN accepted_count > 0 AND rejected_count > 0 THEN 'partially_accepted'
          WHEN accepted_count > 0 THEN 'accepted'
          ELSE 'rejected'
        END,
        accepted_by = CASE WHEN accepted_count > 0 THEN p_actor_user_id END,
        accepted_at = CASE WHEN accepted_count > 0 THEN now() END,
        rejected_by = CASE WHEN rejected_count > 0 THEN p_actor_user_id END,
        rejected_at = CASE WHEN rejected_count > 0 THEN now() END,
        rejection_reason = NULLIF(btrim(p_payload->>'rejection_reason'), ''),
        version = version + 1, updated_at = now()
      WHERE id = handover_row.id RETURNING * INTO handover_row;
      topic_value := CASE WHEN accepted_count > 0 AND rejected_count > 0
        THEN 'product_inventory.trader_handover_partially_accepted'
        WHEN accepted_count > 0 THEN 'product_inventory.trader_handover_accepted'
        ELSE 'product_inventory.trader_handover_rejected' END;
      result_value := jsonb_build_object(
        'handover', to_jsonb(handover_row), 'accepted', accepted_count,
        'rejected', rejected_count
      );

    ELSE
      UPDATE public.product_trader_handover_lines SET
        line_status = CASE WHEN p_action = 'trader_handover_reject' THEN 'rejected_missing' ELSE 'cancelled' END,
        closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND line_status = 'pending';
      UPDATE public.product_inventory_units SET
        status = 'with_agent', current_merchant_id = NULL,
        current_trader_handover_id = NULL, merchant_assigned_at = NULL,
        custody_version = custody_version + 1, version = version + 1, updated_at = now()
      WHERE organization_id = p_org_id AND current_trader_handover_id = handover_row.id
        AND status = 'merchant_in_transit';
      UPDATE public.product_trader_handovers SET
        status = CASE WHEN p_action = 'trader_handover_reject' THEN 'rejected' ELSE 'cancelled' END,
        rejected_by = CASE WHEN p_action = 'trader_handover_reject' THEN p_actor_user_id END,
        rejected_at = CASE WHEN p_action = 'trader_handover_reject' THEN now() END,
        rejection_reason = NULLIF(btrim(COALESCE(
          p_payload->>'rejection_reason', p_payload->>'reason'
        )), ''),
        version = version + 1, updated_at = now()
      WHERE id = handover_row.id RETURNING * INTO handover_row;
      topic_value := CASE WHEN p_action = 'trader_handover_reject'
        THEN 'product_inventory.trader_handover_rejected'
        ELSE 'product_inventory.trader_handover_cancelled' END;
      result_value := jsonb_build_object('handover', to_jsonb(handover_row));
    END IF;
  END IF;

  event_payload := jsonb_build_object(
    'event_type', topic_value,
    'handover_id', handover_row.id,
    'handover_no', handover_row.handover_no,
    'agent_id', handover_row.source_agent_id,
    'merchant_id', handover_row.merchant_id,
    'status', handover_row.status,
    'version', handover_row.version,
    'command_id', p_command_id
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'product_trader_handover', handover_row.id::text,
    handover_row.version, event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (p_org_id, event_id, topic_value, event_payload, event_hash);
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, topic_value,
    'product_trader_handover', handover_row.id::text, 'success', 200, result_value
  );
  UPDATE public.product_trader_commands SET
    status = 'completed', entity_id = handover_row.id, result = result_value,
    completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_product_trader_handovers(
  p_batch_size integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  handover_record record;
  expired_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Batch size is invalid.' USING ERRCODE = '22023';
  END IF;
  FOR handover_record IN
    SELECT id, organization_id FROM public.product_trader_handovers
    WHERE status = 'issued' AND expires_at <= now()
    ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT p_batch_size
  LOOP
    UPDATE public.product_trader_handover_lines SET
      line_status = 'cancelled', closed_at = now(), updated_at = now()
    WHERE handover_id = handover_record.id AND line_status = 'pending';
    UPDATE public.product_inventory_units SET
      status = 'with_agent', current_merchant_id = NULL,
      current_trader_handover_id = NULL, merchant_assigned_at = NULL,
      custody_version = custody_version + 1, version = version + 1, updated_at = now()
    WHERE organization_id = handover_record.organization_id
      AND current_trader_handover_id = handover_record.id
      AND status = 'merchant_in_transit';
    UPDATE public.product_trader_handovers SET
      status = 'cancelled', rejection_reason = 'Expired before trader acceptance',
      version = version + 1, updated_at = now()
    WHERE id = handover_record.id;
    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.next_product_trader_handover_number(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_product_trader_custody_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_product_trader_handovers(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_product_trader_handover_number(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_custody_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_product_trader_handovers(integer) TO service_role;

COMMENT ON FUNCTION public.execute_product_trader_custody_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS 'Atomically issues, accepts, rejects, or cancels serialized field-agent-to-trader product custody.';
