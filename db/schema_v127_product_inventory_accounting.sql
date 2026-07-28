-- Phase 5: product inventory accounting, reconciliation, loss recognition,
-- retry evidence, and finance-owned posting configuration.

ALTER TABLE public.accounting_settings
  ADD COLUMN IF NOT EXISTS default_inventory_asset_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_inventory_grni_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_inventory_cogs_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_inventory_shrinkage_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_agent_receivable_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_post_inventory_receipts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_post_product_sales boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_post_product_collections boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_product_agent_commissions boolean NOT NULL DEFAULT false;

INSERT INTO public.accounting_accounts (
  organization_id, code, name_ar, name_en, type, subtype,
  normal_balance, is_system, is_active, description
)
SELECT
  organization.id,
  seed.code,
  seed.name_ar,
  seed.name_en,
  seed.type,
  seed.subtype,
  seed.normal_balance,
  true,
  true,
  seed.description
FROM public.organizations organization
CROSS JOIN (
  VALUES
    ('1120', 'ذمم مندوبي المنتجات', 'Product Agent Receivables', 'asset', 'current_asset', 'debit', 'Amounts collected by field agents for serialized product sales.'),
    ('1400', 'مخزون المنتجات', 'Product Inventory', 'asset', 'current_asset', 'debit', 'Company-owned serialized product inventory at snapshot cost.'),
    ('2050', 'بضاعة مستلمة غير مفوترة', 'Goods Received Not Invoiced', 'liability', 'current_liability', 'credit', 'Accrual for purchased inventory received before the supplier invoice.'),
    ('5050', 'تكلفة مبيعات المنتجات', 'Product Cost of Goods Sold', 'expense', 'cost_of_sales', 'debit', 'Snapshot cost released when a serialized product is sold.'),
    ('5910', 'فاقد وتلف مخزون المنتجات', 'Product Inventory Shrinkage', 'expense', 'operating_expense', 'debit', 'Recognized cost of lost or damaged company-owned inventory.')
) AS seed(code, name_ar, name_en, type, subtype, normal_balance, description)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO public.accounting_settings (organization_id)
SELECT organization.id
FROM public.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

