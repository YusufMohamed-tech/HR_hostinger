-- Corrective migration for schemas v156-v159.
--
-- The original migrations are already immutable in deployed environments. This
-- forward migration repairs their runtime contracts, replay safety, custody
-- closure, commercial snapshots, settlement balances, and exception history.

-- ---------------------------------------------------------------------------
-- Settings and immutable commercial snapshots
-- ---------------------------------------------------------------------------
UPDATE public.product_inventory_commerce_settings
SET require_trader_signature = false,
    updated_at = now()
WHERE NOT require_trader_handover_acknowledgment
  AND require_trader_signature;

ALTER TABLE public.product_inventory_commerce_settings
  DROP CONSTRAINT IF EXISTS product_inventory_commerce_settings_trader_signature_requires_ack_check;
ALTER TABLE public.product_inventory_commerce_settings
  ADD CONSTRAINT product_inventory_commerce_settings_trader_signature_requires_ack_check
  CHECK (NOT require_trader_signature OR require_trader_handover_acknowledgment);

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS trader_tax_included_snapshot boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trader_tax_rate_snapshot numeric(5,2) NOT NULL DEFAULT 0;

UPDATE public.product_inventory_units unit
SET trader_tax_included_snapshot = line.tax_included,
    trader_tax_rate_snapshot = COALESCE(tax.rate, 0)
FROM public.product_receipt_lines line
LEFT JOIN public.accounting_tax_rates tax
  ON tax.organization_id = line.organization_id
 AND tax.id = line.tax_rate_id
WHERE line.organization_id = unit.organization_id
  AND line.id = unit.receipt_line_id;

ALTER TABLE public.product_inventory_units
  DROP CONSTRAINT IF EXISTS product_inventory_units_trader_tax_snapshot_check;
ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_trader_tax_snapshot_check
  CHECK (trader_tax_rate_snapshot BETWEEN 0 AND 100);

CREATE OR REPLACE FUNCTION public.snapshot_product_trader_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  product_row public.sales_products%ROWTYPE;
  receipt_line_row public.product_receipt_lines%ROWTYPE;
  tax_rate_value numeric(5,2) := 0;
BEGIN
  SELECT * INTO product_row
  FROM public.sales_products product
  WHERE product.organization_id = NEW.organization_id
    AND product.id = NEW.product_id;
  IF product_row.id IS NULL THEN
    RAISE EXCEPTION 'Product was not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO receipt_line_row
  FROM public.product_receipt_lines line
  WHERE line.organization_id = NEW.organization_id
    AND line.id = NEW.receipt_line_id;
  IF receipt_line_row.id IS NULL THEN
    RAISE EXCEPTION 'Product receipt line was not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(rate.rate, 0) INTO tax_rate_value
  FROM public.accounting_tax_rates rate
  WHERE rate.organization_id = NEW.organization_id
    AND rate.id = receipt_line_row.tax_rate_id;

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
  NEW.trader_tax_included_snapshot := receipt_line_row.tax_included;
  NEW.trader_tax_rate_snapshot := COALESCE(tax_rate_value, 0);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Workflow history and terminal custody states
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_trader_handovers
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.product_trader_handover_lines
  DROP CONSTRAINT IF EXISTS product_trader_handover_lines_line_status_check;
ALTER TABLE public.product_trader_handover_lines
  ADD CONSTRAINT product_trader_handover_lines_line_status_check CHECK (line_status IN (
    'pending', 'accepted', 'rejected_missing', 'rejected_damaged',
    'sold', 'returned', 'lost', 'damaged', 'cancelled'
  ));

ALTER TABLE public.product_trader_returns
  ADD COLUMN IF NOT EXISTS trader_handover_id uuid
    REFERENCES public.product_trader_handovers(id) ON DELETE SET NULL;
ALTER TABLE public.product_trader_losses
  ADD COLUMN IF NOT EXISTS trader_handover_id uuid
    REFERENCES public.product_trader_handovers(id) ON DELETE SET NULL;

ALTER TABLE public.product_trader_losses
  DROP CONSTRAINT IF EXISTS product_trader_losses_unit_id_status_key;

WITH duplicate_returns AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, unit_id ORDER BY requested_at DESC, id DESC
  ) AS position
  FROM public.product_trader_returns
  WHERE status = 'requested'
)
UPDATE public.product_trader_returns target
SET status = 'cancelled',
    review_note = COALESCE(target.review_note, 'Closed by v160 duplicate-open repair'),
    version = target.version + 1,
    updated_at = now()
FROM duplicate_returns duplicate
WHERE target.id = duplicate.id AND duplicate.position > 1;

WITH duplicate_losses AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, unit_id ORDER BY reported_at DESC, id DESC
  ) AS position
  FROM public.product_trader_losses
  WHERE status IN ('reported', 'under_review', 'recognized')
)
UPDATE public.product_trader_losses target
SET status = 'cancelled',
    recovery_note = COALESCE(target.recovery_note, 'Closed by v160 duplicate-open repair'),
    version = target.version + 1,
    updated_at = now()
FROM duplicate_losses duplicate
WHERE target.id = duplicate.id AND duplicate.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS product_trader_return_one_open_unit_idx
  ON public.product_trader_returns (organization_id, unit_id)
  WHERE status = 'requested';
CREATE UNIQUE INDEX IF NOT EXISTS product_trader_loss_one_open_unit_idx
  ON public.product_trader_losses (organization_id, unit_id)
  WHERE status IN ('reported', 'under_review', 'recognized');

-- Repair accepted lines orphaned by the v159 receive/loss paths. Without this,
-- the v156 one-open-custody index prevents the recovered unit being assigned
-- to any trader again.
UPDATE public.product_trader_handover_lines line
SET line_status = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.product_trader_sale_lines sale_line
        WHERE sale_line.unit_id = line.unit_id
          AND sale_line.trader_handover_id = line.handover_id
      ) THEN 'sold'
      WHEN unit.status IN ('lost', 'damaged') THEN
        CASE WHEN unit.status = 'damaged' THEN 'damaged' ELSE 'lost' END
      ELSE 'returned'
    END,
    closed_at = COALESCE(line.closed_at, now()),
    updated_at = now()
FROM public.product_inventory_units unit
WHERE line.organization_id = unit.organization_id
  AND line.unit_id = unit.id
  AND line.line_status = 'accepted'
  AND (
    unit.current_trader_handover_id IS DISTINCT FROM line.handover_id
    OR unit.status NOT IN ('with_merchant', 'return_pending')
  );

UPDATE public.product_inventory_units
SET current_trader_handover_id = NULL,
    merchant_assigned_at = NULL,
    updated_at = now()
