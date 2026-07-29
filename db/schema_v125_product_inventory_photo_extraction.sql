-- Phase 3: local OCR/barcode photo receiving with private evidence, reviewed
-- candidates, approved aliases, confidence/correction metrics, and atomic
-- grouping through the Phase 1 serialized receipt command.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-inventory-photos',
  'product-inventory-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_inventory_photos_storage_select ON storage.objects;
CREATE POLICY product_inventory_photos_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'product-inventory-photos' AND auth.role() = 'service_role'
  );
DROP POLICY IF EXISTS product_inventory_photos_storage_insert ON storage.objects;
CREATE POLICY product_inventory_photos_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'product-inventory-photos' AND auth.role() = 'service_role'
  );
DROP POLICY IF EXISTS product_inventory_photos_storage_update ON storage.objects;
CREATE POLICY product_inventory_photos_storage_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'product-inventory-photos' AND auth.role() = 'service_role'
  )
  WITH CHECK (
    bucket_id = 'product-inventory-photos' AND auth.role() = 'service_role'
  );
DROP POLICY IF EXISTS product_inventory_photos_storage_delete ON storage.objects;
CREATE POLICY product_inventory_photos_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'product-inventory-photos' AND auth.role() = 'service_role'
  );

ALTER TABLE public.managed_files
  DROP CONSTRAINT IF EXISTS managed_files_owner_type_check;
ALTER TABLE public.managed_files
  ADD CONSTRAINT managed_files_owner_type_check CHECK (
    owner_type IN (
      'personnel_file', 'employee_contract', 'employee_document',
      'candidate_application_cv', 'candidate_application_attachment',
      'product_inventory_workbook', 'product_inventory_photo'
    )
  );

CREATE OR REPLACE FUNCTION public.normalize_product_alias(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_value, '')), '[^[:alnum:]]+', '', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.product_inventory_photo_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.product_receipt_sources(id) ON DELETE CASCADE,
  candidate_index integer NOT NULL CHECK (candidate_index > 0 AND candidate_index <= 200),
  raw_product_name text,
  raw_sku text,
  raw_model text,
  raw_serial text,
  raw_barcode text,
  suggested_product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  final_product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  final_serial text,
  normalized_serial text,
  unit_cost numeric(14,2),
  planned_sale_price numeric(14,2),
  currency text,
  condition text,
  row_status text NOT NULL CHECK (
    row_status IN ('valid', 'warning', 'invalid', 'duplicate', 'unmatched')
  ),
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  match_method text NOT NULL DEFAULT 'none' CHECK (
    match_method IN ('sku', 'barcode', 'name', 'alias', 'fuzzy', 'none')
  ),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(validation_errors) = 'array'),
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(validation_warnings) = 'array'),
  save_as_alias boolean NOT NULL DEFAULT false,
  warning_accepted boolean NOT NULL DEFAULT false,
  product_corrected boolean NOT NULL DEFAULT false,
  serial_corrected boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, candidate_index)
);

CREATE INDEX IF NOT EXISTS product_inventory_photo_candidates_receipt_idx
  ON public.product_inventory_photo_candidates
  (organization_id, receipt_id, row_status, source_id, candidate_index);
CREATE INDEX IF NOT EXISTS product_inventory_photo_candidates_serial_idx
  ON public.product_inventory_photo_candidates (organization_id, normalized_serial)
  WHERE normalized_serial IS NOT NULL;

ALTER TABLE public.product_inventory_photo_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_photo_candidates_select
  ON public.product_inventory_photo_candidates;
CREATE POLICY product_inventory_photo_candidates_select
  ON public.product_inventory_photo_candidates
  FOR SELECT USING (
    organization_id = public.current_org_id()
    AND public.can_view_product_inventory()
  );

CREATE TABLE IF NOT EXISTS public.product_inventory_photo_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('photo_preview', 'photo_commit')),
  receipt_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.product_inventory_photo_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_photo_commands_service_only
  ON public.product_inventory_photo_commands;
