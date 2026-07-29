-- Allow managed-file audit metadata to identify the private Hostinger
-- filesystem used by the application deployment.

ALTER TABLE public.managed_files
  DROP CONSTRAINT IF EXISTS managed_files_storage_provider_check,
  ADD CONSTRAINT managed_files_storage_provider_check CHECK (
    storage_provider IN (
      'supabase_storage',
      'hostinger_s3',
      'hostinger_filesystem'
    )
  );

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
     OR provider_value NOT IN (
       'supabase_storage',
       'hostinger_s3',
       'hostinger_filesystem'
     )
     OR length(btrim(COALESCE(p_metadata->>'bucket', ''))) = 0
     OR p_metadata->>'path' NOT LIKE
       p_org_id::text || '/' || p_employee_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Personnel file must be clean, private, and tenant scoped.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_clean_personnel_file(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.managed_files.storage_provider IS
  'Physical binary provider: Supabase legacy storage, S3-compatible storage, or the private Hostinger application filesystem.';
