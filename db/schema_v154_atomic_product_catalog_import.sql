-- Atomic, idempotent product catalog import commit with optimistic concurrency.

CREATE OR REPLACE FUNCTION public.commit_product_catalog_import_v1(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_analysis_id uuid,
  p_analysis_version integer,
  p_apply_updates boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  command_row public.product_catalog_commands%ROWTYPE;
  analysis_row public.product_catalog_import_analyses%ROWTYPE;
  import_row public.product_catalog_import_rows%ROWTYPE;
  product_row public.sales_products%ROWTYPE;
  before_value jsonb;
  values_json jsonb;
  payload_value jsonb;
  hash_value text;
  result_value jsonb;
  company_id_value uuid;
  revenue_account_id_value uuid;
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
  created_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_analysis_id IS NULL OR p_analysis_version IS NULL THEN
    RAISE EXCEPTION 'Catalog commit identifiers are required.' USING ERRCODE = '22023';
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

  payload_value := jsonb_build_object(
    'analysis_id', p_analysis_id,
    'analysis_version', p_analysis_version,
    'apply_updates', COALESCE(p_apply_updates, false)
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  SELECT * INTO command_row
  FROM public.product_catalog_commands command
  WHERE command.organization_id = p_org_id AND command.command_id = p_command_id
  FOR UPDATE;
  IF command_row.id IS NOT NULL THEN
    IF command_row.payload_hash <> hash_value
       OR command_row.actor_user_id <> p_actor_user_id
       OR command_row.action <> 'catalog_import_commit'
       OR command_row.analysis_id <> p_analysis_id THEN
      RAISE EXCEPTION 'Catalog import idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    IF command_row.status = 'completed' THEN
      RETURN command_row.result;
    END IF;
    RAISE EXCEPTION 'Catalog import command is already processing.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO analysis_row
  FROM public.product_catalog_import_analyses analysis
  WHERE analysis.organization_id = p_org_id AND analysis.id = p_analysis_id
  FOR UPDATE;
  IF analysis_row.id IS NULL THEN
    RAISE EXCEPTION 'Catalog analysis was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF analysis_row.status = 'committed' THEN
    RAISE EXCEPTION 'Catalog analysis was already committed.' USING ERRCODE = '55000';
  END IF;
  IF analysis_row.status NOT IN ('ready', 'needs_review')
     OR analysis_row.expires_at <= now() THEN
    RAISE EXCEPTION 'Catalog analysis is not available for commit.' USING ERRCODE = '55000';
  END IF;
  IF analysis_row.analysis_version <> p_analysis_version THEN
    RAISE EXCEPTION 'Catalog analysis version conflict.' USING ERRCODE = '40001';
  END IF;
  IF jsonb_array_length(analysis_row.blocking_errors) > 0 THEN
    RAISE EXCEPTION 'Catalog analysis has blocking errors.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = analysis_row.company_id AND company.is_active = true
  ) THEN
    RAISE EXCEPTION 'Supplier company was not found or is inactive.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.product_catalog_commands (
    organization_id, command_id, request_id, actor_user_id, action,
    analysis_id, payload_hash
  ) VALUES (
    p_org_id, p_command_id, p_request_id, p_actor_user_id,
    'catalog_import_commit', p_analysis_id, hash_value
  ) RETURNING * INTO command_row;
  UPDATE public.product_catalog_import_analyses SET
    status = 'committing', updated_at = now()
  WHERE id = analysis_row.id;

  FOR import_row IN
    SELECT * FROM public.product_catalog_import_rows row_value
    WHERE row_value.organization_id = p_org_id
      AND row_value.analysis_id = p_analysis_id
    ORDER BY row_value.source_row, row_value.id
    FOR UPDATE
  LOOP
    IF import_row.classification NOT IN ('new', 'existing_update')
       OR (import_row.classification = 'existing_update' AND NOT COALESCE(p_apply_updates, false)) THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    IF jsonb_array_length(import_row.errors) > 0 THEN
      RAISE EXCEPTION 'A selected catalog row contains validation errors.' USING ERRCODE = '23514';
    END IF;
    values_json := import_row.normalized_values;
    company_id_value := analysis_row.company_id;
    name_value := btrim(COALESCE(values_json->>'product_name', ''));
    description_value := NULLIF(btrim(COALESCE(values_json->>'description', '')), '');
    unit_value := COALESCE(NULLIF(btrim(COALESCE(values_json->>'unit', '')), ''), 'جهاز');
    category_value := NULLIF(btrim(COALESCE(values_json->>'category', '')), '');
    sku_value := NULLIF(btrim(COALESCE(values_json->>'sku', '')), '');
    barcode_value := NULLIF(btrim(COALESCE(values_json->>'barcode', '')), '');
    model_value := NULLIF(btrim(COALESCE(values_json->>'model', '')), '');
    revenue_account_id_value := NULLIF(values_json->>'revenue_account_id', '')::uuid;
    price_value := (values_json->>'planned_sale_price')::numeric;
    default_cost_value := COALESCE((values_json->>'default_cost')::numeric, 0);
    commission_type_value := NULLIF(values_json->>'commission_type', 'none');
    commission_value := COALESCE((values_json->>'commission_value')::numeric, 0);
    active_value := COALESCE((values_json->>'is_active')::boolean, true);

    IF length(name_value) NOT BETWEEN 2 AND 200
       OR (sku_value IS NULL AND barcode_value IS NULL)
       OR price_value IS NULL OR price_value < 0 OR (active_value AND price_value <= 0)
       OR default_cost_value < 0
       OR (commission_type_value IS NULL AND commission_value <> 0)
       OR (commission_type_value IS NOT NULL AND commission_type_value NOT IN ('flat', 'percentage'))
       OR commission_value < 0
       OR (commission_type_value = 'percentage' AND commission_value > 100) THEN
      RAISE EXCEPTION 'Catalog row failed commit validation.' USING ERRCODE = '23514';
    END IF;
    IF revenue_account_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounting_accounts account
      WHERE account.organization_id = p_org_id
        AND account.id = revenue_account_id_value
        AND account.type = 'revenue' AND account.is_active = true
    ) THEN
      RAISE EXCEPTION 'Revenue account was not found or is inactive.' USING ERRCODE = 'P0002';
    END IF;

    IF import_row.classification = 'new' THEN
      IF import_row.matched_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'New catalog row unexpectedly matches a product.' USING ERRCODE = '40001';
      END IF;
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
      INSERT INTO public.product_catalog_audit_logs (
        organization_id, product_id, company_id, actor_user_id, request_id,
        command_id, action, source, source_analysis_id, before_values, after_values
      ) VALUES (
        p_org_id, product_row.id, product_row.company_id, p_actor_user_id,
        p_request_id, p_command_id, 'create', 'catalog_excel', p_analysis_id,
        NULL, to_jsonb(product_row)
      );
      created_count := created_count + 1;
    ELSE
      SELECT * INTO product_row
      FROM public.sales_products product
      WHERE product.organization_id = p_org_id
        AND product.id = import_row.matched_product_id
      FOR UPDATE;
      IF product_row.id IS NULL THEN
        RAISE EXCEPTION 'Matched product was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF product_row.company_id <> analysis_row.company_id
         OR product_row.inventory_version <> import_row.matched_inventory_version THEN
        RAISE EXCEPTION 'Product version or supplier changed after analysis.' USING ERRCODE = '40001';
      END IF;
      before_value := to_jsonb(product_row);
      UPDATE public.sales_products SET
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
      INSERT INTO public.product_catalog_audit_logs (
        organization_id, product_id, company_id, actor_user_id, request_id,
        command_id, action, source, source_analysis_id, before_values, after_values
      ) VALUES (
        p_org_id, product_row.id, product_row.company_id, p_actor_user_id,
        p_request_id, p_command_id, 'update', 'catalog_excel', p_analysis_id,
        before_value, to_jsonb(product_row)
      );
      updated_count := updated_count + 1;
    END IF;
  END LOOP;

  result_value := jsonb_build_object(
    'analysis_id', p_analysis_id,
    'created', created_count,
    'updated', updated_count,
    'skipped', skipped_count,
    'committed_at', now()
  );
  UPDATE public.product_catalog_import_analyses SET
    status = 'committed', committed_at = now(), updated_at = now()
  WHERE id = analysis_row.id;
  UPDATE public.product_catalog_commands SET
    status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'product_catalog.import_committed', 'product_catalog_import', p_analysis_id::text,
    'success', 200, result_value
  );
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_product_catalog_import_v1(
  uuid, uuid, uuid, uuid, uuid, integer, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_product_catalog_import_v1(
  uuid, uuid, uuid, uuid, uuid, integer, boolean
) TO service_role;

COMMENT ON FUNCTION public.commit_product_catalog_import_v1(
  uuid, uuid, uuid, uuid, uuid, integer, boolean
) IS 'Atomically creates safe new catalog products and explicitly approved existing-product updates with idempotency and optimistic concurrency.';
