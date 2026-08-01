-- Automatic Excel recognition foundation: private sample analyses, immutable
-- recognition evidence, generated profile metadata, and atomic analysis save.

ALTER TABLE public.managed_files DROP CONSTRAINT IF EXISTS managed_files_owner_type_check;
ALTER TABLE public.managed_files ADD CONSTRAINT managed_files_owner_type_check CHECK (
  owner_type IN (
    'personnel_file', 'employee_contract', 'employee_document',
    'candidate_application_cv', 'candidate_application_attachment',
    'product_inventory_workbook', 'product_inventory_photo',
    'product_return_evidence', 'product_inventory_import_profile_sample'
  )
);

CREATE TABLE IF NOT EXISTS public.product_inventory_import_analyses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  supplier_company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  managed_file_id uuid NOT NULL UNIQUE REFERENCES public.managed_files(id) ON DELETE RESTRICT,
  template_name text NOT NULL CHECK (length(btrim(template_name)) BETWEEN 2 AND 160),
  source_type text NOT NULL CHECK (source_type IN ('excel', 'csv')),
  original_name text NOT NULL CHECK (length(btrim(original_name)) BETWEEN 1 AND 200),
  file_sha256 text NOT NULL CHECK (length(file_sha256) = 64),
  status text NOT NULL CHECK (status IN (
    'analyzing', 'needs_review', 'ready', 'confirmed', 'failed', 'expired'
  )),
  algorithm_version text NOT NULL CHECK (length(btrim(algorithm_version)) BETWEEN 3 AND 100),
  detected_sheet_name text,
  detected_header_row integer CHECK (detected_header_row IS NULL OR detected_header_row BETWEEN 1 AND 100),
  workbook_shape text CHECK (workbook_shape IS NULL OR workbook_shape IN (
    'row_per_device', 'continuation_rows', 'serial_columns'
  )),
  layout_fingerprint text CHECK (layout_fingerprint IS NULL OR length(layout_fingerprint) = 64),
  confidence numeric(6,5) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  detected_mapping jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detected_mapping) = 'object'),
  field_proposals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(field_proposals) = 'array'),
  detected_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detected_metadata) = 'object'),
  sheet_scores jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sheet_scores) = 'array'),
  sample_rows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sample_rows) = 'array'),
  blocking_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocking_errors) = 'array'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  error_message text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, command_id),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS product_inventory_import_analyses_status_idx
  ON public.product_inventory_import_analyses (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS product_inventory_import_analyses_fingerprint_idx
  ON public.product_inventory_import_analyses (organization_id, layout_fingerprint, created_at DESC)
  WHERE layout_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_inventory_import_analyses_expiry_idx
  ON public.product_inventory_import_analyses (expires_at)
  WHERE status IN ('analyzing', 'needs_review', 'ready');

ALTER TABLE public.product_inventory_import_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_import_analyses_service_only
  ON public.product_inventory_import_analyses;
CREATE POLICY product_inventory_import_analyses_service_only
  ON public.product_inventory_import_analyses
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_product_inventory_import_analyses_updated_at
  ON public.product_inventory_import_analyses;
CREATE TRIGGER trg_product_inventory_import_analyses_updated_at
  BEFORE UPDATE ON public.product_inventory_import_analyses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.product_inventory_import_profiles
  ADD COLUMN IF NOT EXISTS recognition_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS layout_fingerprint text,
  ADD COLUMN IF NOT EXISTS source_analysis_id uuid,
  ADD COLUMN IF NOT EXISTS mapping_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workbook_shape text,
  ADD COLUMN IF NOT EXISTS recognition_version text;

ALTER TABLE public.product_inventory_import_profiles
  DROP CONSTRAINT IF EXISTS product_inventory_import_profiles_recognition_mode_check,
  DROP CONSTRAINT IF EXISTS product_inventory_import_profiles_layout_fingerprint_check,
  DROP CONSTRAINT IF EXISTS product_inventory_import_profiles_mapping_confidence_check,
  DROP CONSTRAINT IF EXISTS product_inventory_import_profiles_workbook_shape_check,
  DROP CONSTRAINT IF EXISTS product_inventory_import_profiles_source_analysis_fk;
ALTER TABLE public.product_inventory_import_profiles
  ADD CONSTRAINT product_inventory_import_profiles_recognition_mode_check
    CHECK (recognition_mode IN ('manual', 'automatic', 'reviewed')),
  ADD CONSTRAINT product_inventory_import_profiles_layout_fingerprint_check
    CHECK (layout_fingerprint IS NULL OR length(layout_fingerprint) = 64),
  ADD CONSTRAINT product_inventory_import_profiles_mapping_confidence_check
    CHECK (jsonb_typeof(mapping_confidence) = 'object'),
  ADD CONSTRAINT product_inventory_import_profiles_workbook_shape_check
    CHECK (workbook_shape IS NULL OR workbook_shape IN (
      'row_per_device', 'continuation_rows', 'serial_columns'
    )),
  ADD CONSTRAINT product_inventory_import_profiles_source_analysis_fk
    FOREIGN KEY (source_analysis_id, organization_id)
    REFERENCES public.product_inventory_import_analyses(id, organization_id)
    ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_inventory_import_profiles
  VALIDATE CONSTRAINT product_inventory_import_profiles_source_analysis_fk;

CREATE INDEX IF NOT EXISTS product_inventory_import_profiles_fingerprint_idx
  ON public.product_inventory_import_profiles (organization_id, layout_fingerprint, version DESC)
  WHERE layout_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_product_inventory_import_analysis(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_analysis_id uuid,
  p_managed_file_id uuid,
  p_supplier_company_id uuid,
  p_template_name text,
  p_file jsonb,
  p_recognition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  analysis_row public.product_inventory_import_analyses%ROWTYPE;
  actor_role_value text;
  payload_value jsonb;
  hash_value text;
  status_value text;
  source_type_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_analysis_id IS NULL OR p_managed_file_id IS NULL THEN
    RAISE EXCEPTION 'Workbook analysis identifiers are required.' USING ERRCODE = '22023';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
  LIMIT 1;
  IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager permission is required.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_file, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_recognition, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Workbook analysis payload is invalid.' USING ERRCODE = '22023';
  END IF;
  status_value := p_recognition->>'status';
  source_type_value := p_file->>'source_type';
  IF status_value NOT IN ('ready', 'needs_review')
     OR source_type_value NOT IN ('excel', 'csv')
     OR length(btrim(COALESCE(p_template_name, ''))) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Workbook recognition result is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_file->>'bucket' <> 'product-inventory-imports'
     OR p_file->>'scan_status' <> 'clean'
     OR length(COALESCE(p_file->>'sha256', '')) <> 64
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) <= 0
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) > 10485760
     OR p_file->>'path' NOT LIKE
       p_org_id::text || '/profile-analysis/' || p_analysis_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Workbook sample must be clean and tenant scoped.' USING ERRCODE = '23514';
  END IF;
  IF p_supplier_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = p_supplier_company_id AND company.is_active = true
  ) THEN
    RAISE EXCEPTION 'Supplier company was not found or is inactive.' USING ERRCODE = 'P0002';
  END IF;
  payload_value := jsonb_build_object(
    'analysis_id', p_analysis_id,
    'managed_file_id', p_managed_file_id,
    'supplier_company_id', p_supplier_company_id,
    'template_name', btrim(p_template_name),
    'file', p_file,
    'recognition', p_recognition
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');

  SELECT * INTO analysis_row
  FROM public.product_inventory_import_analyses analysis
  WHERE analysis.organization_id = p_org_id AND analysis.command_id = p_command_id
  FOR UPDATE;
  IF analysis_row.id IS NOT NULL THEN
    IF analysis_row.payload_hash <> hash_value
       OR analysis_row.actor_user_id <> p_actor_user_id
       OR analysis_row.id <> p_analysis_id THEN
      RAISE EXCEPTION 'Workbook analysis idempotency key was reused.' USING ERRCODE = '23505';
    END IF;
    RETURN analysis_row.result;
  END IF;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, owner_type, owner_id,
    original_name, detected_mime, size_bytes, sha256,
    scan_status, scan_engine, scanned_at, retention_until, uploaded_by
  ) VALUES (
    p_managed_file_id, p_org_id, p_file->>'bucket', p_file->>'path',
    'product_inventory_import_profile_sample', p_analysis_id,
    p_file->>'filename', p_file->>'type', (p_file->>'size_bytes')::bigint,
    p_file->>'sha256', p_file->>'scan_status', p_file->>'scan_engine',
    (p_file->>'scanned_at')::timestamptz, CURRENT_DATE + 30, p_actor_user_id
  );

  INSERT INTO public.product_inventory_import_analyses (
    id, organization_id, command_id, request_id, actor_user_id,
    supplier_company_id, managed_file_id, template_name, source_type,
    original_name, file_sha256, status, algorithm_version,
    detected_sheet_name, detected_header_row, workbook_shape,
    layout_fingerprint, confidence, detected_mapping, field_proposals,
    detected_metadata, sheet_scores, sample_rows, blocking_errors,
    warnings, result, payload_hash
  ) VALUES (
    p_analysis_id, p_org_id, p_command_id, p_request_id, p_actor_user_id,
    p_supplier_company_id, p_managed_file_id, btrim(p_template_name), source_type_value,
    p_file->>'filename', p_file->>'sha256', status_value,
    p_recognition->>'algorithm_version', p_recognition->>'sheet_name',
    (p_recognition->>'header_row')::integer, p_recognition->>'shape',
    p_recognition->>'layout_fingerprint', (p_recognition->>'confidence')::numeric,
    COALESCE(p_recognition->'header_mapping', '{}'::jsonb),
    COALESCE(p_recognition->'field_proposals', '[]'::jsonb),
    COALESCE(p_recognition->'metadata', '{}'::jsonb),
    COALESCE(p_recognition->'sheet_scores', '[]'::jsonb),
    COALESCE(p_recognition->'sample_rows', '[]'::jsonb),
    COALESCE(p_recognition->'blocking_errors', '[]'::jsonb),
    COALESCE(p_recognition->'warnings', '[]'::jsonb),
    jsonb_build_object(
      'analysis_id', p_analysis_id,
      'status', status_value,
      'recognition', p_recognition
    ),
    hash_value
  ) RETURNING * INTO analysis_row;
  RETURN analysis_row.result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_product_inventory_import_analysis(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_product_inventory_import_analysis(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_import_analyses IS
  'Private, tenant-scoped and reproducible Excel/CSV layout recognition evidence.';
COMMENT ON COLUMN public.product_inventory_import_profiles.header_mapping IS
  'Internal immutable mapping generated by automatic recognition or a reviewed correction; never a required user-entered JSON field.';
COMMENT ON FUNCTION public.save_product_inventory_import_analysis(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb
) IS 'Atomically persists a clean sample file and deterministic workbook-recognition result.';
