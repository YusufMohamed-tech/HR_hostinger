-- Finance Manager product catalog: tenant-scoped feature switch, atomic manual
-- product commands, idempotency, and immutable catalog audit evidence.

ALTER TABLE public.product_inventory_commerce_settings
  ADD COLUMN IF NOT EXISTS finance_product_catalog_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.product_inventory_commerce_settings.finance_product_catalog_enabled IS
  'Tenant-scoped kill switch for Finance Manager product catalog management and imports.';

CREATE TABLE IF NOT EXISTS public.product_catalog_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'create', 'update', 'set_active', 'catalog_import_commit'
  )),
  entity_id uuid,
  analysis_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN (
    'processing', 'completed', 'failed'
  )),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, command_id)
);

CREATE INDEX IF NOT EXISTS product_catalog_commands_status_idx
  ON public.product_catalog_commands (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS product_catalog_commands_entity_idx
  ON public.product_catalog_commands (organization_id, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.product_catalog_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  command_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'activate', 'deactivate')),
  source text NOT NULL CHECK (source IN ('manual', 'catalog_excel', 'sales_product_ui', 'system')),
  source_analysis_id uuid,
  before_values jsonb CHECK (before_values IS NULL OR jsonb_typeof(before_values) = 'object'),
  after_values jsonb NOT NULL CHECK (jsonb_typeof(after_values) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_catalog_audit_product_idx
  ON public.product_catalog_audit_logs (organization_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_catalog_audit_actor_idx
  ON public.product_catalog_audit_logs (organization_id, actor_user_id, created_at DESC);

ALTER TABLE public.product_catalog_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_catalog_commands_service_only
  ON public.product_catalog_commands;
CREATE POLICY product_catalog_commands_service_only
  ON public.product_catalog_commands
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS product_catalog_audit_logs_service_only
  ON public.product_catalog_audit_logs;
CREATE POLICY product_catalog_audit_logs_service_only
  ON public.product_catalog_audit_logs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.execute_product_catalog_product_command(
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
  command_row public.product_catalog_commands%ROWTYPE;
  product_row public.sales_products%ROWTYPE;
  before_value jsonb;
  result_value jsonb;
  payload_value jsonb := COALESCE(p_payload, '{}'::jsonb);
  hash_value text;
  product_id_value uuid;
  company_id_value uuid;
  revenue_account_id_value uuid;
  expected_version_value integer;
  name_value text;
  description_value text;
  unit_value text;
  category_value text;
  sku_value text;
  barcode_value text;
  model_value text;
  price_value numeric(14,2);
  default_cost_value numeric(14,2);
  commission_type_value text;
  commission_value numeric(14,2);
  active_value boolean;
  audit_action_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR jsonb_typeof(payload_value) <> 'object' THEN
    RAISE EXCEPTION 'Product catalog command identifiers are required.' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('create', 'update', 'set_active') THEN
    RAISE EXCEPTION 'Unsupported product catalog action.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
  LIMIT 1;
  IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager permission is required.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_inventory_commerce_settings settings
    WHERE settings.organization_id = p_org_id
      AND settings.finance_product_catalog_enabled = false
  ) THEN
    RAISE EXCEPTION 'Finance product catalog is disabled.' USING ERRCODE = '55000';
  END IF;

  hash_value := encode(digest(
    jsonb_build_object('action', p_action, 'payload', payload_value)::text,
    'sha256'
  ), 'hex');
  SELECT * INTO command_row
  FROM public.product_catalog_commands command
  WHERE command.organization_id = p_org_id AND command.command_id = p_command_id
  FOR UPDATE;
  IF command_row.id IS NOT NULL THEN
    IF command_row.payload_hash <> hash_value
       OR command_row.actor_user_id <> p_actor_user_id
       OR command_row.action <> p_action THEN
      RAISE EXCEPTION 'Product catalog idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    IF command_row.status = 'completed' THEN
      RETURN command_row.result;
    END IF;
    RAISE EXCEPTION 'Product catalog command is already processing.' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.product_catalog_commands (
    organization_id, command_id, request_id, actor_user_id, action, payload_hash
  ) VALUES (
    p_org_id, p_command_id, p_request_id, p_actor_user_id, p_action, hash_value
  ) RETURNING * INTO command_row;

  IF p_action IN ('update', 'set_active') THEN
    BEGIN
      product_id_value := (payload_value->>'product_id')::uuid;
      expected_version_value := (payload_value->>'expected_version')::integer;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Product identifier or version is invalid.' USING ERRCODE = '22023';
    END;
    SELECT * INTO product_row
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id AND product.id = product_id_value
    FOR UPDATE;
    IF product_row.id IS NULL THEN
      RAISE EXCEPTION 'Product was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF expected_version_value IS NULL OR expected_version_value <> product_row.inventory_version THEN
      RAISE EXCEPTION 'Product version conflict.' USING ERRCODE = '40001';
    END IF;
    before_value := to_jsonb(product_row);
  END IF;

  IF p_action = 'set_active' THEN
    active_value := (payload_value->>'is_active')::boolean;
    IF active_value IS NULL THEN
      RAISE EXCEPTION 'Product active state is required.' USING ERRCODE = '22023';
    END IF;
    IF active_value = true AND product_row.price <= 0 THEN
      RAISE EXCEPTION 'An active product must have a sale price greater than zero.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.sales_products SET
      is_active = active_value,
      inventory_version = inventory_version + 1,
      updated_at = now()
    WHERE organization_id = p_org_id AND id = product_row.id
    RETURNING * INTO product_row;
    audit_action_value := CASE WHEN active_value THEN 'activate' ELSE 'deactivate' END;
  ELSE
    BEGIN
      company_id_value := (payload_value->>'company_id')::uuid;
      revenue_account_id_value := NULLIF(payload_value->>'revenue_account_id', '')::uuid;
      price_value := (payload_value->>'price')::numeric;
      default_cost_value := COALESCE((payload_value->>'default_cost')::numeric, 0);
      commission_value := COALESCE((payload_value->>'commission_value')::numeric, 0);
      active_value := COALESCE((payload_value->>'is_active')::boolean, true);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Product identifiers or monetary values are invalid.' USING ERRCODE = '22023';
    END;
    name_value := btrim(COALESCE(payload_value->>'name', ''));
    description_value := NULLIF(btrim(COALESCE(payload_value->>'description', '')), '');
    unit_value := COALESCE(NULLIF(btrim(COALESCE(payload_value->>'unit', '')), ''), 'جهاز');
    category_value := NULLIF(btrim(COALESCE(payload_value->>'category', '')), '');
    sku_value := NULLIF(btrim(COALESCE(payload_value->>'sku', '')), '');
    barcode_value := NULLIF(btrim(COALESCE(payload_value->>'barcode', '')), '');
    model_value := NULLIF(btrim(COALESCE(payload_value->>'model', '')), '');
    commission_type_value := NULLIF(payload_value->>'commission_type', 'none');

    IF length(name_value) NOT BETWEEN 2 AND 200 OR company_id_value IS NULL THEN
      RAISE EXCEPTION 'Product name and supplier are required.' USING ERRCODE = '23514';
    END IF;
    IF sku_value IS NULL AND barcode_value IS NULL THEN
      RAISE EXCEPTION 'SKU or barcode is required.' USING ERRCODE = '23514';
    END IF;
    IF price_value IS NULL OR price_value < 0 OR (active_value AND price_value <= 0)
       OR default_cost_value < 0 THEN
      RAISE EXCEPTION 'Product monetary values are invalid.' USING ERRCODE = '23514';
    END IF;
    IF (commission_type_value IS NULL AND commission_value <> 0)
       OR (commission_type_value IS NOT NULL AND commission_type_value NOT IN ('flat', 'percentage'))
       OR commission_value < 0
       OR (commission_type_value = 'percentage' AND commission_value > 100) THEN
      RAISE EXCEPTION 'Product commission is invalid.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.sales_companies company
      WHERE company.organization_id = p_org_id
        AND company.id = company_id_value AND company.is_active = true
    ) THEN
      RAISE EXCEPTION 'Supplier company was not found or is inactive.' USING ERRCODE = 'P0002';
    END IF;
    IF revenue_account_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounting_accounts account
      WHERE account.organization_id = p_org_id
        AND account.id = revenue_account_id_value
        AND account.type = 'revenue' AND account.is_active = true
    ) THEN
      RAISE EXCEPTION 'Revenue account was not found or is inactive.' USING ERRCODE = 'P0002';
    END IF;

    IF p_action = 'create' THEN
      INSERT INTO public.sales_products (
        organization_id, company_id, name, description, unit, category, price,
        is_active, created_by, sku, barcode, model, tracking_mode,
        inventory_enabled, default_cost, revenue_account_id,
        agent_commission_type, agent_commission_value, inventory_version
      ) VALUES (
        p_org_id, company_id_value, name_value, description_value, unit_value,
        category_value, price_value, active_value, p_actor_user_id, sku_value,
        barcode_value, model_value, 'serialized', true, default_cost_value,
        revenue_account_id_value, commission_type_value, commission_value, 1
      ) RETURNING * INTO product_row;
      audit_action_value := 'create';
    ELSE
      UPDATE public.sales_products SET
        company_id = company_id_value,
        name = name_value,
        description = description_value,
        unit = unit_value,
        category = category_value,
        price = price_value,
        is_active = active_value,
        sku = sku_value,
        barcode = barcode_value,
        model = model_value,
        tracking_mode = 'serialized',
        inventory_enabled = true,
        default_cost = default_cost_value,
        revenue_account_id = revenue_account_id_value,
        agent_commission_type = commission_type_value,
        agent_commission_value = commission_value,
        inventory_version = inventory_version + 1,
        updated_at = now()
      WHERE organization_id = p_org_id AND id = product_row.id
      RETURNING * INTO product_row;
      audit_action_value := 'update';
    END IF;
  END IF;

  INSERT INTO public.product_catalog_audit_logs (
    organization_id, product_id, company_id, actor_user_id, request_id,
    command_id, action, source, before_values, after_values
  ) VALUES (
    p_org_id, product_row.id, product_row.company_id, p_actor_user_id, p_request_id,
    p_command_id, audit_action_value, 'manual', before_value, to_jsonb(product_row)
  );

  result_value := jsonb_build_object('product', to_jsonb(product_row));
  UPDATE public.product_catalog_commands SET
    entity_id = product_row.id,
    status = 'completed',
    result = result_value,
    completed_at = now()
  WHERE id = command_row.id;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'product_catalog.' || audit_action_value, 'sales_product', product_row.id::text,
    'success', CASE WHEN p_action = 'create' THEN 201 ELSE 200 END,
    jsonb_build_object('company_id', product_row.company_id, 'inventory_version', product_row.inventory_version)
  );
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_catalog_product_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_catalog_product_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON TABLE public.product_catalog_commands IS
  'Idempotency and terminal results for Finance Manager catalog mutations.';
COMMENT ON TABLE public.product_catalog_audit_logs IS
  'Immutable before/after evidence for manual and Excel product catalog mutations.';
COMMENT ON FUNCTION public.execute_product_catalog_product_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS 'Atomically creates, updates, activates, or deactivates a serialized inventory product for Finance Managers.';