CREATE POLICY product_inventory_photo_commands_service_only
  ON public.product_inventory_photo_commands
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_product_inventory_photo_candidates_updated_at
  ON public.product_inventory_photo_candidates;
CREATE TRIGGER trg_product_inventory_photo_candidates_updated_at
  BEFORE UPDATE ON public.product_inventory_photo_candidates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.execute_product_photo_preview(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_header jsonb,
  p_sources jsonb,
  p_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_photo_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  actor_role_value text;
  supplier_id_value uuid;
  warehouse_id_value uuid;
  ownership_value text;
  receipt_date_value date;
  currency_value text;
  source_count_value integer;
  candidate_count_value integer;
  payload_value jsonb;
  hash_value text;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Photo preview identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_header, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_sources, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_candidates, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Photo preview payload is invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'sales_manager', 'onground_agent_manager', 'inventory_receiver'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'header', p_header,
    'sources', p_sources,
    'candidates', p_candidates
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_photo_commands (
    organization_id, idempotency_key, action, receipt_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'photo_preview', p_receipt_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_photo_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'photo_preview'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Photo preview idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  supplier_id_value := NULLIF(p_header->>'supplier_company_id', '')::uuid;
  warehouse_id_value := NULLIF(p_header->>'warehouse_id', '')::uuid;
  ownership_value := lower(btrim(COALESCE(p_header->>'ownership_type', 'purchased')));
  receipt_date_value := COALESCE(NULLIF(p_header->>'receipt_date', '')::date, CURRENT_DATE);
  currency_value := upper(btrim(COALESCE(p_header->>'currency', 'SAR')));
  source_count_value := jsonb_array_length(p_sources);
  candidate_count_value := jsonb_array_length(p_candidates);

  IF supplier_id_value IS NULL OR warehouse_id_value IS NULL
     OR ownership_value NOT IN ('purchased', 'consignment')
     OR currency_value !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Photo receipt header is invalid.' USING ERRCODE = '23514';
  END IF;
  IF source_count_value < 1 OR source_count_value > 8
     OR candidate_count_value < 1 OR candidate_count_value > 200 THEN
    RAISE EXCEPTION 'Photo intake supports 1-8 images and 1-200 candidates.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT item.value->>'source_id')
    FROM jsonb_array_elements(p_sources) item(value)
  ) <> source_count_value OR (
    SELECT count(DISTINCT item.value->>'managed_file_id')
    FROM jsonb_array_elements(p_sources) item(value)
  ) <> source_count_value THEN
    RAISE EXCEPTION 'Photo source and file identifiers must be unique.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_sources) item(value)
    WHERE item.value->'file'->>'bucket' <> 'product-inventory-photos'
      OR item.value->'file'->>'scan_status' <> 'clean'
      OR item.value->'file'->>'type' NOT IN ('image/jpeg', 'image/png', 'image/webp')
      OR length(COALESCE(item.value->'file'->>'sha256', '')) <> 64
      OR COALESCE((item.value->'file'->>'size_bytes')::bigint, 0) <= 0
      OR COALESCE((item.value->'file'->>'size_bytes')::bigint, 0) > 10485760
      OR item.value->'file'->>'path' NOT LIKE
        p_org_id::text || '/' || p_receipt_id::text || '/' || p_command_id::text || '/%'
      OR item.value->'extraction'->>'engine' <> 'tesseract-zxing-local'
      OR item.value->'extraction'->>'version' <> 'local-product-label-v1'
      OR jsonb_typeof(COALESCE(item.value->'extraction'->'barcode_values', '[]'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(item.value->'extraction'->'bounding_boxes', '[]'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'Every photo must be clean, private, and locally extracted.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT COALESCE(sum((item.value->'file'->>'size_bytes')::bigint), 0)
    FROM jsonb_array_elements(p_sources) item(value)
  ) > 41943040 THEN
    RAISE EXCEPTION 'The combined photo upload exceeds 40 MB.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_sources) source(value)
      WHERE source.value->>'source_id' = item.value->>'source_id'
    )
      OR COALESCE((item.value->>'candidate_index')::integer, 0) <= 0
      OR item.value->>'status' NOT IN ('valid', 'warning', 'invalid', 'duplicate', 'unmatched')
      OR jsonb_typeof(COALESCE(item.value->'validation_errors', '[]'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(item.value->'validation_warnings', '[]'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'Photo candidates do not match their source images.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT (item.value->>'source_id') || ':' || (item.value->>'candidate_index'))
    FROM jsonb_array_elements(p_candidates) item(value)
  ) <> candidate_count_value THEN
    RAISE EXCEPTION 'Photo candidate indexes must be unique per source.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_receipts
    WHERE organization_id = p_org_id AND id = p_receipt_id
  ) THEN
    RAISE EXCEPTION 'Photo receipt already exists.' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = supplier_id_value
      AND company.is_active = true
  ) THEN
    RAISE EXCEPTION 'Supplier company was not found or is inactive.'
      USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = supplier_id_value
     AND product.id = NULLIF(item.value->>'product_id', '')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE NULLIF(item.value->>'product_id', '') IS NOT NULL
      AND product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Photo preview contains a product outside the selected supplier catalog.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO warehouse_row
  FROM public.inventory_warehouses warehouse
  WHERE warehouse.organization_id = p_org_id
    AND warehouse.id = warehouse_id_value
    AND warehouse.is_active = true
  FOR SHARE;
  IF warehouse_row.id IS NULL THEN
    RAISE EXCEPTION 'Warehouse was not found or is inactive.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.product_receipts (
    id, organization_id, receipt_no, supplier_company_id,
    legal_entity_id, branch_id, warehouse_id, ownership_type,
    receipt_date, delivery_note_no, supplier_invoice_no,
    invoice_received, currency, notes, source_methods, status,
    accounting_status, created_by
  )
  VALUES (
    p_receipt_id, p_org_id,
    public.next_product_receipt_number(p_org_id, receipt_date_value),
    supplier_id_value, warehouse_row.legal_entity_id, warehouse_row.branch_id,
    warehouse_id_value, ownership_value, receipt_date_value,
    NULLIF(btrim(p_header->>'delivery_note_no'), ''),
    NULLIF(btrim(p_header->>'supplier_invoice_no'), ''),
    COALESCE((p_header->>'invoice_received')::boolean, false),
    currency_value, NULLIF(btrim(p_header->>'notes'), ''),
    ARRAY['photo']::text[], 'needs_review',
    CASE WHEN ownership_value = 'consignment' THEN 'not_required' ELSE 'pending' END,
    p_actor_user_id
  )
  RETURNING * INTO receipt_row;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, owner_type, owner_id,
    original_name, detected_mime, size_bytes, sha256,
    scan_status, scan_engine, scanned_at, retention_until, uploaded_by
  )
  SELECT
    (item.value->>'managed_file_id')::uuid, p_org_id,
    item.value->'file'->>'bucket', item.value->'file'->>'path',
    'product_inventory_photo', (item.value->>'source_id')::uuid,
    item.value->'file'->>'filename', item.value->'file'->>'type',
    (item.value->'file'->>'size_bytes')::bigint,
    item.value->'file'->>'sha256', item.value->'file'->>'scan_status',
    item.value->'file'->>'scan_engine',
    (item.value->'file'->>'scanned_at')::timestamptz,
    CURRENT_DATE + 365, p_actor_user_id
  FROM jsonb_array_elements(p_sources) item(value);

  INSERT INTO public.product_receipt_sources (
    id, organization_id, receipt_id, source_type, storage_path,
    original_name, mime_type, size_bytes, extraction_provider,
    extraction_version, extraction_status, raw_extraction, confidence,
    uploaded_by, managed_file_id, file_sha256, total_rows,
    valid_rows, warning_rows, invalid_rows, duplicate_rows, unmatched_rows
  )
  SELECT
    (source.value->>'source_id')::uuid, p_org_id, p_receipt_id, 'photo',
    source.value->'file'->>'path', source.value->'file'->>'filename',
    source.value->'file'->>'type',
    (source.value->'file'->>'size_bytes')::bigint,
    source.value->'extraction'->>'engine',
    source.value->'extraction'->>'version', 'completed',
    source.value->'extraction',
    CASE
      WHEN NULLIF(source.value->'extraction'->>'ocr_confidence', '') IS NULL THEN NULL
      ELSE round((source.value->'extraction'->>'ocr_confidence')::numeric / 100, 4)
    END,
    p_actor_user_id, (source.value->>'managed_file_id')::uuid,
    source.value->'file'->>'sha256',
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'valid'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'warning'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'invalid'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'duplicate'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'unmatched')
  FROM jsonb_array_elements(p_sources) source(value);

  INSERT INTO public.product_inventory_photo_candidates (
    organization_id, receipt_id, source_id, candidate_index,
    raw_product_name, raw_sku, raw_model, raw_serial, raw_barcode,
    suggested_product_id, final_product_id, final_serial, normalized_serial,
    unit_cost, planned_sale_price, currency, condition, row_status,
    confidence, match_method, validation_errors, validation_warnings
  )
  SELECT
    p_org_id, p_receipt_id, (item.value->>'source_id')::uuid,
    (item.value->>'candidate_index')::integer,
    NULLIF(item.value->>'raw_product_name', ''),
    NULLIF(item.value->>'raw_sku', ''),
    NULLIF(item.value->>'raw_model', ''),
    NULLIF(item.value->>'raw_serial', ''),
    NULLIF(item.value->>'raw_barcode', ''),
    NULLIF(item.value->>'product_id', '')::uuid,
    NULLIF(item.value->>'product_id', '')::uuid,
    NULLIF(item.value->>'serial_number', ''),
    NULLIF(item.value->>'normalized_serial', ''),
    NULLIF(item.value->>'unit_cost', '')::numeric,
    NULLIF(item.value->>'planned_sale_price', '')::numeric,
    NULLIF(item.value->>'currency', ''),
    NULLIF(item.value->>'condition', ''),
    item.value->>'status',
    COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 0),
    COALESCE(NULLIF(item.value->>'match_method', ''), 'none'),
    COALESCE(item.value->'validation_errors', '[]'::jsonb),
    COALESCE(item.value->'validation_warnings', '[]'::jsonb)
  FROM jsonb_array_elements(p_candidates) item(value);

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.photo_previewed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'source_count', source_count_value,
    'candidate_count', candidate_count_value,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_photo',
    receipt_row.id::text || ':preview', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.photo_previewed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'sources', (
      SELECT COALESCE(jsonb_agg(to_jsonb(source) ORDER BY source.created_at), '[]'::jsonb)
      FROM public.product_receipt_sources source
      WHERE source.organization_id = p_org_id AND source.receipt_id = p_receipt_id
    )
  );
  UPDATE public.product_inventory_photo_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_product_photo_commit(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_expected_version integer,
  p_warnings_accepted boolean,
  p_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_photo_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  actor_role_value text;
  candidate_count_value integer;
  group_count_value integer;
  payload_value jsonb;
  hash_value text;
  groups_value jsonb;
  receipt_result jsonb;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Photo commit identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_candidates, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Photo candidates must be an array.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'sales_manager', 'onground_agent_manager', 'inventory_receiver'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'expected_version', p_expected_version,
    'warnings_accepted', COALESCE(p_warnings_accepted, false),
    'candidates', p_candidates
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_photo_commands (
    organization_id, idempotency_key, action, receipt_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'photo_commit', p_receipt_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_photo_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'photo_commit'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Photo commit idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO receipt_row
  FROM public.product_receipts receipt
  WHERE receipt.organization_id = p_org_id AND receipt.id = p_receipt_id
  FOR UPDATE;
  IF receipt_row.id IS NULL THEN
    RAISE EXCEPTION 'Photo receipt was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm') THEN
    RAISE EXCEPTION 'Only an editable photo receipt can be committed.'
      USING ERRCODE = '55000';
  END IF;
  IF receipt_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
  END IF;
  IF receipt_row.created_by <> p_actor_user_id
     AND actor_role_value = 'inventory_receiver' THEN
    RAISE EXCEPTION 'Receivers can commit only their own photo receipts.'
      USING ERRCODE = '42501';
  END IF;

  candidate_count_value := jsonb_array_length(p_candidates);
  IF candidate_count_value < 1 OR candidate_count_value > 200
     OR candidate_count_value <> (
       SELECT count(*) FROM public.product_inventory_photo_candidates stored
       WHERE stored.organization_id = p_org_id AND stored.receipt_id = p_receipt_id
     ) THEN
    RAISE EXCEPTION 'Every extracted photo candidate must be included before commit.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT (item.value->>'source_id') || ':' || (item.value->>'candidate_index'))
    FROM jsonb_array_elements(p_candidates) item(value)
  ) <> candidate_count_value OR EXISTS (
    SELECT 1
    FROM public.product_inventory_photo_candidates stored
    WHERE stored.organization_id = p_org_id
      AND stored.receipt_id = p_receipt_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_candidates) item(value)
        WHERE (item.value->>'source_id')::uuid = stored.source_id
          AND (item.value->>'candidate_index')::integer = stored.candidate_index
      )
  ) THEN
    RAISE EXCEPTION 'Photo candidate identifiers do not match the stored preview.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    WHERE item.value->>'status' NOT IN ('valid', 'warning')
      OR jsonb_array_length(COALESCE(item.value->'validation_errors', '[]'::jsonb)) > 0
      OR NULLIF(item.value->>'product_id', '') IS NULL
      OR NULLIF(item.value->>'serial_number', '') IS NULL
      OR COALESCE(NULLIF(item.value->>'unit_cost', '')::numeric, 0) <= 0
      OR COALESCE(NULLIF(item.value->>'planned_sale_price', '')::numeric, 0) <= 0
      OR COALESCE(item.value->>'currency', '') !~ '^[A-Z]{3}$'
      OR COALESCE(item.value->>'condition', '') NOT IN ('new', 'open_box', 'refurbished')
  ) THEN
    RAISE EXCEPTION 'All photo candidates must be matched, uniquely serialized, and priced.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidates) item(value)
    WHERE item.value->>'status' = 'warning'
  ) AND NOT COALESCE(p_warnings_accepted, false) THEN
    RAISE EXCEPTION 'Photo extraction warnings require explicit receiver acceptance.'
      USING ERRCODE = '23514';
  END IF;
  IF actor_role_value = 'inventory_receiver' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidates) item(value)
    WHERE COALESCE((item.value->>'save_as_alias')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'Only inventory managers can approve product aliases.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    LEFT JOIN public.product_receipt_sources source
      ON source.organization_id = p_org_id
     AND source.receipt_id = p_receipt_id
     AND source.source_type = 'photo'
     AND source.id = (item.value->>'source_id')::uuid
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = receipt_row.supplier_company_id
     AND product.id = (item.value->>'product_id')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE source.id IS NULL OR product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every photo candidate must use its own source and an active supplier product.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT public.normalize_product_serial(item.value->>'serial_number'))
    FROM jsonb_array_elements(p_candidates) item(value)
  ) <> candidate_count_value THEN
    RAISE EXCEPTION 'Photo candidate serial numbers must be unique.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    JOIN public.product_inventory_units unit
      ON unit.organization_id = p_org_id
     AND unit.normalized_serial_number =
       public.normalize_product_serial(item.value->>'serial_number')
  ) THEN
    RAISE EXCEPTION 'One or more photo serial numbers already exist in confirmed stock.'
      USING ERRCODE = '23505';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', grouped.product_id,
      'unit_cost', grouped.unit_cost,
      'planned_sale_price', grouped.planned_sale_price,
      'currency', grouped.currency,
      'tax_included', true,
      'condition', grouped.condition,
      'serial_numbers', grouped.serial_numbers
    )
    ORDER BY grouped.first_candidate
  ), count(*)
  INTO groups_value, group_count_value
  FROM (
    SELECT
      (item.value->>'product_id')::uuid AS product_id,
      (item.value->>'unit_cost')::numeric AS unit_cost,
      (item.value->>'planned_sale_price')::numeric AS planned_sale_price,
      item.value->>'currency' AS currency,
      item.value->>'condition' AS condition,
      min((item.value->>'candidate_index')::integer) AS first_candidate,
      jsonb_agg(
        item.value->>'serial_number'
        ORDER BY (item.value->>'source_id'), (item.value->>'candidate_index')::integer
      ) AS serial_numbers
    FROM jsonb_array_elements(p_candidates) item(value)
    GROUP BY
      (item.value->>'product_id')::uuid,
      (item.value->>'unit_cost')::numeric,
      (item.value->>'planned_sale_price')::numeric,
      item.value->>'currency',
      item.value->>'condition'
  ) grouped;
  IF group_count_value > 100 THEN
    RAISE EXCEPTION 'Photo candidates produce more than 100 price groups.'
      USING ERRCODE = '23514';
  END IF;

  receipt_result := public.execute_product_receipt_command(
    p_org_id,
    p_actor_user_id,
    p_request_id,
    p_command_id,
    'receipt_draft_save',
    jsonb_build_object(
      'receipt_id', receipt_row.id,
      'expected_version', receipt_row.version,
      'supplier_company_id', receipt_row.supplier_company_id,
      'warehouse_id', receipt_row.warehouse_id,
      'ownership_type', receipt_row.ownership_type,
      'receipt_date', receipt_row.receipt_date,
      'delivery_note_no', receipt_row.delivery_note_no,
      'supplier_invoice_no', receipt_row.supplier_invoice_no,
      'invoice_received', receipt_row.invoice_received,
      'currency', receipt_row.currency,
      'notes', receipt_row.notes,
      'groups', groups_value
    )
  );

  UPDATE public.product_inventory_photo_candidates stored
  SET final_product_id = (item.value->>'product_id')::uuid,
      final_serial = item.value->>'serial_number',
      normalized_serial = public.normalize_product_serial(item.value->>'serial_number'),
      unit_cost = (item.value->>'unit_cost')::numeric,
      planned_sale_price = (item.value->>'planned_sale_price')::numeric,
      currency = item.value->>'currency',
      condition = item.value->>'condition',
      row_status = item.value->>'status',
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, stored.confidence),
      match_method = COALESCE(NULLIF(item.value->>'match_method', ''), stored.match_method),
      validation_errors = '[]'::jsonb,
      validation_warnings = COALESCE(item.value->'validation_warnings', '[]'::jsonb),
      save_as_alias = COALESCE((item.value->>'save_as_alias')::boolean, false),
      warning_accepted = item.value->>'status' = 'warning' AND COALESCE(p_warnings_accepted, false),
      product_corrected = stored.suggested_product_id IS DISTINCT FROM (item.value->>'product_id')::uuid,
      serial_corrected = public.normalize_product_serial(stored.raw_serial)
        IS DISTINCT FROM public.normalize_product_serial(item.value->>'serial_number'),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  FROM jsonb_array_elements(p_candidates) item(value)
  WHERE stored.organization_id = p_org_id
    AND stored.receipt_id = p_receipt_id
    AND stored.source_id = (item.value->>'source_id')::uuid
    AND stored.candidate_index = (item.value->>'candidate_index')::integer;

  UPDATE public.product_receipt_candidates candidate
  SET source_id = (item.value->>'source_id')::uuid,
      source_reference = 'photo:' || (item.value->>'candidate_index'),
      raw_product_name = NULLIF(item.value->>'raw_product_name', ''),
      barcode = NULLIF(item.value->>'raw_barcode', ''),
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 1),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  FROM jsonb_array_elements(p_candidates) item(value)
  WHERE candidate.organization_id = p_org_id
    AND candidate.receipt_id = p_receipt_id
    AND candidate.normalized_serial =
      public.normalize_product_serial(item.value->>'serial_number');

  IF actor_role_value IN ('admin', 'sales_manager', 'onground_agent_manager') THEN
    INSERT INTO public.product_inventory_aliases (
      organization_id, product_id, alias_type, alias_value, normalized_value,
      source, is_approved, approved_by, approved_at, created_by
    )
    SELECT
      p_org_id, (item.value->>'product_id')::uuid, 'name',
      btrim(item.value->>'raw_product_name'),
      public.normalize_product_alias(item.value->>'raw_product_name'),
      'photo_correction', true, p_actor_user_id, now(), p_actor_user_id
    FROM jsonb_array_elements(p_candidates) item(value)
    WHERE COALESCE((item.value->>'save_as_alias')::boolean, false)
      AND length(public.normalize_product_alias(item.value->>'raw_product_name')) >= 2
    ON CONFLICT (organization_id, alias_type, normalized_value) DO NOTHING;
  END IF;

  UPDATE public.product_receipt_sources source
  SET valid_rows = counts.valid_rows,
      warning_rows = counts.warning_rows,
      invalid_rows = 0,
      duplicate_rows = 0,
      unmatched_rows = 0,
      committed_at = now(),
      updated_at = now()
  FROM (
    SELECT
      (item.value->>'source_id')::uuid AS source_id,
      count(*) FILTER (WHERE item.value->>'status' = 'valid') AS valid_rows,
      count(*) FILTER (WHERE item.value->>'status' = 'warning') AS warning_rows
    FROM jsonb_array_elements(p_candidates) item(value)
    GROUP BY (item.value->>'source_id')::uuid
  ) counts
  WHERE source.organization_id = p_org_id
    AND source.receipt_id = p_receipt_id
    AND source.id = counts.source_id;

  UPDATE public.product_receipts
  SET source_methods = ARRAY['photo']::text[],
      updated_at = now()
  WHERE organization_id = p_org_id AND id = p_receipt_id
  RETURNING * INTO receipt_row;

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.photo_committed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'candidate_count', candidate_count_value,
    'group_count', group_count_value,
    'warning_count', (
      SELECT count(*) FROM jsonb_array_elements(p_candidates) item(value)
      WHERE item.value->>'status' = 'warning'
    ),
    'product_corrections', (
      SELECT count(*) FROM public.product_inventory_photo_candidates candidate
      WHERE candidate.organization_id = p_org_id
        AND candidate.receipt_id = p_receipt_id
        AND candidate.product_corrected
    ),
    'serial_corrections', (
      SELECT count(*) FROM public.product_inventory_photo_candidates candidate
      WHERE candidate.organization_id = p_org_id
        AND candidate.receipt_id = p_receipt_id
        AND candidate.serial_corrected
    ),
    'total_units', receipt_row.total_units,
    'total_cost', receipt_row.physical_total_cost,
    'expected_sales_value', receipt_row.expected_sales_value,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_photo',
    receipt_row.id::text || ':commit', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.photo_committed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'group_count', group_count_value,
    'candidate_count', candidate_count_value
  );
  UPDATE public.product_inventory_photo_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_photo_preview(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_photo_preview(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_photo_commit(
  uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_photo_commit(
  uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_photo_candidates IS
  'Locally extracted product/serial candidates with source image, confidence, corrections, and alias review evidence.';
