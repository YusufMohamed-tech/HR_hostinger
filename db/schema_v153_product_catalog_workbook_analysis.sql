-- Product catalog workbook analysis: private source files, immutable automatic
-- recognition evidence, paginated row previews, and bounded expiry.

ALTER TABLE public.managed_files DROP CONSTRAINT IF EXISTS managed_files_owner_type_check;
ALTER TABLE public.managed_files ADD CONSTRAINT managed_files_owner_type_check CHECK (
  owner_type IN (
    'personnel_file', 'employee_contract', 'employee_document',
    'candidate_application_cv', 'candidate_application_attachment',
    'product_inventory_workbook', 'product_inventory_photo',
    'product_return_evidence', 'product_inventory_import_profile_sample',
    'product_catalog_import_workbook'
  )
);

CREATE TABLE IF NOT EXISTS public.product_catalog_import_analyses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  command_id uuid NOT NULL,
  managed_file_id uuid NOT NULL UNIQUE REFERENCES public.managed_files(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'ready', 'needs_review', 'committing', 'committed', 'failed', 'expired'
  )),
  source_type text NOT NULL CHECK (source_type IN ('excel', 'csv')),
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 200),
  file_sha256 text NOT NULL CHECK (length(file_sha256) = 64),
  selected_sheet text NOT NULL,
  header_row integer NOT NULL CHECK (header_row BETWEEN 1 AND 100),
  mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  confidence numeric(6,5) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  blocking_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocking_errors) = 'array'),
  algorithm_version text NOT NULL,
  analysis_version integer NOT NULL DEFAULT 1 CHECK (analysis_version >= 1),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, command_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.product_catalog_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_sheet text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  raw_values jsonb NOT NULL CHECK (jsonb_typeof(raw_values) = 'object'),
  normalized_values jsonb NOT NULL CHECK (jsonb_typeof(normalized_values) = 'object'),
  classification text NOT NULL CHECK (classification IN (
    'new', 'existing_unchanged', 'existing_update', 'ambiguous',
    'identifier_conflict', 'duplicate_in_file', 'invalid'
  )),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors) = 'array'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  matched_product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  matched_inventory_version integer,
  suggested_changes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(suggested_changes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (analysis_id, organization_id)
    REFERENCES public.product_catalog_import_analyses(id, organization_id)
    ON DELETE CASCADE,
  UNIQUE (analysis_id, source_sheet, source_row)
);