WHERE status = 'sold'
  AND (current_trader_handover_id IS NOT NULL OR merchant_assigned_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.refresh_product_trader_handover_status(
  p_org_id uuid,
  p_handover_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.product_trader_handovers handover
  SET status = 'completed',
      completed_at = COALESCE(handover.completed_at, now()),
      version = handover.version + 1,
      updated_at = now()
  WHERE handover.organization_id = p_org_id
    AND handover.id = p_handover_id
    AND handover.status IN ('accepted', 'partially_accepted')
    AND NOT EXISTS (
      SELECT 1 FROM public.product_trader_handover_lines line
      WHERE line.organization_id = p_org_id
        AND line.handover_id = handover.id
        AND line.line_status IN ('pending', 'accepted')
    );
END;
$$;

UPDATE public.product_trader_handovers handover
SET status = 'completed',
    completed_at = COALESCE(handover.completed_at, now()),
    version = handover.version + 1,
    updated_at = now()
WHERE handover.status IN ('accepted', 'partially_accepted')
  AND NOT EXISTS (
    SELECT 1 FROM public.product_trader_handover_lines line
    WHERE line.organization_id = handover.organization_id
      AND line.handover_id = handover.id
      AND line.line_status IN ('pending', 'accepted')
  );

-- ---------------------------------------------------------------------------
-- Durable idempotency for sales, collections, returns, and losses
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_trader_commands
  DROP CONSTRAINT IF EXISTS product_trader_commands_action_check;
ALTER TABLE public.product_trader_commands
  ADD CONSTRAINT product_trader_commands_action_check CHECK (action IN (
    'trader_handover_issue', 'trader_handover_accept',
    'trader_handover_reject', 'trader_handover_cancel',
    'sale_create', 'price_override_request', 'price_override_review',
    'collection_submit', 'collection_review',
    'return_request', 'return_review', 'loss_report', 'loss_recover'
  ));

CREATE OR REPLACE FUNCTION public.claim_product_trader_command(
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
  payload_hash_value text;
  command_row public.product_trader_commands%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR NULLIF(btrim(p_action), '') IS NULL
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Trader workflow command input is invalid.' USING ERRCODE = '22023';
  END IF;

  payload_hash_value := encode(digest(jsonb_build_object(
    'action', p_action, 'payload', p_payload
  )::text, 'sha256'), 'hex');
  INSERT INTO public.product_trader_commands (
    organization_id, idempotency_key, action, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_action, payload_hash_value,
    p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_trader_commands command
  WHERE command.organization_id = p_org_id
    AND command.idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> p_action
     OR command_row.payload_hash <> payload_hash_value
     OR command_row.actor_user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Trader workflow idempotency key was reused.' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object(
    'completed', command_row.status = 'completed',
    'result', command_row.result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_product_trader_command(
  p_org_id uuid,
  p_command_id uuid,
  p_entity_id uuid,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.product_trader_commands
  SET status = 'completed', entity_id = p_entity_id,
      result = p_result, completed_at = now()
  WHERE organization_id = p_org_id
    AND idempotency_key = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trader workflow command was not claimed.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- v156-v159 reused the entity id as business_events.business_key. Since that
-- table is unique per source/key, the second transition (accept/review/etc.)
-- failed. Normalize only product-trader events to their unique command id.
CREATE OR REPLACE FUNCTION public.normalize_product_trader_business_event_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source_type IN (
      'product_trader_handover', 'product_trader_sale',
      'product_trader_collection', 'product_trader_exception'
    )
    AND COALESCE(NEW.payload->>'command_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    NEW.business_key := NEW.payload->>'command_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_product_trader_business_event_key
  ON public.business_events;
CREATE TRIGGER trg_normalize_product_trader_business_event_key
  BEFORE INSERT ON public.business_events
  FOR EACH ROW EXECUTE FUNCTION public.normalize_product_trader_business_event_key();

UPDATE public.business_events event
SET business_key = event.payload->>'command_id',
    updated_at = now()
WHERE event.source_type IN (
    'product_trader_handover', 'product_trader_sale',
    'product_trader_collection', 'product_trader_exception'
  )
  AND COALESCE(event.payload->>'command_id', '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM public.business_events other
    WHERE other.id <> event.id
      AND other.org_id = event.org_id
      AND other.source_type = event.source_type
      AND other.business_key = event.payload->>'command_id'
  );

-- ---------------------------------------------------------------------------
-- Price approval, sales, currency, and commission settlement snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_trader_price_overrides
  ADD COLUMN IF NOT EXISTS trader_handover_id uuid
    REFERENCES public.product_trader_handovers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.product_trader_price_overrides override_request
SET trader_handover_id = unit.current_trader_handover_id,
    expires_at = COALESCE(override_request.expires_at, override_request.reviewed_at,
      override_request.requested_at) + interval '72 hours'
FROM public.product_inventory_units unit
WHERE unit.organization_id = override_request.organization_id
  AND unit.id = override_request.unit_id
  AND override_request.trader_handover_id IS NULL;

WITH duplicate_overrides AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, unit_id, merchant_id
    ORDER BY requested_at DESC, id DESC
  ) AS position
  FROM public.product_trader_price_overrides
  WHERE status IN ('pending', 'approved')
)
UPDATE public.product_trader_price_overrides target
SET status = 'cancelled', version = target.version + 1, updated_at = now()
FROM duplicate_overrides duplicate
WHERE target.id = duplicate.id AND duplicate.position > 1;

DROP INDEX IF EXISTS public.product_trader_price_override_open_idx;
CREATE UNIQUE INDEX product_trader_price_override_open_idx
  ON public.product_trader_price_overrides (organization_id, unit_id, merchant_id)
  WHERE status IN ('pending', 'approved');

ALTER TABLE public.product_trader_sales
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS net_commission_at_settlement boolean NOT NULL DEFAULT false;

UPDATE public.product_trader_sales sale
SET currency = line.currency,
    net_commission_at_settlement = (
      sale.merchant_commission_amount > 0
      AND abs(sale.organization_receivable_amount
        - (sale.total_amount - sale.merchant_commission_amount)) < 0.01
    )
FROM public.product_trader_sale_lines line
WHERE line.sale_id = sale.id;

ALTER TABLE public.product_trader_sales
  DROP CONSTRAINT IF EXISTS product_trader_sales_currency_check,
  DROP CONSTRAINT IF EXISTS product_trader_sales_accounting_status_check;
ALTER TABLE public.product_trader_sales
  ADD CONSTRAINT product_trader_sales_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT product_trader_sales_accounting_status_check CHECK (
    accounting_status IN ('pending', 'pending_approval', 'posted', 'failed', 'reversed')
  );

ALTER TABLE public.product_trader_collections
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';
ALTER TABLE public.product_trader_collections
  DROP CONSTRAINT IF EXISTS product_trader_collections_currency_check,
  DROP CONSTRAINT IF EXISTS product_trader_collections_accounting_status_check;
ALTER TABLE public.product_trader_collections
  ADD CONSTRAINT product_trader_collections_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT product_trader_collections_accounting_status_check CHECK (
    accounting_status IN ('pending', 'pending_approval', 'posted', 'failed', 'reversed')
  );

ALTER TABLE public.product_trader_commissions
  ADD COLUMN IF NOT EXISTS settlement_method text NOT NULL DEFAULT 'payable';
ALTER TABLE public.product_trader_commissions
  DROP CONSTRAINT IF EXISTS product_trader_commissions_settlement_method_check;
ALTER TABLE public.product_trader_commissions
  ADD CONSTRAINT product_trader_commissions_settlement_method_check
  CHECK (settlement_method IN ('payable', 'netted'));

UPDATE public.product_trader_commissions commission
SET settlement_method = 'netted',
    status = 'settled',
    settled_at = COALESCE(commission.settled_at, sale.created_at),
    settlement_reference = COALESCE(commission.settlement_reference, 'NETTED-IN-SALE')
FROM public.product_trader_sales sale
WHERE sale.id = commission.sale_id
  AND commission.beneficiary_type = 'merchant'
  AND sale.net_commission_at_settlement;

CREATE OR REPLACE FUNCTION public.accrue_product_trader_sale_commissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.merchant_commission_amount > 0 THEN
    INSERT INTO public.product_trader_commissions (
      organization_id, sale_id, beneficiary_type, merchant_id, amount,
      currency, status, settlement_method, settled_at, settlement_reference
    ) VALUES (
      NEW.organization_id, NEW.id, 'merchant', NEW.merchant_id,
      NEW.merchant_commission_amount, NEW.currency,
      CASE WHEN NEW.net_commission_at_settlement THEN 'settled' ELSE 'accrued' END,
      CASE WHEN NEW.net_commission_at_settlement THEN 'netted' ELSE 'payable' END,
      CASE WHEN NEW.net_commission_at_settlement THEN now() END,
      CASE WHEN NEW.net_commission_at_settlement THEN 'NETTED-IN-SALE' END
    ) ON CONFLICT (sale_id, beneficiary_type) DO NOTHING;
  END IF;
  IF NEW.agent_chain_commission_amount > 0 THEN
    INSERT INTO public.product_trader_commissions (
      organization_id, sale_id, beneficiary_type, agent_id, amount,
      currency, settlement_method
    ) VALUES (
      NEW.organization_id, NEW.id, 'field_agent', NEW.source_agent_id,
      NEW.agent_chain_commission_amount, NEW.currency, 'payable'
    ) ON CONFLICT (sale_id, beneficiary_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.product_trader_balances WITH (security_invoker=true) AS
WITH activity_keys AS (
  SELECT organization_id, merchant_id, currency FROM public.product_trader_sales
  UNION
  SELECT organization_id, merchant_id, currency FROM public.product_trader_collections
  UNION
  SELECT commission.organization_id, sale.merchant_id, commission.currency
  FROM public.product_trader_commissions commission
  JOIN public.product_trader_sales sale ON sale.id = commission.sale_id
), balance_keys AS (
  SELECT organization_id, merchant_id, currency FROM activity_keys
  UNION ALL
  SELECT merchant.organization_id, merchant.id, 'SAR'
  FROM public.merchants merchant
  WHERE NOT EXISTS (
    SELECT 1 FROM activity_keys activity
    WHERE activity.organization_id = merchant.organization_id
      AND activity.merchant_id = merchant.id
  )
), sale_totals AS (
  SELECT organization_id, merchant_id, currency,
    sum(total_amount) AS sales_total,
    sum(organization_receivable_amount) AS organization_receivable
  FROM public.product_trader_sales
  WHERE status = 'active'
  GROUP BY organization_id, merchant_id, currency
), collection_totals AS (
  SELECT organization_id, merchant_id, currency, sum(amount) AS confirmed_collections
  FROM public.product_trader_collections
  WHERE status = 'confirmed'
  GROUP BY organization_id, merchant_id, currency
), merchant_commissions AS (
  SELECT organization_id, merchant_id, currency, sum(amount) AS merchant_commission
  FROM public.product_trader_commissions
  WHERE beneficiary_type = 'merchant' AND status <> 'reversed'
  GROUP BY organization_id, merchant_id, currency
), agent_commissions AS (
  SELECT commission.organization_id, sale.merchant_id, commission.currency,
    sum(commission.amount) AS agent_commission
  FROM public.product_trader_commissions commission
  JOIN public.product_trader_sales sale ON sale.id = commission.sale_id
  WHERE commission.beneficiary_type = 'field_agent'
    AND commission.status <> 'reversed'
  GROUP BY commission.organization_id, sale.merchant_id, commission.currency
)
SELECT merchant.organization_id, merchant.id AS merchant_id,
  merchant.agent_id AS source_agent_id, merchant.business_name,
  COALESCE(sale.sales_total, 0)::numeric(14,2) AS sales_total,
  COALESCE(sale.organization_receivable, 0)::numeric(14,2) AS organization_receivable,
  COALESCE(collection.confirmed_collections, 0)::numeric(14,2) AS confirmed_collections,
  GREATEST(
    COALESCE(sale.organization_receivable, 0)
      - COALESCE(collection.confirmed_collections, 0), 0
  )::numeric(14,2) AS outstanding,
  COALESCE(merchant_commission.merchant_commission, 0)::numeric(14,2)
    AS merchant_commission,
  COALESCE(agent_commission.agent_commission, 0)::numeric(14,2)
    AS agent_commission,
  key.currency
FROM balance_keys key
JOIN public.merchants merchant
  ON merchant.organization_id = key.organization_id
 AND merchant.id = key.merchant_id
LEFT JOIN sale_totals sale
  ON sale.organization_id = key.organization_id
 AND sale.merchant_id = key.merchant_id AND sale.currency = key.currency
LEFT JOIN collection_totals collection
  ON collection.organization_id = key.organization_id
 AND collection.merchant_id = key.merchant_id AND collection.currency = key.currency
LEFT JOIN merchant_commissions merchant_commission
  ON merchant_commission.organization_id = key.organization_id
 AND merchant_commission.merchant_id = key.merchant_id
 AND merchant_commission.currency = key.currency
LEFT JOIN agent_commissions agent_commission
  ON agent_commission.organization_id = key.organization_id
 AND agent_commission.merchant_id = key.merchant_id
 AND agent_commission.currency = key.currency;

-- ---------------------------------------------------------------------------
-- Corrected custody command
-- ---------------------------------------------------------------------------
-- v156 used an unqualified `id` alias inside the acceptance NOT EXISTS check.
-- PostgreSQL resolved it to handover_lines.id instead of the unnested unit id,
-- causing valid trader acceptance requests to fail as "invalid unit".
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
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
  handover_row public.product_trader_handovers%ROWTYPE;
  merchant_row public.merchants%ROWTYPE;
  source_agent_row public.field_agents%ROWTYPE;
  command_claim jsonb;
  unit_ids uuid[] := ARRAY[]::uuid[];
  accepted_ids uuid[] := ARRAY[]::uuid[];
  rejected_missing_ids uuid[] := ARRAY[]::uuid[];
  rejected_damaged_ids uuid[] := ARRAY[]::uuid[];
  affected_count integer := 0;
  accepted_count integer := 0;
  rejected_count integer := 0;
  result_value jsonb;
  topic_value text;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN (
      'trader_handover_issue', 'trader_handover_accept',
      'trader_handover_reject', 'trader_handover_cancel'
    ) OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported trader custody action.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text, agent.id, merchant.id
  INTO actor_role_value, actor_agent_id, actor_merchant_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.field_agents agent
    ON agent.organization_id = member.org_id
   AND agent.user_id = member.user_id AND agent.status = 'active'
  LEFT JOIN public.merchants merchant
    ON merchant.organization_id = member.org_id
   AND merchant.user_id = member.user_id AND merchant.status = 'active'
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager', 'onground_agent_manager',
      'field_agent', 'merchant'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product trader distribution access is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO settings_row
  FROM public.product_inventory_commerce_settings settings
  WHERE settings.organization_id = p_org_id;
  IF settings_row.organization_id IS NULL
     OR NOT settings_row.product_trader_distribution_enabled THEN
    RAISE EXCEPTION 'Product trader distribution is disabled.' USING ERRCODE = '55000';
  END IF;
  command_claim := public.claim_product_trader_command(
    p_org_id, p_actor_user_id, p_request_id, p_command_id, p_action, p_payload
  );
  IF (command_claim->>'completed')::boolean THEN
    RETURN command_claim->'result';
  END IF;

  IF p_action = 'trader_handover_issue' THEN
    IF actor_role_value = 'field_agent' THEN
      IF actor_agent_id IS NULL THEN
        RAISE EXCEPTION 'An active field-agent identity is required.' USING ERRCODE = '42501';
      END IF;
    ELSIF actor_role_value NOT IN ('admin', 'onground_agent_manager')
       OR NOT settings_row.allow_onground_manager_on_behalf_transfer THEN
      RAISE EXCEPTION 'Only the owning field agent can issue this handover.' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(p_payload->>'handover_id', '') IS NULL THEN
      RAISE EXCEPTION 'Handover id is required.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO source_agent_row
    FROM public.field_agents agent
    WHERE agent.organization_id = p_org_id
      AND agent.id = COALESCE(
        NULLIF(p_payload->>'source_agent_id', '')::uuid, actor_agent_id
      ) AND agent.status = 'active'
    FOR UPDATE;
    IF source_agent_row.id IS NULL
       OR (actor_role_value = 'field_agent' AND source_agent_row.id <> actor_agent_id) THEN
      RAISE EXCEPTION 'Active source field agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO merchant_row
    FROM public.merchants merchant
    WHERE merchant.organization_id = p_org_id
      AND merchant.id = NULLIF(p_payload->>'merchant_id', '')::uuid
      AND merchant.status = 'active'
    FOR UPDATE;
    IF merchant_row.id IS NULL OR merchant_row.agent_id <> source_agent_row.id THEN
      RAISE EXCEPTION 'Trader must be active and owned by the source agent.' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(array_agg(item.value::uuid ORDER BY item.value), ARRAY[]::uuid[])
    INTO unit_ids
    FROM jsonb_array_elements_text(
      COALESCE(p_payload->'unit_ids', '[]'::jsonb)
    ) item(value);
    IF cardinality(unit_ids) < 1
       OR cardinality(unit_ids) > settings_row.max_trader_handover_units
       OR cardinality(ARRAY(SELECT DISTINCT selected.unit_id
          FROM unnest(unit_ids) selected(unit_id))) <> cardinality(unit_ids) THEN
      RAISE EXCEPTION 'Trader handover unit selection is invalid.' USING ERRCODE = '23514';
    END IF;
    PERFORM unit.id
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id AND unit.id = ANY(unit_ids)
    ORDER BY unit.id FOR UPDATE;
    SELECT count(*) INTO affected_count
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id AND unit.id = ANY(unit_ids)
      AND unit.status = 'with_agent'
      AND unit.current_agent_id = source_agent_row.id
      AND unit.current_merchant_id IS NULL
      AND unit.current_trader_handover_id IS NULL
      AND unit.current_custodian_employee_id IS NULL
      AND unit.merchant_sales_enabled_snapshot;
    IF affected_count <> cardinality(unit_ids) THEN
      RAISE EXCEPTION 'All units must be trader-enabled stock held by the source agent.'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.product_trader_handovers (
      id, organization_id, handover_no, source_agent_id, merchant_id,
      status, require_acknowledgment, expires_at, issued_by, notes
    ) VALUES (
      (p_payload->>'handover_id')::uuid, p_org_id,
      public.next_product_trader_handover_number(p_org_id, CURRENT_DATE),
      source_agent_row.id, merchant_row.id,
      CASE WHEN settings_row.require_trader_handover_acknowledgment
        THEN 'issued' ELSE 'accepted' END,
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
      ON product.organization_id = unit.organization_id
     AND product.id = unit.product_id
    WHERE unit.organization_id = p_org_id AND unit.id = ANY(unit_ids);
    UPDATE public.product_inventory_units
    SET status = CASE WHEN handover_row.status = 'accepted'
          THEN 'with_merchant' ELSE 'merchant_in_transit' END,
        current_merchant_id = merchant_row.id,
        current_trader_handover_id = handover_row.id,
        merchant_assigned_at = CASE WHEN handover_row.status = 'accepted'
          THEN now() END,
        custody_version = custody_version + 1,
        version = version + 1, updated_at = now()
    WHERE organization_id = p_org_id AND id = ANY(unit_ids);
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, from_agent_id, to_merchant_id,
      trader_handover_id, reason, performed_by, metadata
    )
    SELECT p_org_id, selected.unit_id, 'trader_handover_issued',
      source_agent_row.id, merchant_row.id, handover_row.id,
      NULLIF(btrim(p_payload->>'notes'), ''), p_actor_user_id,
      jsonb_build_object('command_id', p_command_id)
    FROM unnest(unit_ids) selected(unit_id);
    topic_value := 'product_inventory.trader_handover_issued';
    result_value := jsonb_build_object(
      'handover', to_jsonb(handover_row), 'unit_count', cardinality(unit_ids)
    );
  ELSE
    SELECT * INTO handover_row
    FROM public.product_trader_handovers handover
    WHERE handover.organization_id = p_org_id
      AND handover.id = NULLIF(p_payload->>'handover_id', '')::uuid
    FOR UPDATE;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Trader product handover was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF handover_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
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
      IF actor_role_value = 'field_agent'
         AND actor_agent_id <> handover_row.source_agent_id THEN
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
      SELECT COALESCE(array_agg(item.value::uuid ORDER BY item.value), ARRAY[]::uuid[])
      INTO accepted_ids
      FROM jsonb_array_elements_text(
        COALESCE(p_payload->'accepted_unit_ids', '[]'::jsonb)
      ) item(value);
      SELECT COALESCE(array_agg((item.value->>'unit_id')::uuid
        ORDER BY item.value->>'unit_id'), ARRAY[]::uuid[])
      INTO rejected_missing_ids
      FROM jsonb_array_elements(
        COALESCE(p_payload->'rejected_units', '[]'::jsonb)
      ) item(value)
      WHERE COALESCE(item.value->>'reason', 'missing') = 'missing';
      SELECT COALESCE(array_agg((item.value->>'unit_id')::uuid
        ORDER BY item.value->>'unit_id'), ARRAY[]::uuid[])
      INTO rejected_damaged_ids
      FROM jsonb_array_elements(
        COALESCE(p_payload->'rejected_units', '[]'::jsonb)
      ) item(value)
      WHERE item.value->>'reason' = 'damaged';
      accepted_count := cardinality(accepted_ids);
      rejected_count := cardinality(rejected_missing_ids)
        + cardinality(rejected_damaged_ids);
      SELECT count(*) INTO affected_count
      FROM public.product_trader_handover_lines line
      WHERE line.organization_id = p_org_id
        AND line.handover_id = handover_row.id AND line.line_status = 'pending';
      IF accepted_count + rejected_count <> affected_count
         OR cardinality(ARRAY(
           SELECT DISTINCT decision.unit_id
           FROM unnest(accepted_ids || rejected_missing_ids || rejected_damaged_ids)
             decision(unit_id)
         )) <> affected_count THEN
        RAISE EXCEPTION 'Every pending handover unit needs one acceptance decision.'
          USING ERRCODE = '23514';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM unnest(accepted_ids || rejected_missing_ids || rejected_damaged_ids)
          decision(unit_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.product_trader_handover_lines line
          WHERE line.organization_id = p_org_id
            AND line.handover_id = handover_row.id
            AND line.unit_id = decision.unit_id AND line.line_status = 'pending'
        )
      ) THEN
        RAISE EXCEPTION 'A handover decision references an invalid unit.' USING ERRCODE = '23514';
      END IF;
      IF settings_row.require_trader_signature
         AND length(COALESCE(p_payload->>'signature_data', '')) < 20 THEN
        RAISE EXCEPTION 'Trader signature is required.' USING ERRCODE = '23514';
      END IF;

      UPDATE public.product_trader_handover_lines
      SET line_status = 'accepted', accepted_condition = 'new',
          accepted_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND unit_id = ANY(accepted_ids) AND line_status = 'pending';
      UPDATE public.product_trader_handover_lines
      SET line_status = 'rejected_missing', closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND unit_id = ANY(rejected_missing_ids) AND line_status = 'pending';
      UPDATE public.product_trader_handover_lines
      SET line_status = 'rejected_damaged', accepted_condition = 'damaged',
          closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND unit_id = ANY(rejected_damaged_ids) AND line_status = 'pending';
      UPDATE public.product_inventory_units
      SET status = 'with_merchant', merchant_assigned_at = now(),
          custody_version = custody_version + 1,
          version = version + 1, updated_at = now()
      WHERE organization_id = p_org_id
        AND current_trader_handover_id = handover_row.id
        AND id = ANY(accepted_ids) AND status = 'merchant_in_transit';
      UPDATE public.product_inventory_units
      SET status = CASE WHEN id = ANY(rejected_damaged_ids)
            THEN 'quarantine' ELSE 'with_agent' END,
          current_merchant_id = NULL, current_trader_handover_id = NULL,
          merchant_assigned_at = NULL, custody_version = custody_version + 1,
          version = version + 1, updated_at = now()
      WHERE organization_id = p_org_id
        AND current_trader_handover_id = handover_row.id
        AND id = ANY(rejected_missing_ids || rejected_damaged_ids)
        AND status = 'merchant_in_transit';
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_agent_id, to_merchant_id,
        trader_handover_id, performed_by, metadata
      )
      SELECT p_org_id, selected.unit_id, 'trader_handover_accepted',
        handover_row.source_agent_id, handover_row.merchant_id, handover_row.id,
        p_actor_user_id, jsonb_build_object('command_id', p_command_id)
      FROM unnest(accepted_ids) selected(unit_id);
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_merchant_id, to_agent_id,
        trader_handover_id, reason, performed_by, metadata
      )
      SELECT p_org_id, selected.unit_id, 'trader_handover_rejected',
        handover_row.merchant_id, handover_row.source_agent_id, handover_row.id,
        'Trader rejected during acceptance', p_actor_user_id,
        jsonb_build_object('command_id', p_command_id)
      FROM unnest(rejected_missing_ids || rejected_damaged_ids) selected(unit_id);
      IF settings_row.require_trader_signature THEN
        INSERT INTO public.product_trader_handover_signatures (
          organization_id, handover_id, merchant_user_id, signature_data
        ) VALUES (
          p_org_id, handover_row.id, p_actor_user_id, p_payload->>'signature_data'
        );
      END IF;
      UPDATE public.product_trader_handovers
      SET status = CASE
            WHEN accepted_count > 0 AND rejected_count > 0 THEN 'partially_accepted'
            WHEN accepted_count > 0 THEN 'accepted' ELSE 'rejected' END,
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
      result_value := jsonb_build_object('handover', to_jsonb(handover_row),
        'accepted', accepted_count, 'rejected', rejected_count);
    ELSE
      UPDATE public.product_trader_handover_lines
      SET line_status = CASE WHEN p_action = 'trader_handover_reject'
            THEN 'rejected_missing' ELSE 'cancelled' END,
          closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = handover_row.id
        AND line_status = 'pending';
      UPDATE public.product_inventory_units
      SET status = 'with_agent', current_merchant_id = NULL,
          current_trader_handover_id = NULL, merchant_assigned_at = NULL,
          custody_version = custody_version + 1,
          version = version + 1, updated_at = now()
      WHERE organization_id = p_org_id
        AND current_trader_handover_id = handover_row.id
        AND status = 'merchant_in_transit';
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_merchant_id, to_agent_id,
        trader_handover_id, reason, performed_by, metadata
      )
      SELECT p_org_id, line.unit_id,
        CASE WHEN p_action = 'trader_handover_reject'
          THEN 'trader_handover_rejected' ELSE 'trader_handover_cancelled' END,
        handover_row.merchant_id, handover_row.source_agent_id, handover_row.id,
        COALESCE(NULLIF(btrim(p_payload->>'rejection_reason'), ''),
          NULLIF(btrim(p_payload->>'reason'), '')),
        p_actor_user_id, jsonb_build_object('command_id', p_command_id)
      FROM public.product_trader_handover_lines line
      WHERE line.organization_id = p_org_id AND line.handover_id = handover_row.id;
      UPDATE public.product_trader_handovers
      SET status = CASE WHEN p_action = 'trader_handover_reject'
            THEN 'rejected' ELSE 'cancelled' END,
          rejected_by = CASE WHEN p_action = 'trader_handover_reject'
            THEN p_actor_user_id END,
          rejected_at = CASE WHEN p_action = 'trader_handover_reject'
            THEN now() END,
          rejection_reason = NULLIF(btrim(COALESCE(
            p_payload->>'rejection_reason', p_payload->>'reason'
          )), ''), version = version + 1, updated_at = now()
      WHERE id = handover_row.id RETURNING * INTO handover_row;
      topic_value := CASE WHEN p_action = 'trader_handover_reject'
        THEN 'product_inventory.trader_handover_rejected'
        ELSE 'product_inventory.trader_handover_cancelled' END;
      result_value := jsonb_build_object('handover', to_jsonb(handover_row));
    END IF;
  END IF;

  event_payload := jsonb_build_object(
    'event_type', topic_value, 'handover_id', handover_row.id,
    'handover_no', handover_row.handover_no,
    'agent_id', handover_row.source_agent_id,
    'merchant_id', handover_row.merchant_id, 'status', handover_row.status,
    'version', handover_row.version, 'command_id', p_command_id
  );
  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'product_trader_handover', p_command_id::text,
    handover_row.version, event_payload, event_hash_value, 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, topic_value, event_payload, event_hash_value
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, topic_value,
    'product_trader_handover', handover_row.id::text,
    'success', 200, result_value
  );
  PERFORM public.complete_product_trader_command(
    p_org_id, p_command_id, handover_row.id, result_value
  );
  RETURN result_value;
