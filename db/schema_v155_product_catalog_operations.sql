-- Product catalog operational hardening: durable events, bounded stale-command
-- recovery, and managed-file retention integration.

CREATE OR REPLACE FUNCTION public.emit_product_catalog_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_value text;
  event_payload jsonb;
  event_hash text;
  event_id uuid;
  version_value integer;
BEGIN
  topic_value := CASE NEW.action
    WHEN 'create' THEN 'product_inventory.catalog_product_created'
    WHEN 'update' THEN 'product_inventory.catalog_product_updated'
    WHEN 'activate' THEN 'product_inventory.catalog_product_activated'
    WHEN 'deactivate' THEN 'product_inventory.catalog_product_deactivated'
  END;
  version_value := COALESCE((NEW.after_values->>'inventory_version')::integer, 1);
  event_payload := jsonb_build_object(
    'event_type', topic_value,
    'product_id', NEW.product_id,
    'company_id', NEW.company_id,
    'action', NEW.action,
    'source', NEW.source,
    'source_analysis_id', NEW.source_analysis_id,
    'actor_user_id', NEW.actor_user_id,
    'inventory_version', version_value
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    NEW.organization_id, 'product_catalog',
    NEW.product_id::text || ':' || NEW.action || ':' || version_value::text || ':' || NEW.command_id::text,
    version_value, event_payload, event_hash, 'completed', NEW.request_id,
    NEW.actor_user_id, NEW.created_at, now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    NEW.organization_id, event_id, topic_value, event_payload, event_hash
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_catalog_audit_event
  ON public.product_catalog_audit_logs;
CREATE TRIGGER trg_product_catalog_audit_event
  AFTER INSERT ON public.product_catalog_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.emit_product_catalog_audit_event();

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
    SELECT analysis.id, analysis.managed_file_id
    FROM public.product_catalog_import_analyses analysis
    WHERE analysis.status IN ('ready', 'needs_review') AND analysis.expires_at <= now()
    ORDER BY analysis.expires_at, analysis.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ), expired AS (
    UPDATE public.product_catalog_import_analyses analysis
    SET status = 'expired', updated_at = now()
    FROM candidates WHERE analysis.id = candidates.id
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

CREATE OR REPLACE FUNCTION public.recover_stale_product_catalog_commands(
  p_stale_before timestamptz,
  p_batch_size integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recovered_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_stale_before IS NULL OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Stale-command recovery parameters are invalid.' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS (
    SELECT command.id, command.analysis_id
    FROM public.product_catalog_commands command
    WHERE command.status = 'processing' AND command.created_at < p_stale_before
    ORDER BY command.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ), failed AS (
    UPDATE public.product_catalog_commands command
    SET status = 'failed', error_code = 'STALE_COMMAND_RECOVERED', completed_at = now()
    FROM candidates WHERE command.id = candidates.id
    RETURNING candidates.analysis_id
  ), analyses AS (
    UPDATE public.product_catalog_import_analyses analysis
    SET status = 'failed', updated_at = now()
    FROM failed
    WHERE failed.analysis_id IS NOT NULL
      AND analysis.id = failed.analysis_id
      AND analysis.status = 'committing'
    RETURNING analysis.id
  )
  SELECT count(*) INTO recovered_count FROM failed;
  RETURN recovered_count;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_product_catalog_audit_event()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_product_catalog_import_analyses(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_stale_product_catalog_commands(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_product_catalog_import_analyses(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_product_catalog_commands(timestamptz, integer)
  TO service_role;

CREATE INDEX IF NOT EXISTS product_catalog_commands_monitor_idx
  ON public.product_catalog_commands (status, created_at);
CREATE INDEX IF NOT EXISTS managed_files_product_catalog_retention_idx
  ON public.managed_files (retention_until, deletion_status)
  WHERE owner_type = 'product_catalog_import_workbook' AND deleted_at IS NULL;

COMMENT ON FUNCTION public.recover_stale_product_catalog_commands(timestamptz, integer) IS
  'Moves abandoned product catalog commands and their committing analyses to a terminal failed state in bounded batches.';
