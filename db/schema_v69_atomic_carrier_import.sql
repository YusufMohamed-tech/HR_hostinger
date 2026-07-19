-- Versioned Carrier workbook ingestion with hidden staging, stable row identity,
-- rejection evidence, idempotent commands, and one-transaction publication.

ALTER TABLE public.carrier_activation_imports
  ADD COLUMN IF NOT EXISTS contract_version text NOT NULL DEFAULT 'virgin-friendi-activation-v1',
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS staged_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
UPDATE public.carrier_activation_imports
SET file_sha256 = encode(digest(id::text || ':' || file_name || ':' || created_at::text, 'sha256'), 'hex')
WHERE file_sha256 IS NULL;
ALTER TABLE public.carrier_activation_imports ALTER COLUMN file_sha256 SET NOT NULL;
ALTER TABLE public.carrier_activation_imports
  DROP CONSTRAINT IF EXISTS carrier_activation_imports_file_sha256_check,
  ADD CONSTRAINT carrier_activation_imports_file_sha256_check CHECK (length(file_sha256) = 64),
  DROP CONSTRAINT IF EXISTS carrier_activation_imports_count_check,
  ADD CONSTRAINT carrier_activation_imports_count_check CHECK (
    total_rows >= 0 AND staged_rows >= 0 AND new_rows >= 0 AND duplicate_rows >= 0
    AND rejected_rows >= 0 AND matched_rows >= 0 AND unmatched_rows >= 0
  );

ALTER TABLE public.carrier_activations
  ADD COLUMN IF NOT EXISTS source_row_hash text,
  ADD COLUMN IF NOT EXISTS source_contract_version text NOT NULL DEFAULT 'legacy-v0',
  ADD COLUMN IF NOT EXISTS source_row_number integer;
UPDATE public.carrier_activations activation
SET source_row_hash = encode(digest(concat_ws('|',
  activation.organization_id::text, activation.dealer_code, activation.activation_date::text,
  COALESCE(activation.activated_at::text, ''), COALESCE(activation.cas_location_id, ''),
  COALESCE(activation.bundle_type, ''), COALESCE(activation.segment_brand, ''),
  COALESCE(activation.segment_group, ''), activation.activation_count::text,
  activation.fpe_count::text, activation.ibr_value::text, activation.id::text
), 'sha256'), 'hex')
WHERE source_row_hash IS NULL;
ALTER TABLE public.carrier_activations ALTER COLUMN source_row_hash SET NOT NULL;
ALTER TABLE public.carrier_activations
  DROP CONSTRAINT IF EXISTS carrier_activations_source_row_hash_check,
  ADD CONSTRAINT carrier_activations_source_row_hash_check CHECK (length(source_row_hash) = 64),
  DROP CONSTRAINT IF EXISTS carrier_activations_source_row_number_check,
  ADD CONSTRAINT carrier_activations_source_row_number_check CHECK (source_row_number IS NULL OR source_row_number > 1),
  DROP CONSTRAINT IF EXISTS carrier_activations_organization_id_dealer_code_activated_at_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_carrier_activation_source_row
  ON public.carrier_activations(organization_id, source_row_hash);

CREATE TABLE IF NOT EXISTS public.carrier_import_staging (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 1),
  source_row_hash text NOT NULL CHECK (length(source_row_hash) = 64),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors) = 'array'),
  matched_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  matched_supervisor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (import_id, row_number)
);
CREATE INDEX IF NOT EXISTS carrier_import_staging_org_import_idx
  ON public.carrier_import_staging(organization_id, import_id, row_number);

CREATE TABLE IF NOT EXISTS public.carrier_import_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 1),
  source_row_hash text NOT NULL CHECK (length(source_row_hash) = 64),
  payload jsonb NOT NULL,
  validation_errors jsonb NOT NULL CHECK (jsonb_typeof(validation_errors) = 'array' AND jsonb_array_length(validation_errors) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, row_number)
);
CREATE INDEX IF NOT EXISTS carrier_import_rejections_org_import_idx
  ON public.carrier_import_rejections(organization_id, import_id, row_number);

