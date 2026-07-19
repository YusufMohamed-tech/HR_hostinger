-- Register every personnel document with verified content metadata and an owning row.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('personnel-files', 'personnel-files', false, 15728640,
  ARRAY['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS personnel_files_storage_select ON storage.objects;
CREATE POLICY personnel_files_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'personnel-files' AND auth.role() = 'service_role');
DROP POLICY IF EXISTS personnel_files_storage_insert ON storage.objects;
CREATE POLICY personnel_files_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'personnel-files' AND auth.role() = 'service_role');
DROP POLICY IF EXISTS personnel_files_storage_update ON storage.objects;
CREATE POLICY personnel_files_storage_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'personnel-files' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'personnel-files' AND auth.role() = 'service_role');
DROP POLICY IF EXISTS personnel_files_storage_delete ON storage.objects;
CREATE POLICY personnel_files_storage_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'personnel-files' AND auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.managed_files (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bucket_id text NOT NULL,
  storage_path text NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('personnel_file', 'employee_contract', 'employee_document')),
  owner_id uuid NOT NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  original_name text NOT NULL,
  detected_mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  scan_status text NOT NULL CHECK (scan_status = 'clean'),
  scan_engine text NOT NULL,
  scanned_at timestamptz NOT NULL,
  retention_until date,
  legal_hold boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deletion_error text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, storage_path),
  UNIQUE (owner_type, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_managed_files_retention ON public.managed_files(retention_until, created_at)
  WHERE deleted_at IS NULL AND legal_hold = false;
ALTER TABLE public.managed_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY managed_files_service_only ON public.managed_files FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.personnel_files
  ADD COLUMN IF NOT EXISTS managed_file_id uuid REFERENCES public.managed_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scan_status text,
  ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE public.employee_contracts
  ADD COLUMN IF NOT EXISTS managed_file_id uuid REFERENCES public.managed_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.employee_documents
  ADD COLUMN IF NOT EXISTS managed_file_id uuid REFERENCES public.managed_files(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.file_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('personnel_file', 'employee_contract', 'employee_document')),
  target_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.file_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_commands_service_only ON public.file_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_trusted_personnel_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Personnel records require a trusted command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_trusted_personnel_file_write ON public.personnel_files;
CREATE TRIGGER trg_guard_trusted_personnel_file_write BEFORE INSERT OR UPDATE OR DELETE ON public.personnel_files
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_personnel_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_employee_contract_write ON public.employee_contracts;
CREATE TRIGGER trg_guard_trusted_employee_contract_write BEFORE INSERT OR UPDATE OR DELETE ON public.employee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_personnel_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_employee_document_write ON public.employee_documents;
CREATE TRIGGER trg_guard_trusted_employee_document_write BEFORE INSERT OR UPDATE OR DELETE ON public.employee_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_personnel_write();

CREATE OR REPLACE FUNCTION public.assert_clean_personnel_file(
  p_org_id uuid, p_employee_id uuid, p_command_id uuid, p_metadata jsonb
)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF jsonb_typeof(p_metadata) <> 'object' OR p_metadata->>'scan_status' <> 'clean'
     OR length(COALESCE(p_metadata->>'sha256', '')) <> 64
     OR COALESCE((p_metadata->>'size_bytes')::bigint, 0) <= 0
     OR COALESCE((p_metadata->>'size_bytes')::bigint, 0) > 15728640
     OR p_metadata->>'bucket' <> 'personnel-files'
     OR p_metadata->>'path' NOT LIKE p_org_id::text || '/' || p_employee_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Personnel file must be clean and tenant scoped.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_personnel_file(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_row_id uuid, p_employee_id uuid, p_category text, p_expiry_date date,
  p_notes text, p_file jsonb
)
RETURNS SETOF public.personnel_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row_value public.personnel_files%ROWTYPE; command_row public.file_commands%ROWTYPE;
  actor_role_value text; input_value jsonb; hash_value text; managed_id uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN RAISE EXCEPTION 'Personnel file access is forbidden.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE org_id = p_org_id AND id = p_employee_id) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_clean_personnel_file(p_org_id, p_employee_id, p_command_id, p_file);
  input_value := jsonb_build_object('row_id', p_row_id, 'employee_id', p_employee_id,
    'category', COALESCE(NULLIF(btrim(p_category), ''), 'other'), 'expiry_date', p_expiry_date,
    'notes', NULLIF(btrim(p_notes), ''), 'file', p_file);
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.file_commands (id, org_id, actor_user_id, action, target_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'personnel_file', p_row_id, hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.file_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'personnel_file' OR command_row.target_id IS DISTINCT FROM p_row_id
     OR command_row.input_hash IS DISTINCT FROM hash_value THEN
    RAISE EXCEPTION 'File command id was reused with different input.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.personnel_files WHERE id = p_row_id; RETURN; END IF;
  INSERT INTO public.managed_files (id, org_id, bucket_id, storage_path, owner_type, owner_id,
    employee_id, original_name, detected_mime, size_bytes, sha256, scan_status, scan_engine, scanned_at,
    retention_until, uploaded_by)
  VALUES (managed_id, p_org_id, 'personnel-files', p_file->>'path', 'personnel_file', p_row_id,
    p_employee_id, p_file->>'filename', p_file->>'type', (p_file->>'size_bytes')::bigint,
    p_file->>'sha256', 'clean', p_file->>'scan_engine', (p_file->>'scanned_at')::timestamptz,
    CURRENT_DATE + 2555, p_actor_user_id);
  INSERT INTO public.personnel_files (id, org_id, employee_id, category, file_name, file_path,
    file_size, expiry_date, notes, uploaded_by, managed_file_id, scan_status, sha256)
  VALUES (p_row_id, p_org_id, p_employee_id, COALESCE(NULLIF(btrim(p_category), ''), 'other'),
    p_file->>'filename', p_file->>'path', (p_file->>'size_bytes')::integer, p_expiry_date,
    NULLIF(btrim(p_notes), ''), p_actor_user_id, managed_id, 'clean', p_file->>'sha256')
  RETURNING * INTO row_value;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'personnel.file_registered',
    'personnel_file', row_value.id::text, 'success', 201,
    jsonb_build_object('employee_id', p_employee_id, 'sha256', p_file->>'sha256', 'expiry_date', p_expiry_date));
  UPDATE public.file_commands SET status = 'completed', completed_at = now(), result = to_jsonb(row_value) WHERE id = p_command_id;
  RETURN NEXT row_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_employee_contract(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_row_id uuid, p_employee_id uuid, p_contract_type text, p_start_date date,
  p_end_date date, p_probation_end_date date, p_salary numeric, p_file jsonb
)
RETURNS SETOF public.employee_contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row_value public.employee_contracts%ROWTYPE; command_row public.file_commands%ROWTYPE;
  actor_role_value text; input_value jsonb; hash_value text; managed_id uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN RAISE EXCEPTION 'Contract access is forbidden.' USING ERRCODE = '42501'; END IF;
  IF p_start_date IS NULL OR (p_end_date IS NOT NULL AND p_end_date < p_start_date)
     OR (p_probation_end_date IS NOT NULL AND p_probation_end_date < p_start_date) OR COALESCE(p_salary, 0) < 0 THEN
    RAISE EXCEPTION 'Contract dates or salary are invalid.' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE org_id = p_org_id AND id = p_employee_id) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_clean_personnel_file(p_org_id, p_employee_id, p_command_id, p_file);
  input_value := jsonb_build_object('row_id', p_row_id, 'employee_id', p_employee_id,
    'contract_type', COALESCE(NULLIF(btrim(p_contract_type), ''), 'permanent'), 'start_date', p_start_date,
    'end_date', p_end_date, 'probation_end_date', p_probation_end_date, 'salary', p_salary, 'file', p_file);
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.file_commands (id, org_id, actor_user_id, action, target_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'employee_contract', p_row_id, hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.file_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'employee_contract' OR command_row.target_id IS DISTINCT FROM p_row_id
     OR command_row.input_hash IS DISTINCT FROM hash_value THEN
    RAISE EXCEPTION 'File command id was reused with different input.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.employee_contracts WHERE id = p_row_id; RETURN; END IF;
  INSERT INTO public.managed_files (id, org_id, bucket_id, storage_path, owner_type, owner_id,
    employee_id, original_name, detected_mime, size_bytes, sha256, scan_status, scan_engine, scanned_at,
    retention_until, uploaded_by)
  VALUES (managed_id, p_org_id, 'personnel-files', p_file->>'path', 'employee_contract', p_row_id,
    p_employee_id, p_file->>'filename', p_file->>'type', (p_file->>'size_bytes')::bigint,
    p_file->>'sha256', 'clean', p_file->>'scan_engine', (p_file->>'scanned_at')::timestamptz,
    GREATEST(COALESCE(p_end_date, CURRENT_DATE), CURRENT_DATE) + 2555, p_actor_user_id);
  INSERT INTO public.employee_contracts (id, org_id, employee_id, contract_type, start_date, end_date,
    probation_end_date, salary_at_signing, file_path, status, created_by, managed_file_id, version)
  VALUES (p_row_id, p_org_id, p_employee_id, COALESCE(NULLIF(btrim(p_contract_type), ''), 'permanent'),
    p_start_date, p_end_date, p_probation_end_date, p_salary, p_file->>'path', 'active',
    p_actor_user_id, managed_id, 1) RETURNING * INTO row_value;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'personnel.contract_registered',
    'employee_contract', row_value.id::text, 'success', 201,
    jsonb_build_object('employee_id', p_employee_id, 'sha256', p_file->>'sha256', 'end_date', p_end_date));
  UPDATE public.file_commands SET status = 'completed', completed_at = now(), result = to_jsonb(row_value) WHERE id = p_command_id;
  RETURN NEXT row_value;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_clean_personnel_file(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_personnel_file(uuid, uuid, uuid, uuid, uuid, uuid, text, date, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_employee_contract(uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, date, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_personnel_file(uuid, uuid, uuid, uuid, uuid, uuid, text, date, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_employee_contract(uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, date, numeric, jsonb) TO service_role;
