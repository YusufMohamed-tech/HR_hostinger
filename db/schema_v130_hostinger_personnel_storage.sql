-- Store employee/personnel binaries in Hostinger-backed private object storage
-- while retaining authoritative tenant, ownership, security, and retention
-- metadata in Postgres.

ALTER TABLE public.managed_files
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase_storage',
  ADD COLUMN IF NOT EXISTS storage_container text,
  ADD COLUMN IF NOT EXISTS storage_version text,
  ADD COLUMN IF NOT EXISTS storage_etag text,
  ADD COLUMN IF NOT EXISTS encryption_status text NOT NULL DEFAULT 'provider_managed',
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'confidential_hr',
  ADD COLUMN IF NOT EXISTS migrated_at timestamptz;

UPDATE public.managed_files
SET
  storage_provider = COALESCE(NULLIF(storage_provider, ''), 'supabase_storage'),
  storage_container = COALESCE(NULLIF(storage_container, ''), bucket_id),
  encryption_status = COALESCE(NULLIF(encryption_status, ''), 'provider_managed'),
  classification = COALESCE(NULLIF(classification, ''), 'confidential_hr')
WHERE storage_container IS NULL
   OR storage_provider = ''
   OR encryption_status = ''
   OR classification = '';

ALTER TABLE public.managed_files
  DROP CONSTRAINT IF EXISTS managed_files_storage_provider_check,
  ADD CONSTRAINT managed_files_storage_provider_check CHECK (
    storage_provider IN ('supabase_storage', 'hostinger_s3')
  ),
  DROP CONSTRAINT IF EXISTS managed_files_encryption_status_check,
  ADD CONSTRAINT managed_files_encryption_status_check CHECK (
    encryption_status IN ('provider_managed', 'sse_s3', 'sse_kms', 'client_encrypted')
  ),
  DROP CONSTRAINT IF EXISTS managed_files_classification_check,
  ADD CONSTRAINT managed_files_classification_check CHECK (
    classification IN ('internal', 'confidential_hr', 'restricted_identity', 'restricted_financial')
  );

