-- Atomic fixed-window abuse controls for public and authenticated API operations.

CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 1 AND 240),
  identifier_hash text NOT NULL CHECK (length(identifier_hash) = 64),
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, identifier_hash)
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_cleanup ON public.api_rate_limit_buckets(updated_at);
ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_rate_limit_buckets_service_only ON public.api_rate_limit_buckets FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_scope text, p_identifier_hash text, p_limit integer,
  p_window_seconds integer, p_block_seconds integer, p_now timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bucket public.api_rate_limit_buckets%ROWTYPE; allowed_value boolean;
  remaining_value integer; retry_after_value integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_scope, ''))) = 0 OR length(COALESCE(p_identifier_hash, '')) <> 64
     OR p_limit < 1 OR p_limit > 10000 OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_block_seconds < 1 OR p_block_seconds > 604800 THEN
    RAISE EXCEPTION 'Rate-limit parameters are invalid.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.api_rate_limit_buckets (scope, identifier_hash, window_started_at)
  VALUES (left(p_scope, 240), p_identifier_hash, p_now) ON CONFLICT DO NOTHING;
  SELECT * INTO bucket FROM public.api_rate_limit_buckets
  WHERE scope = left(p_scope, 240) AND identifier_hash = p_identifier_hash FOR UPDATE;
  IF bucket.blocked_until IS NOT NULL AND bucket.blocked_until > p_now THEN
    allowed_value := false;
    retry_after_value := GREATEST(1, ceil(extract(epoch FROM bucket.blocked_until - p_now))::integer);
  ELSE
    IF bucket.window_started_at <= p_now - make_interval(secs => p_window_seconds) THEN
      bucket.window_started_at := p_now; bucket.hits := 1; bucket.blocked_until := NULL;
    ELSE
      bucket.hits := bucket.hits + 1;
    END IF;
    IF bucket.hits > p_limit THEN
      allowed_value := false; bucket.blocked_until := p_now + make_interval(secs => p_block_seconds);
      retry_after_value := p_block_seconds;
    ELSE
      allowed_value := true;
    END IF;
    UPDATE public.api_rate_limit_buckets SET window_started_at = bucket.window_started_at,
      hits = bucket.hits, blocked_until = bucket.blocked_until, updated_at = p_now
    WHERE scope = bucket.scope AND identifier_hash = bucket.identifier_hash;
  END IF;
  remaining_value := GREATEST(0, p_limit - bucket.hits);
  IF random() < 0.01 THEN
    DELETE FROM public.api_rate_limit_buckets WHERE updated_at < p_now - interval '30 days';
  END IF;
  RETURN jsonb_build_object('allowed', allowed_value, 'remaining', remaining_value,
    'retryAfterSeconds', retry_after_value, 'limit', p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, text, integer, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, text, integer, integer, integer, timestamptz)
  TO service_role;