UPDATE public.accounting_settings settings
SET
  default_agent_receivable_id = COALESCE(
    settings.default_agent_receivable_id,
    (SELECT id FROM public.accounting_accounts WHERE organization_id = settings.organization_id AND code = '1120')
  ),
  default_inventory_asset_id = COALESCE(
    settings.default_inventory_asset_id,
    (SELECT id FROM public.accounting_accounts WHERE organization_id = settings.organization_id AND code = '1400')
  ),
  default_inventory_grni_id = COALESCE(
    settings.default_inventory_grni_id,
    (SELECT id FROM public.accounting_accounts WHERE organization_id = settings.organization_id AND code = '2050')
  ),
  default_inventory_cogs_id = COALESCE(
    settings.default_inventory_cogs_id,
    (SELECT id FROM public.accounting_accounts WHERE organization_id = settings.organization_id AND code = '5050')
  ),
  default_inventory_shrinkage_id = COALESCE(
    settings.default_inventory_shrinkage_id,
    (SELECT id FROM public.accounting_accounts WHERE organization_id = settings.organization_id AND code = '5910')
  ),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.initialize_product_inventory_accounting_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.accounting_accounts (
    organization_id, code, name_ar, name_en, type, subtype,
    normal_balance, is_system, is_active, description
  )
  VALUES
    (NEW.id, '1120', 'ذمم مندوبي المنتجات', 'Product Agent Receivables', 'asset', 'current_asset', 'debit', true, true, 'Amounts collected by field agents for serialized product sales.'),
    (NEW.id, '1400', 'مخزون المنتجات', 'Product Inventory', 'asset', 'current_asset', 'debit', true, true, 'Company-owned serialized product inventory at snapshot cost.'),
    (NEW.id, '2050', 'بضاعة مستلمة غير مفوترة', 'Goods Received Not Invoiced', 'liability', 'current_liability', 'credit', true, true, 'Accrual for purchased inventory received before the supplier invoice.'),
    (NEW.id, '5050', 'تكلفة مبيعات المنتجات', 'Product Cost of Goods Sold', 'expense', 'cost_of_sales', 'debit', true, true, 'Snapshot cost released when a serialized product is sold.'),
    (NEW.id, '5910', 'فاقد وتلف مخزون المنتجات', 'Product Inventory Shrinkage', 'expense', 'operating_expense', 'debit', true, true, 'Recognized cost of lost or damaged company-owned inventory.')
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO public.accounting_settings (
    organization_id, default_agent_receivable_id, default_inventory_asset_id,
    default_inventory_grni_id, default_inventory_cogs_id,
    default_inventory_shrinkage_id
  )
  VALUES (
    NEW.id,
    (SELECT id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '1120'),
    (SELECT id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '1400'),
    (SELECT id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '2050'),
    (SELECT id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '5050'),
    (SELECT id FROM public.accounting_accounts WHERE organization_id = NEW.id AND code = '5910')
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    default_agent_receivable_id = COALESCE(public.accounting_settings.default_agent_receivable_id, EXCLUDED.default_agent_receivable_id),
    default_inventory_asset_id = COALESCE(public.accounting_settings.default_inventory_asset_id, EXCLUDED.default_inventory_asset_id),
    default_inventory_grni_id = COALESCE(public.accounting_settings.default_inventory_grni_id, EXCLUDED.default_inventory_grni_id),
    default_inventory_cogs_id = COALESCE(public.accounting_settings.default_inventory_cogs_id, EXCLUDED.default_inventory_cogs_id),
    default_inventory_shrinkage_id = COALESCE(public.accounting_settings.default_inventory_shrinkage_id, EXCLUDED.default_inventory_shrinkage_id),
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_product_inventory_accounting_defaults_trigger
  ON public.organizations;
CREATE TRIGGER initialize_product_inventory_accounting_defaults_trigger
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.initialize_product_inventory_accounting_defaults();

ALTER TABLE public.product_receipts
  ADD COLUMN IF NOT EXISTS accounting_posting_error text,
  ADD COLUMN IF NOT EXISTS accounting_attempt_count integer NOT NULL DEFAULT 0
    CHECK (accounting_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS accounting_last_attempt_at timestamptz;
ALTER TABLE public.product_receipts
  DROP CONSTRAINT IF EXISTS product_receipts_accounting_status_check;
ALTER TABLE public.product_receipts
  ADD CONSTRAINT product_receipts_accounting_status_check CHECK (
    accounting_status IN (
      'pending', 'pending_approval', 'not_required', 'posted', 'failed', 'reversed'
    )
  );

ALTER TABLE public.agent_product_sales
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_reversal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_posting_error text,
  ADD COLUMN IF NOT EXISTS accounting_attempt_count integer NOT NULL DEFAULT 0
    CHECK (accounting_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS accounting_last_attempt_at timestamptz;
ALTER TABLE public.agent_product_sales
  DROP CONSTRAINT IF EXISTS agent_product_sales_accounting_status_check;
ALTER TABLE public.agent_product_sales
  ADD CONSTRAINT agent_product_sales_accounting_status_check CHECK (
    accounting_status IN (
      'pending', 'pending_approval', 'not_required', 'posted', 'failed', 'reversed'
    )
  );

ALTER TABLE public.agent_product_sale_lines
  ADD COLUMN IF NOT EXISTS inventory_account_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cogs_account_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid
    REFERENCES public.accounting_accounts(id) ON DELETE SET NULL;

UPDATE public.agent_product_sale_lines line
SET
  inventory_account_id = COALESCE(
    line.inventory_account_id,
    product.inventory_account_id,
    settings.default_inventory_asset_id
  ),
  cogs_account_id = COALESCE(
    line.cogs_account_id,
    product.cogs_account_id,
    settings.default_inventory_cogs_id
  ),
  revenue_account_id = COALESCE(
    line.revenue_account_id,
    product.revenue_account_id,
    settings.default_sales_revenue_id
  )
FROM public.sales_products product, public.accounting_settings settings
WHERE product.organization_id = line.organization_id
  AND product.id = line.product_id
  AND settings.organization_id = line.organization_id;

CREATE OR REPLACE FUNCTION public.snapshot_product_sale_account_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT
    COALESCE(NEW.inventory_account_id, product.inventory_account_id, settings.default_inventory_asset_id),
    COALESCE(NEW.cogs_account_id, product.cogs_account_id, settings.default_inventory_cogs_id),
    COALESCE(NEW.revenue_account_id, product.revenue_account_id, settings.default_sales_revenue_id)
  INTO NEW.inventory_account_id, NEW.cogs_account_id, NEW.revenue_account_id
  FROM public.sales_products product
  JOIN public.accounting_settings settings
    ON settings.organization_id = product.organization_id
  WHERE product.organization_id = NEW.organization_id
    AND product.id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_product_sale_account_mapping_trigger
  ON public.agent_product_sale_lines;
CREATE TRIGGER snapshot_product_sale_account_mapping_trigger
  BEFORE INSERT ON public.agent_product_sale_lines
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_product_sale_account_mapping();

ALTER TABLE public.agent_product_collections
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_reversal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_posting_error text,
  ADD COLUMN IF NOT EXISTS accounting_attempt_count integer NOT NULL DEFAULT 0
    CHECK (accounting_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS accounting_last_attempt_at timestamptz;
ALTER TABLE public.agent_product_collections
  DROP CONSTRAINT IF EXISTS agent_product_collections_accounting_status_check;
ALTER TABLE public.agent_product_collections
  ADD CONSTRAINT agent_product_collections_accounting_status_check CHECK (
    accounting_status IN (
      'pending', 'pending_approval', 'not_required', 'posted', 'failed', 'reversed'
    )
  );

CREATE TABLE IF NOT EXISTS public.product_inventory_loss_records (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  loss_type text NOT NULL CHECK (loss_type IN ('damage', 'loss')),
  serial_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  unit_cost_snapshot numeric(14,2) NOT NULL CHECK (unit_cost_snapshot > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  ownership_type text NOT NULL CHECK (ownership_type IN ('purchased', 'consignment')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reversed')),
  accounting_status text NOT NULL DEFAULT 'pending' CHECK (
    accounting_status IN (
      'pending', 'pending_approval', 'not_required', 'posted', 'failed', 'reversed'
    )
  ),
  accounting_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  accounting_reversal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  accounting_posting_error text,
  accounting_attempt_count integer NOT NULL DEFAULT 0
    CHECK (accounting_attempt_count >= 0),
  accounting_last_attempt_at timestamptz,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.product_inventory_accounting_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('receipt', 'sale', 'collection', 'loss')
  ),
  source_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'pending', 'pending_approval', 'not_required', 'posted', 'failed', 'reversed'
    )
  ),
  journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  reversal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  amounts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(amounts) = 'object'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  last_attempt_at timestamptz,
  posted_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS public.product_agent_commission_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  commission_count integer NOT NULL CHECK (commission_count > 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method text NOT NULL CHECK (
    payment_method IN ('cash', 'bank_transfer')
  ),
  payment_reference text,
  finance_notes text,
  accounting_payment_id uuid NOT NULL
    REFERENCES public.accounting_payments(id) ON DELETE RESTRICT,
  accounting_journal_entry_id uuid NOT NULL
    REFERENCES public.accounting_journal_entries(id) ON DELETE RESTRICT,
  posted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_agent_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.agent_product_sales(id) ON DELETE RESTRICT,
  sale_line_id uuid NOT NULL REFERENCES public.agent_product_sale_lines(id) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE RESTRICT,
  commission_amount numeric(14,2) NOT NULL CHECK (commission_amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accrued', 'settled', 'reversed')
  ),
  accrual_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  settlement_id uuid
    REFERENCES public.product_agent_commission_settlements(id) ON DELETE RESTRICT,
  settlement_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  settled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sale_line_id)
);

CREATE INDEX IF NOT EXISTS product_inventory_accounting_status_idx
  ON public.product_inventory_accounting_postings (
    organization_id, status, last_attempt_at DESC
  );
CREATE INDEX IF NOT EXISTS product_inventory_losses_status_idx
  ON public.product_inventory_loss_records (
    organization_id, status, accounting_status, recorded_at DESC
  );
CREATE INDEX IF NOT EXISTS product_agent_commissions_finance_idx
  ON public.product_agent_commissions (
    organization_id, status, agent_id, created_at DESC
  );

ALTER TABLE public.product_inventory_loss_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_accounting_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_agent_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_agent_commission_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_inventory_loss_records_select
  ON public.product_inventory_loss_records
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.can_view_product_inventory()
    )
  );
CREATE POLICY product_inventory_accounting_postings_select
  ON public.product_inventory_accounting_postings
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.can_view_accounting()
    )
  );