CREATE INDEX IF NOT EXISTS managed_files_provider_container_idx
  ON public.managed_files(storage_provider, storage_container, storage_path)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.assert_clean_personnel_file(
  p_org_id uuid,
  p_employee_id uuid,
  p_command_id uuid,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  provider_value text := COALESCE(NULLIF(p_metadata->>'provider', ''), 'supabase_storage');
BEGIN
  IF jsonb_typeof(p_metadata) <> 'object'
     OR p_metadata->>'scan_status' <> 'clean'
     OR length(COALESCE(p_metadata->>'sha256', '')) <> 64
     OR COALESCE((p_metadata->>'size_bytes')::bigint, 0) <= 0
     OR COALESCE((p_metadata->>'size_bytes')::bigint, 0) > 15728640
     OR provider_value NOT IN ('supabase_storage', 'hostinger_s3')
     OR length(btrim(COALESCE(p_metadata->>'bucket', ''))) = 0
     OR p_metadata->>'path' NOT LIKE
       p_org_id::text || '/' || p_employee_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Personnel file must be clean, private, and tenant scoped.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_personnel_file(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_row_id uuid,
  p_employee_id uuid,
  p_category text,
  p_expiry_date date,
  p_notes text,
  p_file jsonb
)
RETURNS SETOF public.personnel_files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_value public.personnel_files%ROWTYPE;
  command_row public.file_commands%ROWTYPE;
  actor_role_value text;
  input_value jsonb;
  hash_value text;
  managed_id uuid := gen_random_uuid();
  provider_value text := COALESCE(NULLIF(p_file->>'provider', ''), 'supabase_storage');
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT role::text INTO actor_role_value
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.employees
       WHERE org_id = p_org_id
         AND id = p_employee_id
         AND user_id = p_actor_user_id
         AND lifecycle_status NOT IN ('offboarded', 'archived')
     ) THEN
    RAISE EXCEPTION 'Personnel file access is forbidden.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employees WHERE org_id = p_org_id AND id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.assert_clean_personnel_file(
    p_org_id, p_employee_id, p_command_id, p_file
  );
  input_value := jsonb_build_object(
    'row_id', p_row_id,
    'employee_id', p_employee_id,
    'category', COALESCE(NULLIF(btrim(p_category), ''), 'other'),
    'expiry_date', p_expiry_date,
    'notes', NULLIF(btrim(p_notes), ''),
    'file', p_file
  );
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');

  INSERT INTO public.file_commands (
    id, org_id, actor_user_id, action, target_id, input_hash, request_id
  )
  VALUES (
    p_command_id, p_org_id, p_actor_user_id, 'personnel_file',
    p_row_id, hash_value, p_request_id
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO command_row
  FROM public.file_commands
  WHERE id = p_command_id
  FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'personnel_file'
     OR command_row.target_id IS DISTINCT FROM p_row_id
     OR command_row.input_hash IS DISTINCT FROM hash_value THEN
    RAISE EXCEPTION 'File command id was reused with different input.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.personnel_files WHERE id = p_row_id;
    RETURN;
  END IF;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, storage_provider, storage_container,
    storage_version, storage_etag, encryption_status, classification,
    owner_type, owner_id, employee_id, original_name, detected_mime,
    size_bytes, sha256, scan_status, scan_engine, scanned_at,
    retention_until, uploaded_by
  )
  VALUES (
    managed_id,
    p_org_id,
    'personnel-files',
    p_file->>'path',
    provider_value,
    p_file->>'bucket',
    NULLIF(p_file->>'version', ''),
    NULLIF(p_file->>'etag', ''),
    COALESCE(NULLIF(p_file->>'encryption_status', ''), 'provider_managed'),
    CASE
      WHEN COALESCE(NULLIF(btrim(p_category), ''), 'other') = 'official'
        THEN 'restricted_identity'
      ELSE 'confidential_hr'
    END,
    'personnel_file',
    p_row_id,
    p_employee_id,
    p_file->>'filename',
    p_file->>'type',
    (p_file->>'size_bytes')::bigint,
    p_file->>'sha256',
    'clean',
    p_file->>'scan_engine',
    (p_file->>'scanned_at')::timestamptz,
    CURRENT_DATE + 2555,
    p_actor_user_id
  );

  INSERT INTO public.personnel_files (
    id, org_id, employee_id, category, file_name, file_path,
    file_size, expiry_date, notes, uploaded_by, managed_file_id,
    scan_status, sha256
  )
  VALUES (
    p_row_id,
    p_org_id,
    p_employee_id,
    COALESCE(NULLIF(btrim(p_category), ''), 'other'),
    p_file->>'filename',
    p_file->>'path',
    (p_file->>'size_bytes')::integer,
    p_expiry_date,
    NULLIF(btrim(p_notes), ''),
    p_actor_user_id,
    managed_id,
    'clean',
    p_file->>'sha256'
  )
  RETURNING * INTO row_value;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'personnel.file_registered', 'personnel_file', row_value.id::text,
    'success', 201, jsonb_build_object(
      'employee_id', p_employee_id,
      'sha256', p_file->>'sha256',
      'expiry_date', p_expiry_date,
      'storage_provider', provider_value
    )
  );

  UPDATE public.file_commands
  SET status = 'completed', completed_at = now(), result = to_jsonb(row_value)
  WHERE id = p_command_id;
  PERFORM public.refresh_employee_onboarding(p_employee_id);
  RETURN NEXT row_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_employee_contract(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_row_id uuid,
  p_employee_id uuid,
  p_contract_type text,
  p_start_date date,
  p_end_date date,
  p_probation_end_date date,
  p_salary numeric,
  p_file jsonb
)
RETURNS SETOF public.employee_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_value public.employee_contracts%ROWTYPE;
  command_row public.file_commands%ROWTYPE;
  actor_role_value text;
  input_value jsonb;
  hash_value text;
  managed_id uuid := gen_random_uuid();
  provider_value text := COALESCE(NULLIF(p_file->>'provider', ''), 'supabase_storage');
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT role::text INTO actor_role_value
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN
    RAISE EXCEPTION 'Contract access is forbidden.' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL
     OR (p_end_date IS NOT NULL AND p_end_date < p_start_date)
     OR (p_probation_end_date IS NOT NULL AND p_probation_end_date < p_start_date)
     OR COALESCE(p_salary, 0) < 0 THEN
    RAISE EXCEPTION 'Contract dates or salary are invalid.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employees WHERE org_id = p_org_id AND id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.assert_clean_personnel_file(
    p_org_id, p_employee_id, p_command_id, p_file
  );
  input_value := jsonb_build_object(
    'row_id', p_row_id,
    'employee_id', p_employee_id,
    'contract_type', COALESCE(NULLIF(btrim(p_contract_type), ''), 'permanent'),
    'start_date', p_start_date,
    'end_date', p_end_date,
    'probation_end_date', p_probation_end_date,
    'salary', p_salary,
    'file', p_file
  );
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');

  INSERT INTO public.file_commands (
    id, org_id, actor_user_id, action, target_id, input_hash, request_id
  )
  VALUES (
    p_command_id, p_org_id, p_actor_user_id, 'employee_contract',
    p_row_id, hash_value, p_request_id
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO command_row
  FROM public.file_commands
  WHERE id = p_command_id
  FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'employee_contract'
     OR command_row.target_id IS DISTINCT FROM p_row_id
     OR command_row.input_hash IS DISTINCT FROM hash_value THEN
    RAISE EXCEPTION 'File command id was reused with different input.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.employee_contracts WHERE id = p_row_id;
    RETURN;
  END IF;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, storage_provider, storage_container,
    storage_version, storage_etag, encryption_status, classification,
    owner_type, owner_id, employee_id, original_name, detected_mime,
    size_bytes, sha256, scan_status, scan_engine, scanned_at,
    retention_until, uploaded_by
  )
  VALUES (
    managed_id,
    p_org_id,
    'personnel-files',
    p_file->>'path',
    provider_value,
    p_file->>'bucket',
    NULLIF(p_file->>'version', ''),
    NULLIF(p_file->>'etag', ''),
    COALESCE(NULLIF(p_file->>'encryption_status', ''), 'provider_managed'),
    'confidential_hr',
    'employee_contract',
    p_row_id,
    p_employee_id,
    p_file->>'filename',
    p_file->>'type',
    (p_file->>'size_bytes')::bigint,
    p_file->>'sha256',
    'clean',
    p_file->>'scan_engine',
    (p_file->>'scanned_at')::timestamptz,
    GREATEST(COALESCE(p_end_date, CURRENT_DATE), CURRENT_DATE) + 2555,
    p_actor_user_id
  );

  INSERT INTO public.employee_contracts (
    id, org_id, employee_id, contract_type, start_date, end_date,
    probation_end_date, salary_at_signing, file_path, status,
    created_by, managed_file_id, version
  )
  VALUES (
    p_row_id,
    p_org_id,
    p_employee_id,
    COALESCE(NULLIF(btrim(p_contract_type), ''), 'permanent'),
    p_start_date,
    p_end_date,
    p_probation_end_date,
    p_salary,
    p_file->>'path',
    'active',
    p_actor_user_id,
    managed_id,
    1
  )
  RETURNING * INTO row_value;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'personnel.contract_registered', 'employee_contract', row_value.id::text,
    'success', 201, jsonb_build_object(
      'employee_id', p_employee_id,
      'sha256', p_file->>'sha256',
      'end_date', p_end_date,
      'storage_provider', provider_value
    )
  );

  UPDATE public.file_commands
  SET status = 'completed', completed_at = now(), result = to_jsonb(row_value)
  WHERE id = p_command_id;
  PERFORM public.refresh_employee_onboarding(p_employee_id);
  RETURN NEXT row_value;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_clean_personnel_file(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_personnel_file(
  uuid, uuid, uuid, uuid, uuid, uuid, text, date, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_employee_contract(
  uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, date, numeric, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_personnel_file(
  uuid, uuid, uuid, uuid, uuid, uuid, text, date, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_employee_contract(
  uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, date, numeric, jsonb
) TO service_role;

COMMENT ON COLUMN public.managed_files.storage_provider IS
  'Physical binary provider. Employee/personnel files use hostinger_s3 after cutover.';
COMMENT ON COLUMN public.managed_files.storage_container IS
  'Physical private bucket/container; bucket_id remains the logical application bucket.';