END;
$$;

-- ---------------------------------------------------------------------------
-- Corrected sale and price-approval command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_product_trader_sale_command(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_action text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  actor_merchant_id uuid;
  unit_row public.product_inventory_units%ROWTYPE;
  line_row public.product_trader_handover_lines%ROWTYPE;
  sale_row public.product_trader_sales%ROWTYPE;
  override_row public.product_trader_price_overrides%ROWTYPE;
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
  command_claim jsonb;
  price_value numeric(14,2);
  net_value numeric(14,2);
  vat_value numeric(14,2);
  total_value numeric(14,2);
  merchant_commission_value numeric(14,2);
  agent_commission_value numeric(14,2);
  merchant_base_value numeric(14,2);
  agent_base_value numeric(14,2);
  sale_id_value uuid;
  entity_id_value uuid;
  result_value jsonb;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('sale_create', 'price_override_request', 'price_override_review')
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported trader sale action.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text, merchant.id
  INTO actor_role_value, actor_merchant_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.merchants merchant
    ON merchant.organization_id = member.org_id
   AND merchant.user_id = member.user_id AND merchant.status = 'active'
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Trader sale access is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO settings_row
  FROM public.product_inventory_commerce_settings
  WHERE organization_id = p_org_id;
  IF settings_row.organization_id IS NULL
     OR NOT settings_row.product_trader_distribution_enabled THEN
    RAISE EXCEPTION 'Product trader distribution is disabled.' USING ERRCODE = '55000';
  END IF;

  command_claim := public.claim_product_trader_command(
    p_org_id, p_actor_user_id, p_request_id, p_command_id, p_action, p_payload
  );
  IF (command_claim->>'completed')::boolean THEN
    RETURN command_claim->'result';
  END IF;

  IF p_action = 'price_override_review' THEN
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Finance approval is required.' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'decision' NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Price decision is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO override_row
    FROM public.product_trader_price_overrides request
    WHERE request.organization_id = p_org_id
      AND request.id = NULLIF(p_payload->>'override_id', '')::uuid
    FOR UPDATE;
    IF override_row.id IS NULL THEN
      RAISE EXCEPTION 'Price request was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF override_row.status <> 'pending'
       OR override_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Price request changed.' USING ERRCODE = '40001';
    END IF;
    IF p_payload->>'decision' = 'approved' THEN
      SELECT * INTO unit_row FROM public.product_inventory_units unit
      WHERE unit.organization_id = p_org_id AND unit.id = override_row.unit_id
      FOR UPDATE;
      IF unit_row.status <> 'with_merchant'
         OR unit_row.current_merchant_id <> override_row.merchant_id
         OR unit_row.current_trader_handover_id IS DISTINCT FROM override_row.trader_handover_id THEN
        RAISE EXCEPTION 'Price request no longer matches active trader custody.' USING ERRCODE = '55000';
      END IF;
    END IF;
    UPDATE public.product_trader_price_overrides
    SET status = p_payload->>'decision',
        approved_price = CASE WHEN p_payload->>'decision' = 'approved'
          THEN requested_price END,
        reviewed_by = p_actor_user_id, reviewed_at = now(),
        review_note = NULLIF(btrim(p_payload->>'review_note'), ''),
        expires_at = CASE WHEN p_payload->>'decision' = 'approved'
          THEN now() + interval '72 hours' ELSE expires_at END,
        version = version + 1, updated_at = now()
    WHERE id = override_row.id
    RETURNING * INTO override_row;
    entity_id_value := override_row.id;
    result_value := jsonb_build_object('override', to_jsonb(override_row));
    event_payload := jsonb_build_object(
      'event_type', 'product_inventory.trader_price_override_reviewed',
      'override_id', override_row.id, 'merchant_id', override_row.merchant_id,
      'status', override_row.status, 'version', override_row.version,
      'command_id', p_command_id
    );
  ELSE
    IF actor_role_value <> 'merchant' OR actor_merchant_id IS NULL THEN
      RAISE EXCEPTION 'Only an active trader can sell or request a price.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
    FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status <> 'with_merchant'
       OR unit_row.current_merchant_id <> actor_merchant_id
       OR unit_row.current_trader_handover_id IS NULL
       OR NOT unit_row.merchant_sales_enabled_snapshot THEN
      RAISE EXCEPTION 'The serialized unit is not sellable in this trader custody.' USING ERRCODE = '55000';
    END IF;
    SELECT * INTO line_row
    FROM public.product_trader_handover_lines line
    WHERE line.organization_id = p_org_id
      AND line.handover_id = unit_row.current_trader_handover_id
      AND line.unit_id = unit_row.id AND line.line_status = 'accepted'
    FOR UPDATE;
    IF line_row.id IS NULL THEN
      RAISE EXCEPTION 'Accepted trader handover line was not found.' USING ERRCODE = '55000';
    END IF;
    price_value := NULLIF(p_payload->>'sale_price', '')::numeric;
    IF price_value IS NULL OR price_value <= 0 THEN
      RAISE EXCEPTION 'Sale price is invalid.' USING ERRCODE = '23514';
    END IF;

    IF p_action = 'price_override_request' THEN
      IF price_value BETWEEN unit_row.minimum_sale_price_snapshot
        AND unit_row.maximum_sale_price_snapshot THEN
        RAISE EXCEPTION 'Price is already within the approved range.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.product_trader_price_overrides (
        id, organization_id, unit_id, merchant_id, source_agent_id,
        trader_handover_id, requested_price, currency, reason,
        requested_by, expires_at
      ) VALUES (
        NULLIF(p_payload->>'override_id', '')::uuid, p_org_id, unit_row.id,
        actor_merchant_id, unit_row.current_agent_id,
        unit_row.current_trader_handover_id, price_value, unit_row.currency,
        btrim(p_payload->>'reason'), p_actor_user_id, now() + interval '72 hours'
      ) RETURNING * INTO override_row;
      entity_id_value := override_row.id;
      result_value := jsonb_build_object('override', to_jsonb(override_row));
      event_payload := jsonb_build_object(
        'event_type', 'product_inventory.trader_price_override_requested',
        'override_id', override_row.id, 'merchant_id', override_row.merchant_id,
        'unit_id', unit_row.id, 'version', override_row.version,
        'command_id', p_command_id
      );
    ELSE
      IF p_payload->>'payment_method' NOT IN (
        'cash', 'bank_transfer', 'card', 'electronic', 'credit'
      ) THEN
        RAISE EXCEPTION 'Sale payment method is invalid.' USING ERRCODE = '23514';
      END IF;
      IF price_value < unit_row.minimum_sale_price_snapshot
         OR price_value > unit_row.maximum_sale_price_snapshot THEN
        SELECT * INTO override_row
        FROM public.product_trader_price_overrides request
        WHERE request.organization_id = p_org_id
          AND request.id = NULLIF(p_payload->>'price_override_id', '')::uuid
          AND request.unit_id = unit_row.id
          AND request.merchant_id = actor_merchant_id
          AND request.trader_handover_id = unit_row.current_trader_handover_id
          AND request.status = 'approved'
          AND request.approved_price = price_value
          AND request.expires_at > now()
        FOR UPDATE;
        IF override_row.id IS NULL THEN
          RAISE EXCEPTION 'The sale price needs a current Finance approval.' USING ERRCODE = '23514';
        END IF;
      END IF;

      IF unit_row.trader_tax_included_snapshot
         AND unit_row.trader_tax_rate_snapshot > 0 THEN
        net_value := round(price_value / (1 + unit_row.trader_tax_rate_snapshot / 100), 2);
        vat_value := price_value - net_value;
        total_value := price_value;
      ELSE
        net_value := price_value;
        vat_value := round(price_value * unit_row.trader_tax_rate_snapshot / 100, 2);
        total_value := price_value + vat_value;
      END IF;
      merchant_base_value := CASE
        WHEN unit_row.trader_commission_rule_snapshot->>'base' = 'gross_amount'
          THEN total_value ELSE net_value END;
      agent_base_value := CASE
        WHEN unit_row.agent_chain_commission_rule_snapshot->>'base' = 'gross_amount'
          THEN total_value ELSE net_value END;
      merchant_commission_value := CASE unit_row.trader_commission_rule_snapshot->>'type'
        WHEN 'flat' THEN (unit_row.trader_commission_rule_snapshot->>'value')::numeric
        WHEN 'percentage' THEN round(merchant_base_value
          * (unit_row.trader_commission_rule_snapshot->>'value')::numeric / 100, 2)
        ELSE 0 END;
      agent_commission_value := CASE unit_row.agent_chain_commission_rule_snapshot->>'type'
        WHEN 'flat' THEN (unit_row.agent_chain_commission_rule_snapshot->>'value')::numeric
        WHEN 'percentage' THEN round(agent_base_value
          * (unit_row.agent_chain_commission_rule_snapshot->>'value')::numeric / 100, 2)
        ELSE 0 END;
      IF merchant_commission_value < 0 OR merchant_commission_value > total_value
         OR agent_commission_value < 0 OR agent_commission_value > total_value THEN
        RAISE EXCEPTION 'Commission snapshot is outside the sale amount.' USING ERRCODE = '23514';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(
        p_org_id::text || ':' || actor_merchant_id::text || ':' || unit_row.currency, 0
      ));
      sale_id_value := NULLIF(p_payload->>'sale_id', '')::uuid;
      INSERT INTO public.product_trader_sales (
        id, organization_id, sale_no, merchant_id, source_agent_id,
        sale_date, customer_name, customer_phone, customer_reference,
        payment_method, subtotal, vat_amount, total_amount,
        merchant_commission_amount, agent_chain_commission_amount,
        organization_receivable_amount, currency,
        net_commission_at_settlement, created_by
      ) VALUES (
        sale_id_value, p_org_id,
        public.next_product_trader_sale_number(
          p_org_id, COALESCE(NULLIF(p_payload->>'sale_date', '')::date, CURRENT_DATE)
        ), actor_merchant_id, unit_row.current_agent_id,
        COALESCE(NULLIF(p_payload->>'sale_date', '')::date, CURRENT_DATE),
        NULLIF(btrim(p_payload->>'customer_name'), ''),
        NULLIF(btrim(p_payload->>'customer_phone'), ''),
        NULLIF(btrim(p_payload->>'customer_reference'), ''),
        p_payload->>'payment_method', net_value, vat_value, total_value,
        merchant_commission_value, agent_commission_value,
        CASE WHEN settings_row.net_product_commission_at_settlement
          THEN GREATEST(total_value - merchant_commission_value, 0)
          ELSE total_value END,
        unit_row.currency, settings_row.net_product_commission_at_settlement,
        p_actor_user_id
      ) RETURNING * INTO sale_row;
      INSERT INTO public.product_trader_sale_lines (
        organization_id, sale_id, unit_id, trader_handover_id, product_id,
        serial_snapshot, product_name_snapshot, unit_cost_snapshot,
        planned_sale_price_snapshot, minimum_sale_price_snapshot,
        maximum_sale_price_snapshot, actual_sale_price, net_amount, vat_rate,
        vat_amount, total_amount, merchant_commission_rule_snapshot,
        merchant_commission_amount, agent_chain_commission_rule_snapshot,
        agent_chain_commission_amount, price_override_id, currency
      ) VALUES (
        p_org_id, sale_row.id, unit_row.id, unit_row.current_trader_handover_id,
        unit_row.product_id, unit_row.raw_serial_number, line_row.product_name_snapshot,
        unit_row.unit_cost_snapshot, unit_row.planned_sale_price_snapshot,
        unit_row.minimum_sale_price_snapshot, unit_row.maximum_sale_price_snapshot,
        price_value, net_value, unit_row.trader_tax_rate_snapshot, vat_value,
        total_value, unit_row.trader_commission_rule_snapshot,
        merchant_commission_value, unit_row.agent_chain_commission_rule_snapshot,
        agent_commission_value, override_row.id, unit_row.currency
      );
      UPDATE public.product_trader_handover_lines
      SET line_status = 'sold', closed_at = now(), updated_at = now()
      WHERE id = line_row.id AND line_status = 'accepted';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trader custody changed during sale.' USING ERRCODE = '40001';
      END IF;
      UPDATE public.product_inventory_units
      SET status = 'sold', sold_at = now(),
          sold_by_merchant_id = actor_merchant_id,
          current_trader_sale_id = sale_row.id,
          current_merchant_id = NULL, current_agent_id = NULL,
          current_trader_handover_id = NULL, merchant_assigned_at = NULL,
          custody_version = custody_version + 1,
          version = version + 1, updated_at = now()
      WHERE id = unit_row.id;
      IF override_row.id IS NOT NULL THEN
        UPDATE public.product_trader_price_overrides
        SET status = 'used', used_sale_id = sale_row.id,
            version = version + 1, updated_at = now()
        WHERE id = override_row.id;
      END IF;
      PERFORM public.refresh_product_trader_handover_status(
        p_org_id, line_row.handover_id
      );
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_merchant_id,
        trader_handover_id, trader_sale_id, reason, performed_by, metadata
      ) VALUES (
        p_org_id, unit_row.id, 'trader_sale', actor_merchant_id,
        line_row.handover_id, sale_row.id, 'Serialized product sold by trader',
        p_actor_user_id, jsonb_build_object('sale_no', sale_row.sale_no,
          'command_id', p_command_id)
      );
      entity_id_value := sale_row.id;
      result_value := jsonb_build_object('sale', to_jsonb(sale_row));
      event_payload := jsonb_build_object(
        'event_type', 'product_inventory.trader_sale_created',
        'sale_id', sale_row.id, 'sale_no', sale_row.sale_no,
        'merchant_id', sale_row.merchant_id,
        'agent_id', sale_row.source_agent_id,
        'total_amount', sale_row.total_amount,
        'currency', sale_row.currency, 'version', sale_row.version,
        'command_id', p_command_id
      );
    END IF;
  END IF;

  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'product_trader_sale', p_command_id::text,
    COALESCE((event_payload->>'version')::integer, 1), event_payload,
    event_hash_value, 'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, event_payload->>'event_type',
    event_payload, event_hash_value
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    event_payload->>'event_type', 'product_trader_sale',
    entity_id_value::text, 'success', 200, result_value
  );
  PERFORM public.complete_product_trader_command(
    p_org_id, p_command_id, entity_id_value, result_value
  );
  RETURN result_value;