CREATE POLICY product_agent_commissions_select
  ON public.product_agent_commissions
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.can_view_accounting()
    )
  );
CREATE POLICY product_agent_commission_settlements_select
  ON public.product_agent_commission_settlements
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.can_view_accounting()
    )
  );

ALTER TABLE public.product_inventory_commands
  DROP CONSTRAINT IF EXISTS product_inventory_commands_action_check;
ALTER TABLE public.product_inventory_commands
  ADD CONSTRAINT product_inventory_commands_action_check CHECK (
    action IN (
      'receipt_draft_save', 'receipt_confirm', 'receipt_cancel',
      'handover_issue', 'handover_accept', 'agent_return',
      'price_override_request', 'price_override_review',
      'sale', 'sale_void', 'collection_post', 'inventory_loss',
      'commission_settle'
    )
  );

CREATE OR REPLACE FUNCTION public.execute_product_inventory_loss_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_commands%ROWTYPE;
  unit_row public.product_inventory_units%ROWTYPE;
  loss_row public.product_inventory_loss_records%ROWTYPE;
  actor_role_value text;
  loss_id_value uuid := NULLIF(p_payload->>'loss_id', '')::uuid;
  loss_type_value text := lower(btrim(COALESCE(p_payload->>'loss_type', '')));
  reason_value text := btrim(COALESCE(p_payload->>'reason', ''));
  hash_value text;
  payload_value jsonb := jsonb_build_object('action', 'inventory_loss', 'payload', COALESCE(p_payload, '{}'::jsonb));
  result_value jsonb;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR loss_id_value IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, command, and loss ids are required.'
      USING ERRCODE = '22023';
  END IF;
  IF loss_type_value NOT IN ('damage', 'loss') OR length(reason_value) < 5 THEN
    RAISE EXCEPTION 'Loss type and a detailed reason are required.'
      USING ERRCODE = '23514';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id
    AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'sales_manager', 'onground_agent_manager')
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Inventory manager access is required.' USING ERRCODE = '42501';
  END IF;

  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'inventory_loss', loss_id_value, hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'inventory_loss'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different inventory command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT unit.* INTO unit_row
  FROM public.product_inventory_units unit
  WHERE unit.organization_id = p_org_id
    AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
  FOR UPDATE;
  IF unit_row.id IS NULL THEN
    RAISE EXCEPTION 'Inventory unit was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF unit_row.status NOT IN (
    'in_stock', 'returned', 'damaged', 'with_agent', 'in_transit'
  ) OR unit_row.current_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unsold physical inventory unit can be written off.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.product_commerce_command', 'trusted', true);

  INSERT INTO public.product_inventory_loss_records (
    id, organization_id, unit_id, loss_type, serial_snapshot,
    product_name_snapshot, unit_cost_snapshot, currency, ownership_type,
    reason, accounting_status, recorded_by
  )
  SELECT
    loss_id_value, p_org_id, unit_row.id, loss_type_value,
    unit_row.raw_serial_number, product.name, unit_row.unit_cost_snapshot,
    unit_row.currency, unit_row.ownership_type, reason_value,
    CASE WHEN unit_row.ownership_type = 'consignment'
      THEN 'not_required' ELSE 'pending' END,
    p_actor_user_id
  FROM public.sales_products product
  WHERE product.organization_id = p_org_id AND product.id = unit_row.product_id
  RETURNING * INTO loss_row;

  INSERT INTO public.product_inventory_movements (
    organization_id, unit_id, movement_type, from_warehouse_id,
    from_agent_id, handover_id, reason, performed_by, metadata
  )
  VALUES (
    p_org_id, unit_row.id, loss_type_value, unit_row.warehouse_id,
    unit_row.current_agent_id, unit_row.current_handover_id, reason_value,
    p_actor_user_id,
    jsonb_build_object(
      'loss_id', loss_row.id,
      'unit_cost_snapshot', unit_row.unit_cost_snapshot,
      'ownership_type', unit_row.ownership_type,
      'command_id', p_command_id
    )
  );

  UPDATE public.product_handover_lines
  SET line_status = 'cancelled', closed_at = now(), updated_at = now()
  WHERE organization_id = p_org_id
    AND handover_id = unit_row.current_handover_id
    AND unit_id = unit_row.id
    AND line_status IN ('pending', 'accepted');

  UPDATE public.product_inventory_units
  SET status = CASE WHEN loss_type_value = 'damage' THEN 'damaged' ELSE 'lost' END,
      warehouse_id = NULL,
      current_agent_id = NULL,
      current_handover_id = NULL,
      assigned_at = NULL,
      version = version + 1,
      updated_at = now()
  WHERE organization_id = p_org_id AND id = unit_row.id;

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.' || loss_type_value || '_recorded',
    'loss_id', loss_row.id,
    'unit_id', loss_row.unit_id,
    'loss_type', loss_row.loss_type,
    'serial_number', loss_row.serial_snapshot,
    'product_name', loss_row.product_name_snapshot,
    'unit_cost', loss_row.unit_cost_snapshot,
    'ownership_type', loss_row.ownership_type,
    'reason', loss_row.reason,
    'accounting_status', loss_row.accounting_status,
    'version', loss_row.version
  );
  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_loss', loss_row.id::text, loss_row.version,
    event_payload, event_hash_value, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value,
    'product_inventory.' || loss_type_value || '_recorded',
    event_payload, event_hash_value
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'product_inventory.' || loss_type_value || '_recorded',
    'product_inventory_loss_records', loss_row.id::text,
    'success', 200,
    jsonb_build_object(
      'unit_id', unit_row.id,
      'unit_cost', unit_row.unit_cost_snapshot,
      'ownership_type', unit_row.ownership_type
    )
  );

  result_value := jsonb_build_object('loss', to_jsonb(loss_row));
  UPDATE public.product_inventory_commands
  SET entity_id = loss_row.id, status = 'completed',
      result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_product_inventory_accounting(
  p_org_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_status text,
  p_journal_entry_id uuid DEFAULT NULL,
  p_reversal_entry_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_amounts jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  posting_row public.product_inventory_accounting_postings%ROWTYPE;
  affected_count integer := 0;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_source_type NOT IN ('receipt', 'sale', 'collection', 'loss')
     OR p_status NOT IN (
       'pending', 'pending_approval', 'not_required', 'posted', 'failed', 'reversed'
     )
     OR jsonb_typeof(COALESCE(p_amounts, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product inventory accounting state.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.product_commerce_command', 'trusted', true);
  IF p_source_type = 'receipt' THEN
    UPDATE public.product_receipts
    SET accounting_status = p_status,
        accounting_journal_entry_id = COALESCE(p_journal_entry_id, accounting_journal_entry_id),
        accounting_reversal_entry_id = COALESCE(p_reversal_entry_id, accounting_reversal_entry_id),
        accounting_posting_error = NULLIF(p_error, ''),
        accounting_attempt_count = accounting_attempt_count + 1,
        accounting_last_attempt_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id AND id = p_source_id;
  ELSIF p_source_type = 'sale' THEN
    UPDATE public.agent_product_sales
    SET accounting_status = p_status,
        accounting_journal_entry_id = COALESCE(p_journal_entry_id, accounting_journal_entry_id),
        accounting_reversal_entry_id = COALESCE(p_reversal_entry_id, accounting_reversal_entry_id),
        accounting_posting_error = NULLIF(p_error, ''),
        accounting_attempt_count = accounting_attempt_count + 1,
        accounting_last_attempt_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id AND id = p_source_id;
  ELSIF p_source_type = 'collection' THEN
    UPDATE public.agent_product_collections
    SET accounting_status = p_status,
        accounting_journal_entry_id = COALESCE(p_journal_entry_id, accounting_journal_entry_id),
        accounting_reversal_entry_id = COALESCE(p_reversal_entry_id, accounting_reversal_entry_id),
        accounting_posting_error = NULLIF(p_error, ''),
        accounting_attempt_count = accounting_attempt_count + 1,
        accounting_last_attempt_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id AND id = p_source_id;
  ELSE
    UPDATE public.product_inventory_loss_records
    SET accounting_status = p_status,
        accounting_journal_entry_id = COALESCE(p_journal_entry_id, accounting_journal_entry_id),
        accounting_reversal_entry_id = COALESCE(p_reversal_entry_id, accounting_reversal_entry_id),
        accounting_posting_error = NULLIF(p_error, ''),
        accounting_attempt_count = accounting_attempt_count + 1,
        accounting_last_attempt_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id AND id = p_source_id;
  END IF;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count = 0 THEN
    RAISE EXCEPTION 'Product inventory accounting source was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.product_inventory_accounting_postings (
    organization_id, source_type, source_id, status, journal_entry_id,
    reversal_entry_id, amounts, attempt_count, last_error, last_attempt_at,
    posted_at, reversed_at
  )
  VALUES (
    p_org_id, p_source_type, p_source_id, p_status, p_journal_entry_id,
    p_reversal_entry_id, COALESCE(p_amounts, '{}'::jsonb), 1,
    NULLIF(p_error, ''), now(),
    CASE WHEN p_status = 'posted' THEN now() END,
    CASE WHEN p_status = 'reversed' THEN now() END
  )
  ON CONFLICT (organization_id, source_type, source_id) DO UPDATE SET
    status = EXCLUDED.status,
    journal_entry_id = COALESCE(EXCLUDED.journal_entry_id, public.product_inventory_accounting_postings.journal_entry_id),
    reversal_entry_id = COALESCE(EXCLUDED.reversal_entry_id, public.product_inventory_accounting_postings.reversal_entry_id),
    amounts = CASE WHEN EXCLUDED.amounts = '{}'::jsonb
      THEN public.product_inventory_accounting_postings.amounts ELSE EXCLUDED.amounts END,
    attempt_count = public.product_inventory_accounting_postings.attempt_count + 1,
    last_error = EXCLUDED.last_error,
    last_attempt_at = now(),
    posted_at = COALESCE(public.product_inventory_accounting_postings.posted_at, EXCLUDED.posted_at),
    reversed_at = COALESCE(public.product_inventory_accounting_postings.reversed_at, EXCLUDED.reversed_at),
    updated_at = now()
  RETURNING * INTO posting_row;

  IF p_status = 'failed' THEN
    event_payload := jsonb_build_object(
      'event_type', 'product_inventory.accounting_failed',
      'source_type', p_source_type,
      'source_id', p_source_id,
      'error', COALESCE(NULLIF(p_error, ''), 'Accounting posting failed.'),
      'attempt_count', posting_row.attempt_count,
      'version', posting_row.attempt_count
    );
    event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
    INSERT INTO public.business_events (
      org_id, source_type, business_key, event_version, payload, payload_hash,
      status, request_id, occurred_at, processed_at
    )
    VALUES (
      p_org_id, 'product_inventory_accounting',
      p_source_type || ':' || p_source_id::text || ':failure',
      posting_row.attempt_count, event_payload, event_hash_value,
      'completed', gen_random_uuid(), now(), now()
    )
    RETURNING id INTO event_id_value;
    INSERT INTO public.event_outbox (
      org_id, business_event_id, topic, payload, payload_hash
    )
    VALUES (
      p_org_id, event_id_value, 'product_inventory.accounting_failed',
      event_payload, event_hash_value
    );
  END IF;
  RETURN to_jsonb(posting_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_product_agent_commission_accrual(
  p_org_id uuid,
  p_sale_id uuid,
  p_journal_entry_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  journal_status_value text;
  affected_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT journal.status INTO journal_status_value
  FROM public.accounting_journal_entries journal
  WHERE journal.organization_id = p_org_id
    AND journal.id = p_journal_entry_id
    AND journal.source_module = 'product_inventory_sale'
    AND journal.source_id = p_sale_id;
  IF journal_status_value IS NULL THEN
    RAISE EXCEPTION 'Product sale accrual journal was not found.'
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounting_settings settings
    WHERE settings.organization_id = p_org_id
      AND settings.enable_product_agent_commissions
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.product_agent_commissions (
    organization_id, sale_id, sale_line_id, agent_id,
    commission_amount, currency, status, accrual_journal_entry_id
  )
  SELECT
    p_org_id, sale.id, line.id, sale.agent_id,
    line.agent_commission_amount, line.currency,
    CASE WHEN journal_status_value = 'posted' THEN 'accrued' ELSE 'pending' END,
    p_journal_entry_id
  FROM public.agent_product_sales sale
  JOIN public.agent_product_sale_lines line
    ON line.organization_id = sale.organization_id
   AND line.sale_id = sale.id
  WHERE sale.organization_id = p_org_id
    AND sale.id = p_sale_id
    AND sale.status = 'active'
    AND line.agent_commission_amount > 0
  ON CONFLICT (organization_id, sale_line_id) DO UPDATE SET
    accrual_journal_entry_id = EXCLUDED.accrual_journal_entry_id,
    status = CASE
      WHEN public.product_agent_commissions.status = 'pending'
       AND journal_status_value = 'posted' THEN 'accrued'
      ELSE public.product_agent_commissions.status
    END,
    updated_at = now();
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_product_agent_commissions(
  p_org_id uuid,
  p_sale_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.product_agent_commissions
  SET status = 'reversed', updated_at = now()
  WHERE organization_id = p_org_id
    AND sale_id = p_sale_id
    AND status IN ('pending', 'accrued', 'settled');
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_product_agent_commission(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_commission_id uuid,
  p_payment_date date,
  p_account_id uuid,
  p_payment_method text,
  p_payment_reference text,
  p_finance_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_commands%ROWTYPE;
  commission_row public.product_agent_commissions%ROWTYPE;
  settlement_row public.product_agent_commission_settlements%ROWTYPE;
  payment_row public.accounting_payments%ROWTYPE;
  settings_row public.accounting_settings%ROWTYPE;
  actor_role_value text;
  payment_date_value date := COALESCE(
    p_payment_date,
    public.organization_business_date(p_org_id, now())
  );
  payment_account_id_value uuid;
  payload_value jsonb;
  hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text = 'finance_manager';
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_request_id IS NULL OR p_commission_id IS NULL
     OR p_payment_method NOT IN ('cash', 'bank_transfer') THEN
    RAISE EXCEPTION 'Commission settlement input is invalid.'
      USING ERRCODE = '22023';
  END IF;

  payload_value := jsonb_build_object(
    'commission_id', p_commission_id,
    'payment_date', payment_date_value,
    'account_id', p_account_id,
    'payment_method', p_payment_method,
    'payment_reference', COALESCE(p_payment_reference, ''),
    'finance_notes', COALESCE(p_finance_notes, '')
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'commission_settle', p_commission_id, hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row
  FROM public.product_inventory_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'commission_settle'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for another commission settlement.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT commission.* INTO commission_row
  FROM public.product_agent_commissions commission
  JOIN public.agent_product_sales sale
    ON sale.organization_id = commission.organization_id
   AND sale.id = commission.sale_id
   AND sale.status = 'active'
  JOIN public.accounting_journal_entries journal
    ON journal.organization_id = commission.organization_id
   AND journal.id = commission.accrual_journal_entry_id
   AND journal.status = 'posted'
  WHERE commission.organization_id = p_org_id
    AND commission.id = p_commission_id
  FOR UPDATE OF commission;
  IF commission_row.id IS NULL OR commission_row.status <> 'accrued' THEN
    RAISE EXCEPTION 'Commission must be accrued, unpaid, and linked to an active posted sale.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO settings_row
  FROM public.accounting_settings
  WHERE organization_id = p_org_id;
  payment_account_id_value := COALESCE(
    p_account_id,
    CASE WHEN p_payment_method = 'cash'
      THEN settings_row.default_cash_account_id
      ELSE settings_row.default_bank_account_id
    END
  );
  IF settings_row.default_commission_payable_id IS NULL
     OR payment_account_id_value IS NULL THEN
    RAISE EXCEPTION 'Commission payable and cash/bank accounts are required.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO payment_row
  FROM public.accounting_save_payment(
    p_org_id,
    p_actor_user_id,
    public.accounting_child_command_id(p_command_id, 'product-commission-payment'),
    p_request_id,
    NULL,
    0,
    true,
    jsonb_build_object(
      'paymentDate', payment_date_value,
      'type', 'manual',
      'direction', 'outbound',
      'amount', commission_row.commission_amount,
      'accountId', payment_account_id_value,
      'counterpartAccountId', settings_row.default_commission_payable_id,
      'description', 'Product agent commission settlement',
      'referenceNo', NULLIF(btrim(p_payment_reference), ''),
      'method', p_payment_method,
      'notes', NULLIF(btrim(p_finance_notes), '')
    )
  );

  INSERT INTO public.product_agent_commission_settlements (
    organization_id, agent_id, commission_count, total_amount, currency,
    payment_method, payment_reference, finance_notes, accounting_payment_id,
    accounting_journal_entry_id, posted_by
  )
  VALUES (
    p_org_id, commission_row.agent_id, 1, commission_row.commission_amount,
    commission_row.currency, p_payment_method,
    NULLIF(btrim(p_payment_reference), ''),
    NULLIF(btrim(p_finance_notes), ''),
    payment_row.id, payment_row.journal_entry_id, p_actor_user_id
  )
  RETURNING * INTO settlement_row;

  UPDATE public.product_agent_commissions
  SET status = 'settled',
      settlement_id = settlement_row.id,
      settlement_journal_entry_id = payment_row.journal_entry_id,
      settled_by = p_actor_user_id,
      settled_at = settlement_row.posted_at,
      updated_at = now()
  WHERE organization_id = p_org_id AND id = commission_row.id
  RETURNING * INTO commission_row;

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.commission_settled',
    'settlement_id', settlement_row.id,
    'commission_id', commission_row.id,
    'sale_id', commission_row.sale_id,
    'agent_id', commission_row.agent_id,
    'amount', commission_row.commission_amount,
    'currency', commission_row.currency,
    'payment_id', payment_row.id,
    'journal_entry_id', payment_row.journal_entry_id,
    'version', 1
  );
  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_agent_commission_settlement',
    settlement_row.id::text, 1, event_payload, event_hash_value,
    'completed', p_request_id, p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.commission_settled',
    event_payload, event_hash_value
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'product_inventory.commission_settled',
    'product_agent_commission_settlements', settlement_row.id::text,
    'success', 201, event_payload
  );

  result_value := jsonb_build_object(
    'settlement', to_jsonb(settlement_row),
    'commission', to_jsonb(commission_row)
  );
  UPDATE public.product_inventory_commands
  SET entity_id = settlement_row.id,
      status = 'completed',
      result = result_value,
      completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_product_inventory_accounting_settings(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_row public.accounting_settings%ROWTYPE;
  account_id_value uuid;
  account_key_value text;
  expected_type_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_members member
    JOIN public.organizations organization ON organization.id = member.org_id
    JOIN public.profiles profile ON profile.user_id = member.user_id
      AND profile.org_id = member.org_id
    WHERE member.org_id = p_org_id
      AND member.user_id = p_actor_user_id
      AND member.role::text = 'finance_manager'
      AND lower(COALESCE(organization.status, '')) = 'active'
      AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  ) THEN
    RAISE EXCEPTION 'Finance Manager access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Request id and settings payload are required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO settings_row
  FROM public.accounting_settings
  WHERE organization_id = p_org_id
  FOR UPDATE;
  IF settings_row.id IS NULL THEN
    RAISE EXCEPTION 'Accounting settings were not initialized.' USING ERRCODE = 'P0002';
  END IF;
  IF settings_row.version <> COALESCE(p_expected_version, 0) THEN
    RAISE EXCEPTION 'Accounting settings version conflict.' USING ERRCODE = '40001';
  END IF;

  FOR account_key_value, expected_type_value IN
    SELECT * FROM (VALUES
      ('default_inventory_asset_id', 'asset'),
      ('default_inventory_grni_id', 'liability'),
      ('default_inventory_cogs_id', 'expense'),
      ('default_inventory_shrinkage_id', 'expense'),
      ('default_agent_receivable_id', 'asset'),
      ('default_accounts_payable_id', 'liability'),
      ('default_sales_revenue_id', 'revenue'),
      ('default_vat_payable_id', 'liability'),
      ('default_cash_account_id', 'asset'),
      ('default_bank_account_id', 'asset'),
      ('default_commission_expense_id', 'expense'),
      ('default_commission_payable_id', 'liability')
    ) AS account_requirement(account_key, expected_type)
  LOOP
    account_id_value := NULLIF(p_payload->>account_key_value, '')::uuid;
    IF account_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounting_accounts account
      WHERE account.organization_id = p_org_id
        AND account.id = account_id_value
        AND account.type = expected_type_value
        AND account.is_active
    ) THEN
      RAISE EXCEPTION 'Configured account % is missing, inactive, or has an invalid type.',
        account_key_value USING ERRCODE = '23514';
    END IF;
  END LOOP;

  UPDATE public.accounting_settings
  SET
    default_inventory_asset_id = COALESCE(NULLIF(p_payload->>'default_inventory_asset_id', '')::uuid, default_inventory_asset_id),
    default_inventory_grni_id = COALESCE(NULLIF(p_payload->>'default_inventory_grni_id', '')::uuid, default_inventory_grni_id),
    default_inventory_cogs_id = COALESCE(NULLIF(p_payload->>'default_inventory_cogs_id', '')::uuid, default_inventory_cogs_id),
    default_inventory_shrinkage_id = COALESCE(NULLIF(p_payload->>'default_inventory_shrinkage_id', '')::uuid, default_inventory_shrinkage_id),
    default_agent_receivable_id = COALESCE(NULLIF(p_payload->>'default_agent_receivable_id', '')::uuid, default_agent_receivable_id),
    default_accounts_payable_id = COALESCE(NULLIF(p_payload->>'default_accounts_payable_id', '')::uuid, default_accounts_payable_id),
    default_sales_revenue_id = COALESCE(NULLIF(p_payload->>'default_sales_revenue_id', '')::uuid, default_sales_revenue_id),
    default_vat_payable_id = COALESCE(NULLIF(p_payload->>'default_vat_payable_id', '')::uuid, default_vat_payable_id),
    default_cash_account_id = COALESCE(NULLIF(p_payload->>'default_cash_account_id', '')::uuid, default_cash_account_id),
    default_bank_account_id = COALESCE(NULLIF(p_payload->>'default_bank_account_id', '')::uuid, default_bank_account_id),
    default_commission_expense_id = COALESCE(NULLIF(p_payload->>'default_commission_expense_id', '')::uuid, default_commission_expense_id),
    default_commission_payable_id = COALESCE(NULLIF(p_payload->>'default_commission_payable_id', '')::uuid, default_commission_payable_id),
    auto_post_inventory_receipts = COALESCE((p_payload->>'auto_post_inventory_receipts')::boolean, auto_post_inventory_receipts),
    auto_post_product_sales = COALESCE((p_payload->>'auto_post_product_sales')::boolean, auto_post_product_sales),
    auto_post_product_collections = COALESCE((p_payload->>'auto_post_product_collections')::boolean, auto_post_product_collections),
    enable_product_agent_commissions = COALESCE((p_payload->>'enable_product_agent_commissions')::boolean, enable_product_agent_commissions),
    updated_at = now()
  WHERE organization_id = p_org_id
  RETURNING * INTO settings_row;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, 'finance_manager',
    'product_inventory.accounting_settings_updated', 'accounting_settings',
    settings_row.id::text, 'success', 200,
    jsonb_build_object('version', settings_row.version)
  );
  RETURN to_jsonb(settings_row);
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_inventory_loss_command(
  uuid, uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_inventory_loss_command(
  uuid, uuid, uuid, uuid, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.mark_product_inventory_accounting(
  uuid, text, uuid, text, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_product_inventory_accounting(
  uuid, text, uuid, text, uuid, uuid, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.record_product_agent_commission_accrual(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_product_agent_commission_accrual(
  uuid, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_product_agent_commissions(
  uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_product_agent_commissions(
  uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.settle_product_agent_commission(
  uuid, uuid, uuid, uuid, uuid, date, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_product_agent_commission(
  uuid, uuid, uuid, uuid, uuid, date, uuid, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.save_product_inventory_accounting_settings(
  uuid, uuid, uuid, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product_inventory_accounting_settings(
  uuid, uuid, uuid, integer, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_accounting_postings IS
  'One idempotent accounting/reversal link per receipt, sale, collection, or inventory loss source.';
COMMENT ON TABLE public.product_inventory_loss_records IS
  'Manager-recorded serialized inventory damage/loss snapshots used for exact shrinkage posting.';
COMMENT ON TABLE public.product_agent_commissions IS
  'Product sale commission accruals linked to the originating sale journal and an optional posted settlement.';
COMMENT ON FUNCTION public.mark_product_inventory_accounting(uuid, text, uuid, text, uuid, uuid, text, jsonb) IS
  'Service-only state linker for retryable product inventory accounting outcomes.';