CREATE INDEX IF NOT EXISTS product_catalog_import_analyses_history_idx
  ON public.product_catalog_import_analyses (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_catalog_import_analyses_expiry_idx
  ON public.product_catalog_import_analyses (expires_at)
  WHERE status IN ('ready', 'needs_review');
CREATE INDEX IF NOT EXISTS product_catalog_import_rows_page_idx
  ON public.product_catalog_import_rows (analysis_id, source_row, id);
CREATE INDEX IF NOT EXISTS product_catalog_import_rows_classification_idx
  ON public.product_catalog_import_rows (analysis_id, classification, source_row);

ALTER TABLE public.product_catalog_import_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_catalog_import_analyses_service_only
  ON public.product_catalog_import_analyses;
CREATE POLICY product_catalog_import_analyses_service_only
  ON public.product_catalog_import_analyses
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS product_catalog_import_rows_service_only
  ON public.product_catalog_import_rows;
CREATE POLICY product_catalog_import_rows_service_only
  ON public.product_catalog_import_rows
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_product_catalog_import_analyses_updated_at
  ON public.product_catalog_import_analyses;
CREATE TRIGGER trg_product_catalog_import_analyses_updated_at
  BEFORE UPDATE ON public.product_catalog_import_analyses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.save_product_catalog_import_analysis(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_analysis_id uuid,
  p_managed_file_id uuid,
  p_company_id uuid,
  p_file jsonb,
  p_recognition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  analysis_row public.product_catalog_import_analyses%ROWTYPE;
  payload_value jsonb;
  hash_value text;
  row_value jsonb;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_analysis_id IS NULL OR p_managed_file_id IS NULL
     OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'Catalog analysis identifiers are required.' USING ERRCODE = '22023';
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
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = p_company_id AND company.is_active = true
  ) THEN
    RAISE EXCEPTION 'Supplier company was not found or is inactive.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(COALESCE(p_file, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_recognition, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_recognition->'rows', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_recognition->'rows', '[]'::jsonb)) > 10000 THEN
    RAISE EXCEPTION 'Catalog recognition payload is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_recognition->>'status' NOT IN ('ready', 'needs_review')
     OR p_file->>'source_type' NOT IN ('excel', 'csv')
     OR p_file->>'bucket' <> 'product-inventory-imports'
     OR p_file->>'scan_status' <> 'clean'
     OR length(COALESCE(p_file->>'sha256', '')) <> 64
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) NOT BETWEEN 1 AND 10485760
     OR p_file->>'path' NOT LIKE
       p_org_id::text || '/product-catalog/' || p_analysis_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Catalog workbook must be clean and tenant scoped.' USING ERRCODE = '23514';
  END IF;
  payload_value := jsonb_build_object(
    'analysis_id', p_analysis_id,
    'managed_file_id', p_managed_file_id,
    'company_id', p_company_id,
    'file', p_file,
    'recognition', p_recognition
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');

  SELECT * INTO analysis_row
  FROM public.product_catalog_import_analyses analysis
  WHERE analysis.organization_id = p_org_id AND analysis.command_id = p_command_id
  FOR UPDATE;
  IF analysis_row.id IS NOT NULL THEN
    IF analysis_row.payload_hash <> hash_value
       OR analysis_row.created_by <> p_actor_user_id
       OR analysis_row.id <> p_analysis_id THEN
      RAISE EXCEPTION 'Catalog analysis idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'analysis_id', analysis_row.id,
      'status', analysis_row.status,
      'summary', analysis_row.summary
    );
  END IF;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, owner_type, owner_id,
    original_name, detected_mime, size_bytes, sha256,
    scan_status, scan_engine, scanned_at, retention_until, uploaded_by
  ) VALUES (
    p_managed_file_id, p_org_id, p_file->>'bucket', p_file->>'path',
    'product_catalog_import_workbook', p_analysis_id,
    p_file->>'filename', p_file->>'type', (p_file->>'size_bytes')::bigint,
    p_file->>'sha256', p_file->>'scan_status', p_file->>'scan_engine',
    (p_file->>'scanned_at')::timestamptz, CURRENT_DATE + 30, p_actor_user_id
  );

  INSERT INTO public.product_catalog_import_analyses (
    id, organization_id, company_id, created_by, request_id, command_id,
    managed_file_id, status, source_type, original_filename, file_sha256,
    selected_sheet, header_row, mapping, confidence, summary, warnings,
    blocking_errors, algorithm_version, payload_hash
  ) VALUES (
    p_analysis_id, p_org_id, p_company_id, p_actor_user_id, p_request_id, p_command_id,
    p_managed_file_id, p_recognition->>'status', p_file->>'source_type',
    p_file->>'filename', p_file->>'sha256', p_recognition->>'sheet_name',
    (p_recognition->>'header_row')::integer,
    COALESCE(p_recognition->'header_mapping', '{}'::jsonb),
    (p_recognition->>'confidence')::numeric,
    COALESCE(p_recognition->'summary', '{}'::jsonb),
    COALESCE(p_recognition->'warnings', '[]'::jsonb),
    COALESCE(p_recognition->'blocking_errors', '[]'::jsonb),
    p_recognition->>'algorithm_version', hash_value
  ) RETURNING * INTO analysis_row;

  FOR row_value IN SELECT value FROM jsonb_array_elements(p_recognition->'rows') LOOP
    INSERT INTO public.product_catalog_import_rows (
      analysis_id, organization_id, source_sheet, source_row, raw_values,
      normalized_values, classification, errors, warnings, matched_product_id,
      matched_inventory_version, suggested_changes
    ) VALUES (
      p_analysis_id, p_org_id, row_value->>'source_sheet',
      (row_value->>'source_row')::integer,
      COALESCE(row_value->'raw_values', '{}'::jsonb),
      COALESCE(row_value->'normalized_values', '{}'::jsonb),
      row_value->>'classification',
      COALESCE(row_value->'errors', '[]'::jsonb),
      COALESCE(row_value->'warnings', '[]'::jsonb),
      NULLIF(row_value->>'matched_product_id', '')::uuid,
      NULLIF(row_value->>'matched_inventory_version', '')::integer,
      COALESCE(row_value->'suggested_changes', '{}'::jsonb)
    );
  END LOOP;

  result_value := jsonb_build_object(
    'analysis_id', analysis_row.id,
    'status', analysis_row.status,
    'summary', analysis_row.summary
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'product_catalog.analysis_created', 'product_catalog_import', p_analysis_id::text,
    'success', 201, jsonb_build_object(
      'company_id', p_company_id,
      'status', analysis_row.status,
      'summary', analysis_row.summary,
      'file_sha256', analysis_row.file_sha256
    )
  );
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.save_product_catalog_import_analysis(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product_catalog_import_analysis(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_product_catalog_import_analyses(
  p_batch_size integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Expiry batch size must be between 1 and 1000.' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS (
    SELECT analysis.id
    FROM public.product_catalog_import_analyses analysis
    WHERE analysis.status IN ('ready', 'needs_review') AND analysis.expires_at <= now()
    ORDER BY analysis.expires_at, analysis.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ), expired AS (
    UPDATE public.product_catalog_import_analyses analysis
    SET status = 'expired', updated_at = now()
    FROM candidates WHERE analysis.id = candidates.id
    RETURNING analysis.id
  )
  SELECT count(*) INTO expired_count FROM expired;
  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_product_catalog_import_analyses(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_product_catalog_import_analyses(integer)
  TO service_role;

COMMENT ON TABLE public.product_catalog_import_analyses IS
  'Private immutable metadata for automatically recognized Finance product catalog workbooks.';
COMMENT ON TABLE public.product_catalog_import_rows IS
  'Paginated row evidence and deterministic product matching results for a catalog analysis.';
