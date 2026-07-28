-- Phase 2: secure Excel/CSV previews, row-level evidence, correction, grouping,
-- and atomic commit through the Phase 1 serialized receipt command.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-inventory-imports',
  'product-inventory-imports',
  false,
  10485760,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'application/csv'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_inventory_imports_storage_select ON storage.objects;
CREATE POLICY product_inventory_imports_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'product-inventory-imports' AND auth.role() = 'service_role'
  );
DROP POLICY IF EXISTS product_inventory_imports_storage_insert ON storage.objects;
CREATE POLICY product_inventory_imports_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'product-inventory-imports' AND auth.role() = 'service_role'
  );
DROP POLICY IF EXISTS product_inventory_imports_storage_update ON storage.objects;
CREATE POLICY product_inventory_imports_storage_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'product-inventory-imports' AND auth.role() = 'service_role'
  )
  WITH CHECK (
    bucket_id = 'product-inventory-imports' AND auth.role() = 'service_role'
  );
DROP POLICY IF EXISTS product_inventory_imports_storage_delete ON storage.objects;
CREATE POLICY product_inventory_imports_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'product-inventory-imports' AND auth.role() = 'service_role'
  );

ALTER TABLE public.managed_files
  DROP CONSTRAINT IF EXISTS managed_files_owner_type_check;
ALTER TABLE public.managed_files
  ADD CONSTRAINT managed_files_owner_type_check CHECK (
    owner_type IN (
      'personnel_file', 'employee_contract', 'employee_document',
      'candidate_application_cv', 'candidate_application_attachment',
      'product_inventory_workbook'
    )
  );

ALTER TABLE public.product_receipt_sources
  ADD COLUMN IF NOT EXISTS managed_file_id uuid
    REFERENCES public.managed_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS total_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warning_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unmatched_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS committed_at timestamptz;

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_sha256_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_sha256_check
  CHECK (file_sha256 IS NULL OR length(file_sha256) = 64);

ALTER TABLE public.product_receipt_sources
  DROP CONSTRAINT IF EXISTS product_receipt_sources_row_counts_check;
ALTER TABLE public.product_receipt_sources
  ADD CONSTRAINT product_receipt_sources_row_counts_check CHECK (
    total_rows >= 0 AND valid_rows >= 0 AND warning_rows >= 0
    AND invalid_rows >= 0 AND duplicate_rows >= 0 AND unmatched_rows >= 0
    AND valid_rows + warning_rows + invalid_rows + duplicate_rows + unmatched_rows <= total_rows
  );

CREATE UNIQUE INDEX IF NOT EXISTS product_receipt_sources_managed_file_unique_idx
  ON public.product_receipt_sources (managed_file_id)
  WHERE managed_file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.product_inventory_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.product_receipt_sources(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number >= 2),
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_data) = 'object'),
  raw_product_name text,
  product_sku text,
  model text,
  product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  raw_serial text,
  normalized_serial text,
  barcode text,
  unit_cost numeric(14,2),
  planned_sale_price numeric(14,2),
  currency text,
  condition text,
  row_status text NOT NULL CHECK (
    row_status IN ('valid', 'warning', 'invalid', 'duplicate', 'unmatched')
  ),
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(validation_errors) = 'array'),
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(validation_warnings) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, row_number)
);

CREATE INDEX IF NOT EXISTS product_inventory_import_rows_receipt_status_idx
  ON public.product_inventory_import_rows
  (organization_id, receipt_id, row_status, row_number);
CREATE INDEX IF NOT EXISTS product_inventory_import_rows_serial_idx
  ON public.product_inventory_import_rows
  (organization_id, normalized_serial)
  WHERE normalized_serial IS NOT NULL;

ALTER TABLE public.product_inventory_import_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_import_rows_select
  ON public.product_inventory_import_rows;
CREATE POLICY product_inventory_import_rows_select
  ON public.product_inventory_import_rows
  FOR SELECT USING (
    organization_id = public.current_org_id()
    AND public.can_view_product_inventory()
  );