END;
$$;

-- ---------------------------------------------------------------------------
-- Corrected collection command with reserved pending balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_product_trader_settlement_command(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_action text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  actor_merchant_id uuid;
  actor_agent_id uuid;
  merchant_row public.merchants%ROWTYPE;
  collection_row public.product_trader_collections%ROWTYPE;
  command_claim jsonb;
  currency_value text;
  amount_value numeric(14,2);
  outstanding_value numeric(14,2);
  reserved_value numeric(14,2);
  result_value jsonb;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('collection_submit', 'collection_review')
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported settlement action.' USING ERRCODE = '22023';
  END IF;
  SELECT member.role::text, merchant.id, agent.id
  INTO actor_role_value, actor_merchant_id, actor_agent_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.merchants merchant
    ON merchant.organization_id = member.org_id
   AND merchant.user_id = member.user_id AND merchant.status = 'active'
  LEFT JOIN public.field_agents agent
    ON agent.organization_id = member.org_id
   AND agent.user_id = member.user_id AND agent.status = 'active'
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Settlement access is required.' USING ERRCODE = '42501';
  END IF;
  command_claim := public.claim_product_trader_command(
    p_org_id, p_actor_user_id, p_request_id, p_command_id, p_action, p_payload
  );
  IF (command_claim->>'completed')::boolean THEN
    RETURN command_claim->'result';
  END IF;

  IF p_action = 'collection_submit' THEN
    IF actor_role_value NOT IN ('merchant', 'field_agent') THEN
      RAISE EXCEPTION 'Only the trader or owning field agent can submit a collection.'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO merchant_row
    FROM public.merchants merchant
    WHERE merchant.organization_id = p_org_id
      AND merchant.id = COALESCE(
        NULLIF(p_payload->>'merchant_id', '')::uuid, actor_merchant_id
      ) AND merchant.status = 'active'
    FOR SHARE;
    IF merchant_row.id IS NULL
       OR (actor_role_value = 'merchant' AND merchant_row.id <> actor_merchant_id)
       OR (actor_role_value = 'field_agent' AND merchant_row.agent_id <> actor_agent_id) THEN
      RAISE EXCEPTION 'Trader is outside your scope.' USING ERRCODE = '42501';
    END IF;
    amount_value := NULLIF(p_payload->>'amount', '')::numeric;
    currency_value := upper(COALESCE(NULLIF(btrim(p_payload->>'currency'), ''), 'SAR'));
    IF amount_value IS NULL OR amount_value <= 0
       OR currency_value !~ '^[A-Z]{3}$'
       OR p_payload->>'payment_method' NOT IN (
         'cash', 'bank_transfer', 'card', 'electronic'
       ) THEN
      RAISE EXCEPTION 'Collection amount, currency, or payment method is invalid.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_org_id::text || ':' || merchant_row.id::text || ':' || currency_value, 0
    ));
    SELECT outstanding INTO outstanding_value
    FROM public.product_trader_balances
    WHERE organization_id = p_org_id AND merchant_id = merchant_row.id
      AND currency = currency_value;
    SELECT COALESCE(sum(amount), 0) INTO reserved_value
    FROM public.product_trader_collections
    WHERE organization_id = p_org_id AND merchant_id = merchant_row.id
      AND currency = currency_value AND status = 'submitted';
    IF amount_value > GREATEST(
      COALESCE(outstanding_value, 0) - COALESCE(reserved_value, 0), 0
    ) + 0.01 THEN
      RAISE EXCEPTION 'Collection exceeds the unreserved trader outstanding balance.'
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.product_trader_collections (
      id, organization_id, collection_no, merchant_id, source_agent_id,
      amount, currency, payment_method, collection_date, payment_reference,
      proof_path, submitted_by
    ) VALUES (
      NULLIF(p_payload->>'collection_id', '')::uuid, p_org_id,
      'TPC-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-'
        || lpad(nextval('public.product_trader_collection_number_seq')::text, 7, '0'),
      merchant_row.id, merchant_row.agent_id, amount_value, currency_value,
      p_payload->>'payment_method',
      COALESCE(NULLIF(p_payload->>'collection_date', '')::date, CURRENT_DATE),
      NULLIF(btrim(p_payload->>'payment_reference'), ''),
      NULLIF(btrim(p_payload->>'proof_path'), ''), p_actor_user_id
    ) RETURNING * INTO collection_row;
    event_payload := jsonb_build_object(
      'event_type', 'product_inventory.trader_collection_submitted',
      'collection_id', collection_row.id,
      'collection_no', collection_row.collection_no,
      'merchant_id', collection_row.merchant_id,
      'agent_id', collection_row.source_agent_id,
      'amount', collection_row.amount, 'currency', collection_row.currency,
      'version', collection_row.version, 'command_id', p_command_id
    );
  ELSE
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Finance confirmation is required.' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'decision' NOT IN ('confirmed', 'rejected') THEN
      RAISE EXCEPTION 'Collection decision is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO collection_row
    FROM public.product_trader_collections collection
    WHERE collection.organization_id = p_org_id
      AND collection.id = NULLIF(p_payload->>'collection_id', '')::uuid
    FOR UPDATE;
    IF collection_row.id IS NULL THEN
      RAISE EXCEPTION 'Collection was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF collection_row.status <> 'submitted'
       OR collection_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Collection changed.' USING ERRCODE = '40001';
    END IF;
    IF p_payload->>'decision' = 'confirmed' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(
        p_org_id::text || ':' || collection_row.merchant_id::text
          || ':' || collection_row.currency, 0
      ));
      SELECT outstanding INTO outstanding_value
      FROM public.product_trader_balances
      WHERE organization_id = p_org_id
        AND merchant_id = collection_row.merchant_id
        AND currency = collection_row.currency;
      IF collection_row.amount > COALESCE(outstanding_value, 0) + 0.01 THEN
        RAISE EXCEPTION 'Collection exceeds the current trader outstanding balance.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    UPDATE public.product_trader_collections
    SET status = p_payload->>'decision',
        confirmed_by = CASE WHEN p_payload->>'decision' = 'confirmed'
          THEN p_actor_user_id END,
        confirmed_at = CASE WHEN p_payload->>'decision' = 'confirmed'
          THEN now() END,
        rejection_reason = CASE WHEN p_payload->>'decision' = 'rejected'
          THEN NULLIF(btrim(p_payload->>'reason'), '') END,
        version = version + 1, updated_at = now()
    WHERE id = collection_row.id
    RETURNING * INTO collection_row;
    event_payload := jsonb_build_object(
      'event_type', CASE WHEN collection_row.status = 'confirmed'
        THEN 'product_inventory.trader_collection_confirmed'
        ELSE 'product_inventory.trader_collection_rejected' END,
      'collection_id', collection_row.id,
      'collection_no', collection_row.collection_no,
      'merchant_id', collection_row.merchant_id,
      'agent_id', collection_row.source_agent_id,
      'amount', collection_row.amount, 'currency', collection_row.currency,
      'version', collection_row.version, 'command_id', p_command_id
    );
  END IF;

  result_value := jsonb_build_object('collection', to_jsonb(collection_row));
  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'product_trader_collection', p_command_id::text,
    collection_row.version, event_payload, event_hash_value, 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, event_payload->>'event_type',
    event_payload, event_hash_value
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    event_payload->>'event_type', 'product_trader_collection',
    collection_row.id::text, 'success', 200, result_value
  );
  PERFORM public.complete_product_trader_command(
    p_org_id, p_command_id, collection_row.id, result_value
  );
  RETURN result_value;
