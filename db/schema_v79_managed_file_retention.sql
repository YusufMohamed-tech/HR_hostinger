-- Retryable, observable retention processing for private managed personnel files.

ALTER TABLE public.managed_files
  ADD COLUMN IF NOT EXISTS deletion_status text NOT NULL DEFAULT 'active'
    CHECK (deletion_status IN ('active', 'processing', 'failed', 'deleted', 'dead_letter')),
  ADD COLUMN IF NOT EXISTS deletion_attempts integer NOT NULL DEFAULT 0 CHECK (deletion_attempts >= 0),
  ADD COLUMN IF NOT EXISTS deletion_available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deletion_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_locked_by text;

CREATE INDEX IF NOT EXISTS idx_managed_files_deletion_queue
  ON public.managed_files(deletion_status, deletion_available_at, retention_until)
  WHERE deleted_at IS NULL AND legal_hold = false;

CREATE OR REPLACE FUNCTION public.claim_managed_file_retention(
  p_worker_id text, p_batch_size integer DEFAULT 25, p_as_of date DEFAULT CURRENT_DATE
)
RETURNS SETOF public.managed_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_worker_id, ''))) = 0 THEN
    RAISE EXCEPTION 'worker id is required.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT file.id
    FROM public.managed_files file
    WHERE file.deleted_at IS NULL AND file.legal_hold = false
      AND file.retention_until IS NOT NULL AND file.retention_until <= p_as_of
      AND file.deletion_attempts < 10
      AND ((file.deletion_status IN ('active', 'failed') AND file.deletion_available_at <= now())
        OR (file.deletion_status = 'processing' AND file.deletion_locked_at < now() - interval '5 minutes'))
    ORDER BY file.retention_until, file.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 25), 1), 100)
  )
  UPDATE public.managed_files file
  SET deletion_status = 'processing', deletion_attempts = file.deletion_attempts + 1,
      deletion_locked_at = now(), deletion_locked_by = p_worker_id, deletion_error = NULL
  FROM candidates WHERE file.id = candidates.id
  RETURNING file.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_managed_file_retention(p_file_id uuid, p_worker_id text)
RETURNS SETOF public.managed_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  UPDATE public.managed_files file
  SET deletion_status = 'deleted', deleted_at = now(), deletion_error = NULL,
      deletion_locked_at = NULL, deletion_locked_by = NULL
  WHERE file.id = p_file_id AND file.deletion_status = 'processing'
    AND file.deletion_locked_by = p_worker_id AND file.legal_hold = false
  RETURNING file.*;
  IF NOT FOUND THEN RAISE EXCEPTION 'Managed-file deletion lock is no longer owned.' USING ERRCODE = '40001'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_managed_file_retention(
  p_file_id uuid, p_worker_id text, p_error text
)
RETURNS SETOF public.managed_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row_value public.managed_files%ROWTYPE; event_payload jsonb; event_id_value uuid;
  next_status text; retry_seconds integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO row_value FROM public.managed_files file
  WHERE file.id = p_file_id AND file.deletion_status = 'processing' AND file.deletion_locked_by = p_worker_id
  FOR UPDATE;
  IF row_value.id IS NULL THEN RAISE EXCEPTION 'Managed-file deletion lock is no longer owned.' USING ERRCODE = '40001'; END IF;
  next_status := CASE WHEN row_value.deletion_attempts >= 10 THEN 'dead_letter' ELSE 'failed' END;
  retry_seconds := LEAST((power(2, GREATEST(row_value.deletion_attempts, 1)) * 15)::integer, 3600);
  UPDATE public.managed_files file
  SET deletion_status = next_status, deletion_error = left(COALESCE(p_error, 'Unknown deletion error'), 2000),
      deletion_available_at = CASE WHEN next_status = 'failed' THEN now() + make_interval(secs => retry_seconds)
        ELSE file.deletion_available_at END,
      deletion_locked_at = NULL, deletion_locked_by = NULL
  WHERE file.id = p_file_id RETURNING * INTO row_value;
  IF next_status = 'dead_letter' THEN
    event_payload := jsonb_build_object('event_type', 'file.retention_dead_letter', 'managed_file_id', row_value.id,
      'owner_type', row_value.owner_type, 'owner_id', row_value.owner_id, 'employee_id', row_value.employee_id,
      'original_name', row_value.original_name, 'attempts', row_value.deletion_attempts,
      'last_error', row_value.deletion_error);
    INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash,
      status, occurred_at, processed_at)
    VALUES (row_value.org_id, 'file_retention', row_value.id::text, event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', now(), now())
    ON CONFLICT (org_id, source_type, business_key) DO NOTHING RETURNING id INTO event_id_value;
    IF event_id_value IS NOT NULL THEN
      INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
      VALUES (row_value.org_id, event_id_value, 'file.retention_dead_letter', event_payload,
        encode(digest(event_payload::text, 'sha256'), 'hex'));
    END IF;
  END IF;
  RETURN NEXT row_value;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_managed_file_retention(text, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_managed_file_retention(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_managed_file_retention(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_managed_file_retention(text, integer, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_managed_file_retention(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_managed_file_retention(uuid, text, text) TO service_role;