CREATE TABLE IF NOT EXISTS public.product_inventory_import_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('workbook_preview', 'workbook_commit')),
  receipt_id uuid,
  source_id uuid,
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

ALTER TABLE public.product_inventory_import_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_import_commands_service_only
  ON public.product_inventory_import_commands;
CREATE POLICY product_inventory_import_commands_service_only
  ON public.product_inventory_import_commands
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_product_inventory_import_rows_updated_at
  ON public.product_inventory_import_rows;
CREATE TRIGGER trg_product_inventory_import_rows_updated_at
  BEFORE UPDATE ON public.product_inventory_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.execute_product_workbook_preview(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_source_id uuid,
  p_managed_file_id uuid,
  p_header jsonb,
  p_file jsonb,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_import_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  source_row public.product_receipt_sources%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  actor_role_value text;
  supplier_id_value uuid;
  warehouse_id_value uuid;
  ownership_value text;
  source_type_value text;
  receipt_date_value date;
  currency_value text;
  row_count_value integer;
  valid_count_value integer;
  warning_count_value integer;
  invalid_count_value integer;
  duplicate_count_value integer;
  unmatched_count_value integer;
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
     OR p_command_id IS NULL OR p_receipt_id IS NULL OR p_source_id IS NULL
     OR p_managed_file_id IS NULL THEN
    RAISE EXCEPTION 'Workbook preview identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_header, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_file, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Workbook preview payload is invalid.'
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
    'source_id', p_source_id,
    'managed_file_id', p_managed_file_id,
    'header', p_header,
    'file', p_file,
    'rows', p_rows
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');

  INSERT INTO public.product_inventory_import_commands (
    organization_id, idempotency_key, action, receipt_id, source_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'workbook_preview', p_receipt_id, p_source_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_import_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'workbook_preview'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Workbook preview idempotency key was reused.'
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
  source_type_value := lower(btrim(COALESCE(p_file->>'source_type', '')));
  row_count_value := jsonb_array_length(p_rows);

  IF supplier_id_value IS NULL OR warehouse_id_value IS NULL
     OR ownership_value NOT IN ('purchased', 'consignment')
     OR currency_value !~ '^[A-Z]{3}$'
     OR source_type_value NOT IN ('excel', 'csv') THEN
    RAISE EXCEPTION 'Workbook receipt header is invalid.' USING ERRCODE = '23514';
  END IF;
  IF row_count_value < 1 OR row_count_value > 10000 THEN
    RAISE EXCEPTION 'Workbook must contain between 1 and 10000 data rows.'
      USING ERRCODE = '23514';
  END IF;
  IF p_file->>'bucket' <> 'product-inventory-imports'
     OR p_file->>'scan_status' <> 'clean'
     OR length(COALESCE(p_file->>'sha256', '')) <> 64
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) <= 0
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) > 10485760
     OR p_file->>'path' NOT LIKE
       p_org_id::text || '/' || p_receipt_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Workbook evidence must be clean and tenant scoped.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_inventory_import_rows
    WHERE organization_id = p_org_id AND receipt_id = p_receipt_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_receipts
    WHERE organization_id = p_org_id AND id = p_receipt_id
  ) THEN
    RAISE EXCEPTION 'Workbook receipt already exists.' USING ERRCODE = '23505';
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
    FROM jsonb_array_elements(p_rows) item(value)
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
    RAISE EXCEPTION 'Workbook preview contains a product outside the selected supplier catalog.'
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

  SELECT
    count(*) FILTER (WHERE item.value->>'status' = 'valid'),
    count(*) FILTER (WHERE item.value->>'status' = 'warning'),
    count(*) FILTER (WHERE item.value->>'status' = 'invalid'),
    count(*) FILTER (WHERE item.value->>'status' = 'duplicate'),
    count(*) FILTER (WHERE item.value->>'status' = 'unmatched')
  INTO
    valid_count_value, warning_count_value, invalid_count_value,
    duplicate_count_value, unmatched_count_value
  FROM jsonb_array_elements(p_rows) item(value);

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
    ARRAY[source_type_value]::text[], 'needs_review',
    CASE WHEN ownership_value = 'consignment' THEN 'not_required' ELSE 'pending' END,
    p_actor_user_id
  )
  RETURNING * INTO receipt_row;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, owner_type, owner_id,
    original_name, detected_mime, size_bytes, sha256,
    scan_status, scan_engine, scanned_at, retention_until, uploaded_by
  )
  VALUES (
    p_managed_file_id, p_org_id, p_file->>'bucket', p_file->>'path',
    'product_inventory_workbook', p_source_id,
    p_file->>'filename', p_file->>'type', (p_file->>'size_bytes')::bigint,
    p_file->>'sha256', p_file->>'scan_status', p_file->>'scan_engine',
    (p_file->>'scanned_at')::timestamptz, CURRENT_DATE + 365, p_actor_user_id
  );

  INSERT INTO public.product_receipt_sources (
    id, organization_id, receipt_id, source_type, storage_path,
    original_name, mime_type, size_bytes, extraction_provider,
    extraction_version, extraction_status, raw_extraction, confidence,
    uploaded_by, managed_file_id, file_sha256, total_rows,
    valid_rows, warning_rows, invalid_rows, duplicate_rows, unmatched_rows
  )
  VALUES (
    p_source_id, p_org_id, p_receipt_id, source_type_value,
    p_file->>'path', p_file->>'filename', p_file->>'type',
    (p_file->>'size_bytes')::bigint, 'product_inventory_workbook_parser',
    'v1', 'completed',
    jsonb_build_object(
      'headers', COALESCE(p_file->'headers', '[]'::jsonb),
      'contract_version', 'product-inventory-workbook-v1',
      'sha256', p_file->>'sha256'
    ),
    CASE
      WHEN row_count_value = 0 THEN 0
      ELSE round((valid_count_value + warning_count_value)::numeric / row_count_value, 4)
    END,
    p_actor_user_id, p_managed_file_id, p_file->>'sha256', row_count_value,
    valid_count_value, warning_count_value, invalid_count_value,
    duplicate_count_value, unmatched_count_value
  )
  RETURNING * INTO source_row;

  INSERT INTO public.product_inventory_import_rows (
    organization_id, receipt_id, source_id, row_number, raw_data,
    raw_product_name, product_sku, model, product_id, raw_serial,
    normalized_serial, barcode, unit_cost, planned_sale_price,
    currency, condition, row_status, confidence,
    validation_errors, validation_warnings
  )
  SELECT
    p_org_id, p_receipt_id, p_source_id,
    (item.value->>'row_number')::integer,
    COALESCE(item.value->'raw_data', '{}'::jsonb),
    NULLIF(item.value->>'product_name', ''),
    NULLIF(item.value->>'product_sku', ''),
    NULLIF(item.value->>'model', ''),
    NULLIF(item.value->>'product_id', '')::uuid,
    NULLIF(item.value->>'serial_number', ''),
    NULLIF(item.value->>'normalized_serial', ''),
    NULLIF(item.value->>'barcode', ''),
    NULLIF(item.value->>'unit_cost', '')::numeric,
    NULLIF(item.value->>'planned_sale_price', '')::numeric,
    NULLIF(item.value->>'currency', ''),
    NULLIF(item.value->>'condition', ''),
    item.value->>'status',
    NULLIF(item.value->>'confidence', '')::numeric,
    COALESCE(item.value->'validation_errors', '[]'::jsonb),
    COALESCE(item.value->'validation_warnings', '[]'::jsonb)
  FROM jsonb_array_elements(p_rows) item(value);

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.workbook_previewed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'source_id', source_row.id,
    'source_type', source_row.source_type,
    'total_rows', source_row.total_rows,
    'valid_rows', source_row.valid_rows,
    'warning_rows', source_row.warning_rows,
    'invalid_rows', source_row.invalid_rows,
    'duplicate_rows', source_row.duplicate_rows,
    'unmatched_rows', source_row.unmatched_rows,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_import',
    source_row.id::text || ':preview', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.workbook_previewed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'source', to_jsonb(source_row)
  );
  UPDATE public.product_inventory_import_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_product_workbook_commit(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_source_id uuid,
  p_expected_version integer,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_import_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  source_row public.product_receipt_sources%ROWTYPE;
  actor_role_value text;
  payload_value jsonb;
  hash_value text;
  groups_value jsonb;
  receipt_result jsonb;
  row_count_value integer;
  valid_count_value integer;
  warning_count_value integer;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'Workbook commit identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Workbook commit rows must be an array.'
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
    'source_id', p_source_id,
    'expected_version', p_expected_version,
    'rows', p_rows
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_import_commands (
    organization_id, idempotency_key, action, receipt_id, source_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'workbook_commit', p_receipt_id, p_source_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_import_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'workbook_commit'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Workbook commit idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO receipt_row
  FROM public.product_receipts receipt
  WHERE receipt.organization_id = p_org_id AND receipt.id = p_receipt_id
  FOR UPDATE;
  SELECT * INTO source_row
  FROM public.product_receipt_sources source
  WHERE source.organization_id = p_org_id
    AND source.receipt_id = p_receipt_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF receipt_row.id IS NULL OR source_row.id IS NULL THEN
    RAISE EXCEPTION 'Workbook receipt or source was not found.'
      USING ERRCODE = 'P0002';
  END IF;
  IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm')
     OR source_row.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an uncommitted workbook preview can be committed.'
      USING ERRCODE = '55000';
  END IF;
  IF receipt_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
  END IF;
  IF receipt_row.created_by <> p_actor_user_id
     AND actor_role_value = 'inventory_receiver' THEN
    RAISE EXCEPTION 'Receivers can commit only their own workbook previews.'
      USING ERRCODE = '42501';
  END IF;

  row_count_value := jsonb_array_length(p_rows);
  IF row_count_value <> source_row.total_rows
     OR row_count_value < 1 OR row_count_value > 10000 THEN
    RAISE EXCEPTION 'Every workbook row must be included before commit.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    WHERE item.value->>'status' NOT IN ('valid', 'warning')
      OR jsonb_typeof(COALESCE(item.value->'validation_errors', '[]'::jsonb)) <> 'array'
      OR jsonb_array_length(COALESCE(item.value->'validation_errors', '[]'::jsonb)) > 0
      OR NULLIF(item.value->>'product_id', '') IS NULL
      OR NULLIF(item.value->>'serial_number', '') IS NULL
      OR COALESCE(NULLIF(item.value->>'unit_cost', '')::numeric, 0) <= 0
      OR COALESCE(NULLIF(item.value->>'planned_sale_price', '')::numeric, 0) <= 0
      OR COALESCE(item.value->>'currency', '') !~ '^[A-Z]{3}$'
      OR COALESCE(item.value->>'condition', '') NOT IN ('new', 'open_box', 'refurbished')
  ) THEN
    RAISE EXCEPTION 'All workbook rows must be valid, matched, uniquely serialized, and priced.'
      USING ERRCODE = '23514';
  END IF;
  SELECT
    count(*) FILTER (WHERE item.value->>'status' = 'valid'),
    count(*) FILTER (WHERE item.value->>'status' = 'warning')
  INTO valid_count_value, warning_count_value
  FROM jsonb_array_elements(p_rows) item(value);
  IF (
    SELECT count(DISTINCT (item.value->>'row_number')::integer)
    FROM jsonb_array_elements(p_rows) item(value)
  ) <> row_count_value OR EXISTS (
    SELECT 1
    FROM public.product_inventory_import_rows stored
    WHERE stored.organization_id = p_org_id
      AND stored.source_id = p_source_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) item(value)
        WHERE (item.value->>'row_number')::integer = stored.row_number
      )
  ) THEN
    RAISE EXCEPTION 'Workbook row numbers do not match the stored preview.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = receipt_row.supplier_company_id
     AND product.id = (item.value->>'product_id')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every workbook product must be active, serialized, and supplied by the selected company.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT public.normalize_product_serial(item.value->>'serial_number'))
    FROM jsonb_array_elements(p_rows) item(value)
  ) <> row_count_value THEN
    RAISE EXCEPTION 'Workbook serial numbers must be unique.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    JOIN public.product_inventory_units unit
      ON unit.organization_id = p_org_id
     AND unit.normalized_serial_number =
       public.normalize_product_serial(item.value->>'serial_number')
  ) THEN
    RAISE EXCEPTION 'One or more workbook serial numbers already exist in confirmed stock.'
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
    ORDER BY grouped.first_row
  )
  INTO groups_value
  FROM (
    SELECT
      (item.value->>'product_id')::uuid AS product_id,
      (item.value->>'unit_cost')::numeric AS unit_cost,
      (item.value->>'planned_sale_price')::numeric AS planned_sale_price,
      item.value->>'currency' AS currency,
      item.value->>'condition' AS condition,
      min((item.value->>'row_number')::integer) AS first_row,
      jsonb_agg(
        item.value->>'serial_number'
        ORDER BY (item.value->>'row_number')::integer
      ) AS serial_numbers
    FROM jsonb_array_elements(p_rows) item(value)
    GROUP BY
      (item.value->>'product_id')::uuid,
      (item.value->>'unit_cost')::numeric,
      (item.value->>'planned_sale_price')::numeric,
      item.value->>'currency',
      item.value->>'condition'
  ) grouped;

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

  UPDATE public.product_inventory_import_rows stored
  SET raw_product_name = NULLIF(item.value->>'product_name', ''),
      product_sku = NULLIF(item.value->>'product_sku', ''),
      model = NULLIF(item.value->>'model', ''),
      product_id = (item.value->>'product_id')::uuid,
      raw_serial = item.value->>'serial_number',
      normalized_serial = public.normalize_product_serial(item.value->>'serial_number'),
      barcode = NULLIF(item.value->>'barcode', ''),
      unit_cost = (item.value->>'unit_cost')::numeric,
      planned_sale_price = (item.value->>'planned_sale_price')::numeric,
      currency = item.value->>'currency',
      condition = item.value->>'condition',
      row_status = item.value->>'status',
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 1),
      validation_errors = '[]'::jsonb,
      validation_warnings = COALESCE(item.value->'validation_warnings', '[]'::jsonb),
      updated_at = now()
  FROM jsonb_array_elements(p_rows) item(value)
  WHERE stored.organization_id = p_org_id
    AND stored.source_id = p_source_id
    AND stored.row_number = (item.value->>'row_number')::integer;

  UPDATE public.product_receipt_candidates candidate
  SET source_id = p_source_id,
      source_reference = 'row:' || (item.value->>'row_number'),
      raw_product_name = NULLIF(item.value->>'product_name', ''),
      barcode = NULLIF(item.value->>'barcode', ''),
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 1),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  FROM jsonb_array_elements(p_rows) item(value)
  WHERE candidate.organization_id = p_org_id
    AND candidate.receipt_id = p_receipt_id
    AND candidate.normalized_serial =
      public.normalize_product_serial(item.value->>'serial_number');

  UPDATE public.product_receipt_sources
  SET valid_rows = valid_count_value,
      warning_rows = warning_count_value,
      invalid_rows = 0,
      duplicate_rows = 0,
      unmatched_rows = 0,
      committed_at = now(),
      updated_at = now()
  WHERE organization_id = p_org_id AND id = p_source_id
  RETURNING * INTO source_row;

  UPDATE public.product_receipts
  SET source_methods = ARRAY[source_row.source_type]::text[],
      updated_at = now()
  WHERE organization_id = p_org_id AND id = p_receipt_id
  RETURNING * INTO receipt_row;

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.workbook_committed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'source_id', source_row.id,
    'source_type', source_row.source_type,
    'total_rows', row_count_value,
    'group_count', jsonb_array_length(groups_value),
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
    p_org_id, 'product_inventory_import',
    source_row.id::text || ':commit', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.workbook_committed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'source', to_jsonb(source_row),
    'group_count', jsonb_array_length(groups_value)
  );
  UPDATE public.product_inventory_import_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_workbook_preview(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_workbook_preview(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_workbook_commit(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_workbook_commit(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_import_rows IS
  'Every original Excel/CSV data row, its match, corrections, warnings, and validation evidence.';
