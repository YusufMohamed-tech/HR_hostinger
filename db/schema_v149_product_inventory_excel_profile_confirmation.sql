-- Upload-based template confirmation: Finance reviews only uncertain fields and
-- atomically creates an immutable active profile from private recognition evidence.

ALTER TABLE public.product_inventory_import_analyses
  ADD COLUMN IF NOT EXISTS confirmation_command_id uuid,
  ADD COLUMN IF NOT EXISTS confirmation_payload_hash text,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profile_id uuid;

ALTER TABLE public.product_inventory_import_profiles
  ADD CONSTRAINT product_inventory_import_profiles_id_org_unique
  UNIQUE (id, organization_id);

ALTER TABLE public.product_inventory_import_analyses
  DROP CONSTRAINT IF EXISTS product_inventory_import_analyses_confirmation_hash_check,
  DROP CONSTRAINT IF EXISTS product_inventory_import_analyses_profile_fk;
ALTER TABLE public.product_inventory_import_analyses
  ADD CONSTRAINT product_inventory_import_analyses_confirmation_hash_check
    CHECK (confirmation_payload_hash IS NULL OR length(confirmation_payload_hash) = 64),
  ADD CONSTRAINT product_inventory_import_analyses_profile_fk
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES public.product_inventory_import_profiles(id, organization_id)
    ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_inventory_import_analyses
  VALIDATE CONSTRAINT product_inventory_import_analyses_profile_fk;

CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_import_profiles_analysis_unique_idx
  ON public.product_inventory_import_profiles (organization_id, source_analysis_id)
  WHERE source_analysis_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_import_analyses_confirmation_command_idx
  ON public.product_inventory_import_analyses (organization_id, confirmation_command_id)
  WHERE confirmation_command_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.confirm_product_inventory_import_analysis(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_analysis_id uuid,
  p_profile_id uuid,
  p_payload jsonb
)
RETURNS public.product_inventory_import_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  analysis_row public.product_inventory_import_analyses%ROWTYPE;
  profile_row public.product_inventory_import_profiles%ROWTYPE;
  actor_role_value text;
  version_value integer;
  hash_value text;
  recognition_mode_value text;
  product_field_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_command_id IS NULL
     OR p_analysis_id IS NULL OR p_profile_id IS NULL
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Workbook profile confirmation payload is invalid.' USING ERRCODE = '22023';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
  LIMIT 1;
  IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager permission is required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO analysis_row
  FROM public.product_inventory_import_analyses analysis
  WHERE analysis.organization_id = p_org_id AND analysis.id = p_analysis_id
  FOR UPDATE;
  IF analysis_row.id IS NULL THEN
    RAISE EXCEPTION 'Workbook analysis was not found.' USING ERRCODE = 'P0002';
  END IF;
  hash_value := encode(digest(jsonb_build_object(
    'analysis_id', p_analysis_id, 'profile_id', p_profile_id, 'payload', p_payload
  )::text, 'sha256'), 'hex');
  IF analysis_row.status = 'confirmed' THEN
    IF analysis_row.confirmation_command_id <> p_command_id
       OR analysis_row.confirmation_payload_hash <> hash_value
       OR analysis_row.confirmed_by <> p_actor_user_id
       OR analysis_row.profile_id <> p_profile_id THEN
      RAISE EXCEPTION 'Workbook profile confirmation idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO profile_row FROM public.product_inventory_import_profiles
    WHERE organization_id = p_org_id AND id = p_profile_id;
    RETURN profile_row;
  END IF;
  IF analysis_row.status NOT IN ('ready', 'needs_review')
     OR analysis_row.expires_at <= now() THEN
    RAISE EXCEPTION 'Workbook analysis is not available for confirmation.' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_payload->'header_mapping') <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_payload->'header_mapping')) < 4 THEN
    RAISE EXCEPTION 'Detected workbook mapping is incomplete.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_payload->'header_mapping') mapping
    WHERE mapping.value NOT IN (
      'supplier_code', 'receipt_reference', 'product_sku', 'product_name',
      'model', 'serial_number', 'barcode', 'unit_cost', 'planned_sale_price',
      'minimum_sale_price', 'maximum_sale_price', 'commission_type',
      'commission_value', 'commission_base', 'currency', 'tax_code',
      'condition', 'notes'
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each_text(p_payload->'header_mapping') mapping
    GROUP BY mapping.value HAVING count(*) > 1 AND mapping.value <> 'serial_number'
  ) THEN
    RAISE EXCEPTION 'Detected workbook mapping contains invalid or duplicate fields.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(p_payload->'header_mapping') mapping
    WHERE mapping.value = 'serial_number'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(p_payload->'header_mapping') mapping
    WHERE mapping.value = 'unit_cost'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(p_payload->'header_mapping') mapping
    WHERE mapping.value = 'planned_sale_price'
  ) THEN
    RAISE EXCEPTION 'Serial, cost, and sale-price mappings are required.' USING ERRCODE = '23514';
  END IF;
  SELECT mapping.value INTO product_field_value
  FROM jsonb_each_text(p_payload->'header_mapping') mapping
  WHERE mapping.value IN ('product_sku', 'product_name', 'barcode')
  ORDER BY CASE mapping.value WHEN 'product_sku' THEN 1 WHEN 'barcode' THEN 2 ELSE 3 END
  LIMIT 1;
  IF product_field_value IS NULL THEN
    RAISE EXCEPTION 'SKU, barcode, or product-name mapping is required.' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 2 AND 160
     OR upper(COALESCE(NULLIF(p_payload->>'default_currency', ''), 'SAR')) !~ '^[A-Z]{3}$'
     OR COALESCE(NULLIF(p_payload->>'default_condition', ''), 'new')
        NOT IN ('new', 'open_box', 'refurbished')
     OR COALESCE(NULLIF(p_payload->>'default_ownership_type', ''), 'purchased')
        NOT IN ('purchased', 'consignment') THEN
    RAISE EXCEPTION 'Workbook profile defaults are invalid.' USING ERRCODE = '23514';
  END IF;
  recognition_mode_value := CASE
    WHEN analysis_row.status = 'ready'
      AND COALESCE((p_payload->>'has_corrections')::boolean, false) = false
      THEN 'automatic'
    ELSE 'reviewed'
  END;
  SELECT COALESCE(max(profile.version), 0) + 1 INTO version_value
  FROM public.product_inventory_import_profiles profile
  WHERE profile.organization_id = p_org_id
    AND profile.name = btrim(p_payload->>'name');

  UPDATE public.product_inventory_import_profiles
  SET is_active = false, updated_at = now()
  WHERE organization_id = p_org_id AND is_active;

  INSERT INTO public.product_inventory_import_profiles (
    id, organization_id, name, version, supplier_company_id,
    sheet_name, use_first_sheet, header_row, header_mapping,
    required_fields, default_currency, default_condition,
    default_ownership_type, is_active, sample_file_sha256,
    approval_note, approved_by, approved_at, created_by,
    recognition_mode, layout_fingerprint, source_analysis_id,
    mapping_confidence, workbook_shape, recognition_version
  ) VALUES (
    p_profile_id, p_org_id, btrim(p_payload->>'name'), version_value,
    analysis_row.supplier_company_id, analysis_row.detected_sheet_name,
    false, analysis_row.detected_header_row, p_payload->'header_mapping',
    jsonb_build_array('serial_number', product_field_value, 'unit_cost', 'planned_sale_price'),
    upper(COALESCE(NULLIF(p_payload->>'default_currency', ''), 'SAR')),
    COALESCE(NULLIF(p_payload->>'default_condition', ''), 'new'),
    COALESCE(NULLIF(p_payload->>'default_ownership_type', ''), 'purchased'),
    true, analysis_row.file_sha256,
    NULLIF(btrim(p_payload->>'approval_note'), ''), p_actor_user_id, now(), p_actor_user_id,
    recognition_mode_value, analysis_row.layout_fingerprint, analysis_row.id,
    COALESCE(p_payload->'mapping_confidence', '{}'::jsonb), analysis_row.workbook_shape,
    analysis_row.algorithm_version
  ) RETURNING * INTO profile_row;

  UPDATE public.product_inventory_import_analyses
  SET status = 'confirmed', confirmation_command_id = p_command_id,
      confirmation_payload_hash = hash_value, confirmed_by = p_actor_user_id,
      confirmed_at = now(), profile_id = profile_row.id,
      result = result || jsonb_build_object('profile', to_jsonb(profile_row)),
      updated_at = now()
  WHERE id = analysis_row.id;
  UPDATE public.managed_files
  SET retention_until = GREATEST(COALESCE(retention_until, CURRENT_DATE), CURRENT_DATE + 365)
  WHERE id = analysis_row.managed_file_id;
  RETURN profile_row;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_product_inventory_import_analysis(
  uuid, uuid, uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_product_inventory_import_analysis(
  uuid, uuid, uuid, uuid, uuid, jsonb
) TO service_role;

COMMENT ON FUNCTION public.confirm_product_inventory_import_analysis(
  uuid, uuid, uuid, uuid, uuid, jsonb
) IS 'Atomically confirms recognition evidence and activates one immutable generated workbook profile.';
