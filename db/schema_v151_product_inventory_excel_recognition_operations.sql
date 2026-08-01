-- Operational cleanup and monitoring support for automatic workbook recognition.

ALTER TABLE public.product_inventory_commerce_settings
  ADD COLUMN IF NOT EXISTS automatic_workbook_recognition_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.product_inventory_commerce_settings.automatic_workbook_recognition_enabled IS
  'Tenant-scoped operational kill switch for automatic Excel/CSV recognition and profile analysis.';

CREATE OR REPLACE FUNCTION public.expire_product_inventory_import_analyses(
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
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Analysis expiry batch size must be between 1 and 1000.'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT analysis.id, analysis.managed_file_id
    FROM public.product_inventory_import_analyses analysis
    WHERE analysis.status IN ('analyzing', 'needs_review', 'ready')
      AND analysis.expires_at <= now()
    ORDER BY analysis.expires_at, analysis.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ), expired AS (
    UPDATE public.product_inventory_import_analyses analysis
    SET status = 'expired', updated_at = now()
    FROM candidates
    WHERE analysis.id = candidates.id
    RETURNING analysis.managed_file_id
  ), retained AS (
    UPDATE public.managed_files file
    SET retention_until = LEAST(COALESCE(file.retention_until, CURRENT_DATE), CURRENT_DATE),
        deletion_available_at = now()
    FROM expired
    WHERE file.id = expired.managed_file_id
      AND file.legal_hold = false
      AND file.deleted_at IS NULL
    RETURNING file.id
  )
  SELECT count(*) INTO expired_count FROM expired;

  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_product_inventory_import_analyses(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_product_inventory_import_analyses(integer)
  TO service_role;

CREATE INDEX IF NOT EXISTS product_inventory_import_analyses_monitor_idx
  ON public.product_inventory_import_analyses (status, updated_at, confidence);

CREATE INDEX IF NOT EXISTS managed_files_profile_sample_retention_idx
  ON public.managed_files (retention_until, deletion_status)
  WHERE owner_type = 'product_inventory_import_profile_sample'
    AND deleted_at IS NULL;

COMMENT ON FUNCTION public.expire_product_inventory_import_analyses(integer) IS
  'Expires unconfirmed workbook analyses in bounded, concurrent-safe batches and releases their private samples to retention.';