CREATE TABLE IF NOT EXISTS public.carrier_import_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('begin', 'publish', 'fail')),
  import_id uuid REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.carrier_import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_import_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_import_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY carrier_import_rejections_select ON public.carrier_import_rejections FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager'))
);
CREATE POLICY carrier_import_commands_select ON public.carrier_import_commands FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager'))
);

CREATE OR REPLACE FUNCTION public.begin_carrier_import(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_file_name text, p_file_sha256 text, p_contract_version text,
  p_activation_month date, p_date_range_start date, p_date_range_end date, p_total_rows integer
)
RETURNS SETOF public.carrier_activation_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.carrier_import_commands%ROWTYPE;
  import_row public.carrier_activation_imports%ROWTYPE;
  actor_role_value text;
  payload_value jsonb := jsonb_build_object(
    'file_name', p_file_name, 'file_sha256', p_file_sha256, 'contract_version', p_contract_version,
    'activation_month', p_activation_month, 'date_range_start', p_date_range_start,
    'date_range_end', p_date_range_end, 'total_rows', p_total_rows
  );
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Carrier import management access is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_file_name, ''))) NOT BETWEEN 1 AND 255
     OR p_file_sha256 !~ '^[0-9a-f]{64}$'
     OR p_contract_version <> 'virgin-friendi-activation-v1'
     OR p_total_rows NOT BETWEEN 1 AND 50000
     OR p_date_range_end < p_date_range_start
     OR date_trunc('month', p_date_range_start)::date <> p_activation_month
     OR date_trunc('month', p_date_range_end)::date <> p_activation_month THEN
    RAISE EXCEPTION 'Carrier import contract metadata is invalid.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.carrier_import_commands (
    organization_id, idempotency_key, action, payload_hash, actor_user_id, request_id
  ) VALUES (p_org_id, p_command_id, 'begin', hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.carrier_import_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'begin' OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for another carrier import.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.carrier_activation_imports
      WHERE organization_id = p_org_id AND id = command_row.import_id;
    RETURN;
  END IF;
  INSERT INTO public.carrier_activation_imports (
    organization_id, file_name, file_sha256, contract_version, activation_month,
    date_range_start, date_range_end, total_rows, status, uploaded_by, request_id
  ) VALUES (
    p_org_id, btrim(p_file_name), p_file_sha256, p_contract_version, p_activation_month,
    p_date_range_start, p_date_range_end, p_total_rows, 'processing', p_actor_user_id, p_request_id
  ) RETURNING * INTO import_row;
  UPDATE public.carrier_import_commands SET import_id = import_row.id, status = 'completed',
    completed_at = now(), result = jsonb_build_object('import_id', import_row.id, 'status', import_row.status)
  WHERE id = command_row.id;
  RETURN NEXT import_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_carrier_import(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid, p_import_id uuid
)
RETURNS SETOF public.carrier_activation_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.carrier_import_commands%ROWTYPE;
  import_row public.carrier_activation_imports%ROWTYPE;
  actor_role_value text;
  staged_count integer; rejected_count integer; inserted_count integer; matched_count integer;
  payload_value jsonb := jsonb_build_object('import_id', p_import_id);
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Carrier import management access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.carrier_import_commands (
    organization_id, idempotency_key, action, import_id, payload_hash, actor_user_id, request_id
  ) VALUES (p_org_id, p_command_id, 'publish', p_import_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.carrier_import_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'publish' OR command_row.import_id <> p_import_id OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for another carrier publish.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.carrier_activation_imports
      WHERE organization_id = p_org_id AND id = p_import_id;
    RETURN;
  END IF;
  SELECT * INTO import_row FROM public.carrier_activation_imports
  WHERE organization_id = p_org_id AND id = p_import_id FOR UPDATE;
  IF import_row.id IS NULL THEN RAISE EXCEPTION 'Carrier import was not found.' USING ERRCODE = 'P0002'; END IF;
  IF import_row.status <> 'processing' THEN RAISE EXCEPTION 'Carrier import is not publishable.' USING ERRCODE = '55000'; END IF;
  SELECT count(*), count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0)
  INTO staged_count, rejected_count FROM public.carrier_import_staging
  WHERE organization_id = p_org_id AND import_id = p_import_id;
  IF staged_count <> import_row.total_rows THEN
    RAISE EXCEPTION 'Carrier staging is incomplete: expected %, found %.', import_row.total_rows, staged_count USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.carrier_import_staging stage
    WHERE stage.organization_id = p_org_id AND stage.import_id = p_import_id
      AND jsonb_array_length(stage.validation_errors) = 0
      AND (
        COALESCE(stage.payload->>'dealer_code', '') = ''
        OR COALESCE(stage.payload->>'activation_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
        OR (stage.payload->>'activation_date')::date < import_row.date_range_start
        OR (stage.payload->>'activation_date')::date > import_row.date_range_end
        OR date_trunc('month', (stage.payload->>'activation_date')::date)::date <> import_row.activation_month
        OR COALESCE((stage.payload->>'activation_count')::numeric, 0) <= 0
        OR COALESCE((stage.payload->>'fpe_count')::numeric, -1) < 0
        OR COALESCE((stage.payload->>'ibr_value')::numeric, -1) < 0
      )
  ) THEN RAISE EXCEPTION 'A supposedly valid staged Carrier row violates the contract.' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.carrier_import_rejections (
    organization_id, import_id, row_number, source_row_hash, payload, validation_errors
  ) SELECT organization_id, import_id, row_number, source_row_hash, payload, validation_errors
  FROM public.carrier_import_staging
  WHERE organization_id = p_org_id AND import_id = p_import_id
    AND jsonb_array_length(validation_errors) > 0
  ON CONFLICT (import_id, row_number) DO NOTHING;

  INSERT INTO public.carrier_activations (
    organization_id, import_id, source_row_hash, source_contract_version, source_row_number,
    activation_count, bundle_type, activation_month, activation_date, region, city,
    distributor_name, channel, dealer_name, dealer_code, key_account_manager, account_manager,
    team_leader, sales_champion, segment_brand, segment_group, customer_nationality,
    customer_id_type, latitude, longitude, activated_at, cas_location_id, cas_location_name,
    bundle_description, fpe_count, ibr_value, ibr_value_excl_vat, first_recharge_value,
    second_recharge_value, uid_percent, first_bundle_qty, first_bundle_revenue,
    lifetime_recharge, initial_balance_total, dealer_partner, subscription_type,
    matched_employee_id, matched_supervisor_id, bundle_category, shift_type, is_duplicate
  )
  SELECT DISTINCT ON (stage.source_row_hash)
    p_org_id, p_import_id, stage.source_row_hash, import_row.contract_version, stage.row_number,
    (stage.payload->>'activation_count')::integer, NULLIF(stage.payload->>'bundle_type', ''),
    (stage.payload->>'activation_month')::date, (stage.payload->>'activation_date')::date,
    NULLIF(stage.payload->>'region', ''), NULLIF(stage.payload->>'city', ''),
    NULLIF(stage.payload->>'distributor_name', ''), NULLIF(stage.payload->>'channel', ''),
    NULLIF(stage.payload->>'dealer_name', ''), stage.payload->>'dealer_code',
    NULLIF(stage.payload->>'key_account_manager', ''), NULLIF(stage.payload->>'account_manager', ''),
    NULLIF(stage.payload->>'team_leader', ''), NULLIF(stage.payload->>'sales_champion', ''),
    NULLIF(stage.payload->>'segment_brand', ''), NULLIF(stage.payload->>'segment_group', ''),
    NULLIF(stage.payload->>'customer_nationality', ''), NULLIF(stage.payload->>'customer_id_type', ''),
    NULLIF(stage.payload->>'latitude', '')::numeric, NULLIF(stage.payload->>'longitude', '')::numeric,
    NULLIF(stage.payload->>'activated_at', '')::timestamptz,
    NULLIF(stage.payload->>'cas_location_id', ''), NULLIF(stage.payload->>'cas_location_name', ''),
    NULLIF(stage.payload->>'bundle_description', ''), (stage.payload->>'fpe_count')::integer,
    (stage.payload->>'ibr_value')::numeric, (stage.payload->>'ibr_value_excl_vat')::numeric,
    (stage.payload->>'first_recharge_value')::numeric, (stage.payload->>'second_recharge_value')::numeric,
    (stage.payload->>'uid_percent')::numeric, (stage.payload->>'first_bundle_qty')::integer,
    (stage.payload->>'first_bundle_revenue')::numeric, (stage.payload->>'lifetime_recharge')::numeric,
    (stage.payload->>'initial_balance_total')::numeric, NULLIF(stage.payload->>'dealer_partner', ''),
    NULLIF(stage.payload->>'subscription_type', ''),
    CASE WHEN employee.org_id = p_org_id THEN employee.id ELSE NULL END,
    CASE WHEN supervisor.org_id = p_org_id THEN supervisor.id ELSE NULL END,
    NULLIF(stage.payload->>'bundle_category', ''), NULLIF(stage.payload->>'shift_type', ''), false
  FROM public.carrier_import_staging stage
  LEFT JOIN public.employees employee ON employee.id = stage.matched_employee_id
  LEFT JOIN public.employees supervisor ON supervisor.id = stage.matched_supervisor_id
  WHERE stage.organization_id = p_org_id AND stage.import_id = p_import_id
    AND jsonb_array_length(stage.validation_errors) = 0
  ORDER BY stage.source_row_hash, stage.row_number
  ON CONFLICT (organization_id, source_row_hash) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  SELECT count(*) FILTER (WHERE matched_employee_id IS NOT NULL) INTO matched_count
  FROM public.carrier_activations WHERE organization_id = p_org_id AND import_id = p_import_id;
  UPDATE public.carrier_activation_imports SET
    staged_rows = staged_count,
    new_rows = inserted_count,
    duplicate_rows = staged_count - rejected_count - inserted_count,
    rejected_rows = rejected_count,
    matched_rows = matched_count,
    unmatched_rows = inserted_count - matched_count,
    status = CASE WHEN inserted_count = 0 AND rejected_count > 0 THEN 'failed'
      WHEN rejected_count > 0 THEN 'partial' ELSE 'completed' END,
    error_message = CASE WHEN rejected_count > 0 THEN rejected_count::text || ' row(s) rejected by contract validation.' ELSE NULL END,
    published_at = CASE WHEN inserted_count > 0 OR rejected_count = 0 THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_import_id RETURNING * INTO import_row;
  UPDATE public.carrier_import_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('import_id', import_row.id, 'status', import_row.status,
      'total_rows', import_row.total_rows, 'new_rows', import_row.new_rows,
      'duplicate_rows', import_row.duplicate_rows, 'rejected_rows', import_row.rejected_rows)
  WHERE id = command_row.id;
  RETURN NEXT import_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_carrier_import(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_import_id uuid, p_error_message text
)
RETURNS SETOF public.carrier_activation_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE import_row public.carrier_activation_imports%ROWTYPE; actor_role_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id
    AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Carrier import management access is required.' USING ERRCODE = '42501'; END IF;
  UPDATE public.carrier_activation_imports SET status = 'failed',
    error_message = left(COALESCE(NULLIF(btrim(p_error_message), ''), 'Carrier import failed.'), 2000),
    staged_rows = (SELECT count(*) FROM public.carrier_import_staging WHERE import_id = p_import_id),
    updated_at = now()
  WHERE organization_id = p_org_id AND id = p_import_id AND status = 'processing'
  RETURNING * INTO import_row;
  IF import_row.id IS NULL THEN RAISE EXCEPTION 'Carrier import was not found or is no longer processing.' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.carrier_import_commands (
    organization_id, idempotency_key, action, import_id, payload_hash, status,
    result, actor_user_id, request_id, completed_at
  ) VALUES (
    p_org_id, p_command_id, 'fail', p_import_id,
    encode(digest(jsonb_build_object('import_id', p_import_id, 'error', import_row.error_message)::text, 'sha256'), 'hex'),
    'completed', jsonb_build_object('import_id', p_import_id, 'status', 'failed'),
    p_actor_user_id, p_request_id, now()
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  RETURN NEXT import_row;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_carrier_import(uuid, uuid, uuid, uuid, text, text, text, date, date, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_carrier_import(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_carrier_import(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_carrier_import(uuid, uuid, uuid, uuid, text, text, text, date, date, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_carrier_import(uuid, uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_carrier_import(uuid, uuid, uuid, uuid, uuid, text) TO service_role;