END;
$$;

-- ---------------------------------------------------------------------------
-- Corrected returns, losses, and recovery command
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_inventory_movements
  DROP CONSTRAINT IF EXISTS product_inventory_movements_movement_type_check;
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_movement_type_check CHECK (movement_type IN (
    'receipt', 'reserve', 'handover_issued', 'handover_accepted',
    'employee_handover_issued', 'employee_handover_accepted',
    'trader_handover_issued', 'trader_handover_accepted',
    'trader_handover_rejected', 'trader_handover_cancelled',
    'trader_return', 'trader_return_requested', 'trader_return_received',
    'trader_return_rejected', 'trader_loss_reported',
    'agent_return', 'sale', 'trader_sale', 'sale_void', 'customer_return',
    'return_reserved', 'return_rejected', 'return_approved', 'return_received',
    'quarantine', 'damage', 'loss', 'loss_recovered', 'adjustment', 'transfer'
  ));

CREATE OR REPLACE FUNCTION public.execute_product_trader_exception_command(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_action text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  actor_merchant_id uuid;
  actor_agent_id uuid;
  unit_row public.product_inventory_units%ROWTYPE;
  line_row public.product_trader_handover_lines%ROWTYPE;
  return_row public.product_trader_returns%ROWTYPE;
  loss_row public.product_trader_losses%ROWTYPE;
  command_claim jsonb;
  entity_id_value uuid;
  result_value jsonb;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('return_request', 'return_review', 'loss_report', 'loss_recover')
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported trader exception action.' USING ERRCODE = '22023';
  END IF;
  SELECT member.role::text, merchant.id, agent.id
  INTO actor_role_value, actor_merchant_id, actor_agent_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.merchants merchant
    ON merchant.organization_id = member.org_id
   AND merchant.user_id = member.user_id AND merchant.status = 'active'
  LEFT JOIN public.field_agents agent
    ON agent.organization_id = member.org_id
   AND agent.user_id = member.user_id AND agent.status = 'active'
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Trader exception access is required.' USING ERRCODE = '42501';
  END IF;
  command_claim := public.claim_product_trader_command(
    p_org_id, p_actor_user_id, p_request_id, p_command_id, p_action, p_payload
  );
  IF (command_claim->>'completed')::boolean THEN
    RETURN command_claim->'result';
  END IF;

  IF p_action IN ('return_request', 'loss_report') THEN
    IF actor_role_value NOT IN ('merchant', 'field_agent') THEN
      RAISE EXCEPTION 'Only the trader or owning field agent can report this exception.'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
    FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status <> 'with_merchant'
       OR unit_row.current_merchant_id IS NULL
       OR unit_row.current_agent_id IS NULL
       OR unit_row.current_trader_handover_id IS NULL THEN
      RAISE EXCEPTION 'Unit must be in active trader custody.' USING ERRCODE = '55000';
    END IF;
    IF actor_role_value = 'merchant'
       AND unit_row.current_merchant_id <> actor_merchant_id THEN
      RAISE EXCEPTION 'Unit is outside trader custody.' USING ERRCODE = '42501';
    END IF;
    IF actor_role_value = 'field_agent'
       AND unit_row.current_agent_id <> actor_agent_id THEN
      RAISE EXCEPTION 'Unit is outside agent scope.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO line_row
    FROM public.product_trader_handover_lines line
    WHERE line.organization_id = p_org_id
      AND line.handover_id = unit_row.current_trader_handover_id
      AND line.unit_id = unit_row.id AND line.line_status = 'accepted'
    FOR UPDATE;
    IF line_row.id IS NULL THEN
      RAISE EXCEPTION 'Active trader handover line was not found.' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF p_action = 'return_request' THEN
    INSERT INTO public.product_trader_returns (
      id, organization_id, unit_id, merchant_id, source_agent_id,
      trader_handover_id, reason, condition, evidence_path, requested_by
    ) VALUES (
      NULLIF(p_payload->>'return_id', '')::uuid, p_org_id, unit_row.id,
      unit_row.current_merchant_id, unit_row.current_agent_id,
      unit_row.current_trader_handover_id, btrim(p_payload->>'reason'),
      p_payload->>'condition', btrim(p_payload->>'evidence_path'), p_actor_user_id
    ) RETURNING * INTO return_row;
    UPDATE public.product_inventory_units
    SET status = 'return_pending', version = version + 1, updated_at = now()
    WHERE id = unit_row.id;
    UPDATE public.product_trader_price_overrides
    SET status = 'cancelled', version = version + 1, updated_at = now()
    WHERE organization_id = p_org_id AND unit_id = unit_row.id
      AND status IN ('pending', 'approved');
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, from_merchant_id, to_agent_id,
      trader_handover_id, reason, performed_by, metadata
    ) VALUES (
      p_org_id, unit_row.id, 'trader_return_requested',
      unit_row.current_merchant_id, unit_row.current_agent_id,
      unit_row.current_trader_handover_id, return_row.reason, p_actor_user_id,
      jsonb_build_object('return_id', return_row.id, 'command_id', p_command_id)
    );
    entity_id_value := return_row.id;
    result_value := jsonb_build_object('return', to_jsonb(return_row));
    event_payload := jsonb_build_object(
      'event_type', 'product_inventory.trader_return_requested',
      'return_id', return_row.id, 'unit_id', return_row.unit_id,
      'merchant_id', return_row.merchant_id,
      'agent_id', return_row.source_agent_id,
      'version', return_row.version, 'command_id', p_command_id
    );
  ELSIF p_action = 'return_review' THEN
    IF actor_role_value NOT IN (
      'field_agent', 'admin', 'finance_manager', 'onground_agent_manager'
    ) THEN
      RAISE EXCEPTION 'Return review is not allowed.' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'decision' NOT IN ('received', 'rejected') THEN
      RAISE EXCEPTION 'Return decision is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO return_row
    FROM public.product_trader_returns request
    WHERE request.organization_id = p_org_id
      AND request.id = NULLIF(p_payload->>'return_id', '')::uuid
    FOR UPDATE;
    IF return_row.id IS NULL THEN
      RAISE EXCEPTION 'Return was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF return_row.status <> 'requested'
       OR return_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Return changed.' USING ERRCODE = '40001';
    END IF;
    IF actor_role_value = 'field_agent'
       AND return_row.source_agent_id <> actor_agent_id THEN
      RAISE EXCEPTION 'Return is outside agent scope.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id AND unit.id = return_row.unit_id
    FOR UPDATE;
    IF unit_row.status <> 'return_pending'
       OR unit_row.current_merchant_id <> return_row.merchant_id
       OR unit_row.current_agent_id <> return_row.source_agent_id
       OR unit_row.current_trader_handover_id IS DISTINCT FROM return_row.trader_handover_id THEN
      RAISE EXCEPTION 'Return no longer matches unit custody.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_trader_returns
    SET status = p_payload->>'decision', reviewed_by = p_actor_user_id,
        reviewed_at = now(),
        review_note = NULLIF(btrim(p_payload->>'review_note'), ''),
        version = version + 1, updated_at = now()
    WHERE id = return_row.id
    RETURNING * INTO return_row;
    IF return_row.status = 'received' THEN
      UPDATE public.product_trader_handover_lines
      SET line_status = 'returned', closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id
        AND handover_id = return_row.trader_handover_id
        AND unit_id = return_row.unit_id AND line_status = 'accepted';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trader return custody line changed.' USING ERRCODE = '40001';
      END IF;
      UPDATE public.product_inventory_units
      SET status = CASE WHEN return_row.condition = 'damaged'
            THEN 'quarantine' ELSE 'with_agent' END,
          current_merchant_id = NULL, current_trader_handover_id = NULL,
          merchant_assigned_at = NULL, custody_version = custody_version + 1,
          version = version + 1, updated_at = now()
      WHERE id = return_row.unit_id;
      PERFORM public.refresh_product_trader_handover_status(
        p_org_id, return_row.trader_handover_id
      );
    ELSE
      UPDATE public.product_inventory_units
      SET status = 'with_merchant', version = version + 1, updated_at = now()
      WHERE id = return_row.unit_id;
    END IF;
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, from_merchant_id, to_agent_id,
      trader_handover_id, reason, performed_by, metadata
    ) VALUES (
      p_org_id, return_row.unit_id,
      CASE WHEN return_row.status = 'received'
        THEN 'trader_return_received' ELSE 'trader_return_rejected' END,
      return_row.merchant_id, return_row.source_agent_id,
      return_row.trader_handover_id, return_row.review_note, p_actor_user_id,
      jsonb_build_object('return_id', return_row.id, 'command_id', p_command_id)
    );
    entity_id_value := return_row.id;
    result_value := jsonb_build_object('return', to_jsonb(return_row));
    event_payload := jsonb_build_object(
      'event_type', CASE WHEN return_row.status = 'received'
        THEN 'product_inventory.trader_return_received'
        ELSE 'product_inventory.trader_return_rejected' END,
      'return_id', return_row.id, 'unit_id', return_row.unit_id,
      'merchant_id', return_row.merchant_id,
      'agent_id', return_row.source_agent_id,
      'version', return_row.version, 'command_id', p_command_id
    );
  ELSIF p_action = 'loss_report' THEN
    INSERT INTO public.product_trader_losses (
      id, organization_id, unit_id, merchant_id, source_agent_id,
      trader_handover_id, loss_type, reason, evidence_path,
      unit_cost_snapshot, reported_by
    ) VALUES (
      NULLIF(p_payload->>'loss_id', '')::uuid, p_org_id, unit_row.id,
      unit_row.current_merchant_id, unit_row.current_agent_id,
      unit_row.current_trader_handover_id, p_payload->>'loss_type',
      btrim(p_payload->>'reason'), btrim(p_payload->>'evidence_path'),
      unit_row.unit_cost_snapshot, p_actor_user_id
    ) RETURNING * INTO loss_row;
    UPDATE public.product_trader_handover_lines
    SET line_status = CASE WHEN loss_row.loss_type = 'damaged'
          THEN 'damaged' ELSE 'lost' END,
        closed_at = now(), updated_at = now()
    WHERE id = line_row.id AND line_status = 'accepted';
    UPDATE public.product_inventory_units
    SET status = CASE WHEN loss_row.loss_type = 'damaged'
          THEN 'damaged' ELSE 'lost' END,
        current_merchant_id = NULL, current_trader_handover_id = NULL,
        merchant_assigned_at = NULL, custody_version = custody_version + 1,
        version = version + 1, updated_at = now()
    WHERE id = unit_row.id;
    UPDATE public.product_trader_price_overrides
    SET status = 'cancelled', version = version + 1, updated_at = now()
    WHERE organization_id = p_org_id AND unit_id = unit_row.id
      AND status IN ('pending', 'approved');
    PERFORM public.refresh_product_trader_handover_status(p_org_id, line_row.handover_id);
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, from_merchant_id,
      trader_handover_id, reason, performed_by, metadata
    ) VALUES (
      p_org_id, unit_row.id, 'trader_loss_reported', loss_row.merchant_id,
      loss_row.trader_handover_id, loss_row.reason, p_actor_user_id,
      jsonb_build_object('loss_id', loss_row.id, 'loss_type', loss_row.loss_type,
        'command_id', p_command_id)
    );
    entity_id_value := loss_row.id;
    result_value := jsonb_build_object('loss', to_jsonb(loss_row));
    event_payload := jsonb_build_object(
      'event_type', 'product_inventory.trader_loss_reported',
      'loss_id', loss_row.id, 'unit_id', loss_row.unit_id,
      'merchant_id', loss_row.merchant_id,
      'agent_id', loss_row.source_agent_id, 'loss_type', loss_row.loss_type,
      'version', loss_row.version, 'command_id', p_command_id
    );
  ELSE
    IF actor_role_value NOT IN (
      'field_agent', 'admin', 'finance_manager', 'onground_agent_manager'
    ) THEN
      RAISE EXCEPTION 'Recovery is not allowed.' USING ERRCODE = '42501';
    END IF;
    IF p_payload->>'condition' NOT IN ('sellable', 'damaged') THEN
      RAISE EXCEPTION 'Recovery condition is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO loss_row
    FROM public.product_trader_losses loss
    WHERE loss.organization_id = p_org_id
      AND loss.id = NULLIF(p_payload->>'loss_id', '')::uuid
    FOR UPDATE;
    IF loss_row.id IS NULL
       OR loss_row.status NOT IN ('reported', 'under_review', 'recognized') THEN
      RAISE EXCEPTION 'Open loss was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF loss_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Loss changed.' USING ERRCODE = '40001';
    END IF;
    IF actor_role_value = 'field_agent'
       AND loss_row.source_agent_id <> actor_agent_id THEN
      RAISE EXCEPTION 'Loss is outside agent scope.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id AND unit.id = loss_row.unit_id
    FOR UPDATE;
    IF unit_row.status NOT IN ('lost', 'damaged') THEN
      RAISE EXCEPTION 'Loss no longer matches unit status.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_trader_losses
    SET status = 'recovered', recovered_by = p_actor_user_id,
        recovered_at = now(), recovery_condition = p_payload->>'condition',
        recovery_note = NULLIF(btrim(p_payload->>'note'), ''),
        version = version + 1, updated_at = now()
    WHERE id = loss_row.id
    RETURNING * INTO loss_row;
    UPDATE public.product_inventory_units
    SET status = CASE WHEN loss_row.recovery_condition = 'damaged'
          THEN 'quarantine' ELSE 'with_agent' END,
        current_agent_id = loss_row.source_agent_id,
        current_merchant_id = NULL, current_trader_handover_id = NULL,
        merchant_assigned_at = NULL, custody_version = custody_version + 1,
        version = version + 1, updated_at = now()
    WHERE id = loss_row.unit_id;
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, to_agent_id,
      trader_handover_id, reason, performed_by, metadata
    ) VALUES (
      p_org_id, loss_row.unit_id, 'loss_recovered', loss_row.source_agent_id,
      loss_row.trader_handover_id, loss_row.recovery_note, p_actor_user_id,
      jsonb_build_object('loss_id', loss_row.id, 'command_id', p_command_id)
    );
    entity_id_value := loss_row.id;
    result_value := jsonb_build_object('loss', to_jsonb(loss_row));
    event_payload := jsonb_build_object(
      'event_type', 'product_inventory.trader_loss_recovered',
      'loss_id', loss_row.id, 'unit_id', loss_row.unit_id,
      'agent_id', loss_row.source_agent_id, 'version', loss_row.version,
      'command_id', p_command_id
    );
  END IF;

  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'product_trader_exception', p_command_id::text,
    COALESCE((event_payload->>'version')::integer, 1), event_payload,
    event_hash_value, 'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, event_payload->>'event_type',
    event_payload, event_hash_value
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    event_payload->>'event_type', 'product_trader_exception',
    entity_id_value::text, 'success', 200, result_value
  );
  PERFORM public.complete_product_trader_command(
    p_org_id, p_command_id, entity_id_value, result_value
  );
  RETURN result_value;
END;
$$;

-- The v156 expiry function advertised an expired status but persisted
-- cancelled. Keep expiry semantically distinct and release every pending unit.
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
    SELECT id, organization_id
    FROM public.product_trader_handovers
    WHERE status = 'issued' AND expires_at <= now()
    ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT p_batch_size
  LOOP
    UPDATE public.product_trader_handover_lines
    SET line_status = 'cancelled', closed_at = now(), updated_at = now()
    WHERE handover_id = handover_record.id AND line_status = 'pending';
    UPDATE public.product_inventory_units
    SET status = 'with_agent', current_merchant_id = NULL,
        current_trader_handover_id = NULL, merchant_assigned_at = NULL,
        custody_version = custody_version + 1,
        version = version + 1, updated_at = now()
    WHERE organization_id = handover_record.organization_id
      AND current_trader_handover_id = handover_record.id
      AND status = 'merchant_in_transit';
    UPDATE public.product_trader_price_overrides
    SET status = 'cancelled', version = version + 1, updated_at = now()
    WHERE organization_id = handover_record.organization_id
      AND trader_handover_id = handover_record.id
      AND status IN ('pending', 'approved');
    UPDATE public.product_trader_handovers
    SET status = 'expired', rejection_reason = 'Expired before trader acceptance',
        version = version + 1, updated_at = now()
    WHERE id = handover_record.id;
    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_product_trader_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_product_trader_command(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_product_trader_handover_status(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_product_trader_sale_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_product_trader_settlement_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_product_trader_exception_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_product_trader_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_product_trader_command(
  uuid, uuid, uuid, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_product_trader_handover_status(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_sale_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_settlement_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_product_trader_exception_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.claim_product_trader_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS 'Claims or replays every product-trader workflow command using one tenant-scoped idempotency key.';
