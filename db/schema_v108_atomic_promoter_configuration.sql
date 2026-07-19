-- Versioned, replay-safe promoter configuration commands.
-- Offers, reference values, recommendation settings, and campaigns now append
-- audit/event evidence in the same transaction as their source row.

ALTER TABLE public.telecom_offers ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.promoter_reference_values ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.promoter_campaigns ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.promoter_settings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

ALTER TABLE public.telecom_offers DROP CONSTRAINT IF EXISTS telecom_offers_version_check;
ALTER TABLE public.telecom_offers ADD CONSTRAINT telecom_offers_version_check CHECK (version >= 0);
ALTER TABLE public.promoter_reference_values DROP CONSTRAINT IF EXISTS promoter_reference_values_version_check;
ALTER TABLE public.promoter_reference_values ADD CONSTRAINT promoter_reference_values_version_check CHECK (version >= 0);
ALTER TABLE public.promoter_campaigns DROP CONSTRAINT IF EXISTS promoter_campaigns_version_check;
ALTER TABLE public.promoter_campaigns ADD CONSTRAINT promoter_campaigns_version_check CHECK (version >= 0);
ALTER TABLE public.promoter_settings DROP CONSTRAINT IF EXISTS promoter_settings_version_check;
ALTER TABLE public.promoter_settings ADD CONSTRAINT promoter_settings_version_check CHECK (version >= 0);

CREATE TABLE IF NOT EXISTS public.promoter_configuration_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('offer', 'reference', 'campaign', 'settings')),
  entity_id uuid,
  operation text NOT NULL CHECK (operation IN ('save', 'deactivate')),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, command_id)
);
CREATE INDEX IF NOT EXISTS promoter_configuration_commands_org_created_idx
  ON public.promoter_configuration_commands(organization_id, created_at DESC);
ALTER TABLE public.promoter_configuration_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promoter_configuration_commands_select ON public.promoter_configuration_commands;
CREATE POLICY promoter_configuration_commands_select ON public.promoter_configuration_commands
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  );

DROP POLICY IF EXISTS telecom_offers_write ON public.telecom_offers;
DROP POLICY IF EXISTS promoter_reference_values_write ON public.promoter_reference_values;
DROP POLICY IF EXISTS promoter_campaigns_write ON public.promoter_campaigns;
DROP POLICY IF EXISTS promoter_settings_write ON public.promoter_settings;

CREATE OR REPLACE FUNCTION public.promoter_configuration_increment_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.version = OLD.version THEN NEW.version := OLD.version + 1; END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name_value text;
BEGIN
  FOREACH table_name_value IN ARRAY ARRAY[
    'telecom_offers', 'promoter_reference_values', 'promoter_campaigns', 'promoter_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_configuration_version ON public.%I',
      table_name_value, table_name_value);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_configuration_version BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.promoter_configuration_increment_version()',
      table_name_value, table_name_value
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_promoter_configuration_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_version integer,
  p_operation text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.promoter_configuration_commands%ROWTYPE;
  offer_row public.telecom_offers%ROWTYPE;
  reference_row public.promoter_reference_values%ROWTYPE;
  campaign_row public.promoter_campaigns%ROWTYPE;
  settings_row public.promoter_settings%ROWTYPE;
  actor_role_value text;
  clean_payload jsonb;
  hash_value text;
  target_id_value uuid;
  version_value integer;
  result_value jsonb;
  event_payload jsonb;
  event_id uuid;
  change_value text;
  company_id_value uuid;
  product_id_value uuid;
  product_company_id_value uuid;
  operation_value text := 'update';
  table_name_value text;
  name_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, and command ids are required.' USING ERRCODE = '22023';
  END IF;
  IF p_entity_type NOT IN ('offer', 'reference', 'campaign', 'settings')
     OR p_operation NOT IN ('save', 'deactivate')
     OR (p_operation = 'deactivate' AND p_entity_type <> 'offer') THEN
    RAISE EXCEPTION 'Unsupported promoter configuration command.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Promoter configuration payload must be an object.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'hr_admin', 'sales_manager')
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Promoter manager access is required.' USING ERRCODE = '42501';
  END IF;

  clean_payload := COALESCE(p_payload, '{}'::jsonb) - ARRAY[
    'id', 'organization_id', 'created_by', 'created_at', 'updated_at',
    'version', 'command_id', 'request_id', 'expected_version'
  ];
  hash_value := encode(digest(jsonb_build_object(
    'entity_type', p_entity_type, 'entity_id', p_entity_id,
    'expected_version', COALESCE(p_expected_version, 0),
    'operation', p_operation, 'payload', clean_payload
  )::text, 'sha256'), 'hex');
  INSERT INTO public.promoter_configuration_commands (
    organization_id, command_id, entity_type, entity_id, operation,
    payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_entity_type, p_entity_id, p_operation,
    hash_value, p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, command_id) DO NOTHING;
  SELECT * INTO command_row FROM public.promoter_configuration_commands
  WHERE organization_id = p_org_id AND command_id = p_command_id FOR UPDATE;
  IF command_row.entity_type <> p_entity_type OR command_row.operation <> p_operation
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different promoter configuration command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;

  IF p_entity_type = 'offer' THEN
    table_name_value := 'telecom_offers';
    IF p_entity_id IS NULL THEN
      INSERT INTO public.telecom_offers (
        organization_id, company_id, product_id, name_ar, name_en, offer_target,
        monthly_price, contract_months, data_gb, minutes, sim_count,
        benefits_ar, benefits_en, eligibility, priority, is_active, created_by, version
      ) VALUES (
        p_org_id, NULLIF(clean_payload->>'company_id', '')::uuid,
        NULLIF(clean_payload->>'product_id', '')::uuid, btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''), clean_payload->>'offer_target',
        COALESCE((clean_payload->>'monthly_price')::numeric, 0),
        NULLIF(clean_payload->>'contract_months', '')::integer,
        NULLIF(clean_payload->>'data_gb', '')::numeric,
        NULLIF(clean_payload->>'minutes', '')::integer,
        NULLIF(clean_payload->>'sim_count', '')::integer,
        COALESCE(clean_payload->'benefits_ar', '[]'::jsonb),
        COALESCE(clean_payload->'benefits_en', '[]'::jsonb),
        COALESCE(clean_payload->'eligibility', '{}'::jsonb),
        COALESCE((clean_payload->>'priority')::integer, 0),
        COALESCE((clean_payload->>'is_active')::boolean, true), p_actor_user_id, 1
      ) RETURNING * INTO offer_row;
      operation_value := 'insert'; change_value := 'created';
    ELSE
      SELECT * INTO offer_row FROM public.telecom_offers
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF offer_row.id IS NULL THEN RAISE EXCEPTION 'Telecom offer was not found.' USING ERRCODE = 'P0002'; END IF;
      IF offer_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Telecom offer version conflict.' USING ERRCODE = '40001';
      END IF;
      IF p_operation = 'deactivate' THEN
        offer_row.is_active := false; change_value := 'deactivated';
      ELSE
        offer_row := jsonb_populate_record(offer_row, clean_payload); change_value := 'updated';
      END IF;
      offer_row.id := p_entity_id; offer_row.organization_id := p_org_id;
      offer_row.version := COALESCE(p_expected_version, 0) + 1;
      UPDATE public.telecom_offers SET
        company_id = offer_row.company_id, product_id = offer_row.product_id,
        name_ar = offer_row.name_ar, name_en = offer_row.name_en,
        offer_target = offer_row.offer_target, monthly_price = offer_row.monthly_price,
        contract_months = offer_row.contract_months, data_gb = offer_row.data_gb,
        minutes = offer_row.minutes, sim_count = offer_row.sim_count,
        benefits_ar = offer_row.benefits_ar, benefits_en = offer_row.benefits_en,
        eligibility = offer_row.eligibility, priority = offer_row.priority,
        is_active = offer_row.is_active, version = offer_row.version
      WHERE id = offer_row.id RETURNING * INTO offer_row;
    END IF;
    IF NULLIF(btrim(offer_row.name_ar), '') IS NULL
       OR offer_row.offer_target NOT IN ('mobile', 'home_internet', 'bundle', 'addon') THEN
      RAISE EXCEPTION 'Offer name and target are required.' USING ERRCODE = '23514';
    END IF;
    company_id_value := offer_row.company_id; product_id_value := offer_row.product_id;
    target_id_value := offer_row.id; version_value := offer_row.version;
    name_value := offer_row.name_ar; result_value := to_jsonb(offer_row);

  ELSIF p_entity_type = 'reference' THEN
    table_name_value := 'promoter_reference_values';
    IF p_entity_id IS NULL THEN
      INSERT INTO public.promoter_reference_values (
        organization_id, kind, code, label_ar, label_en, is_active, sort_order, version
      ) VALUES (
        p_org_id, clean_payload->>'kind', btrim(clean_payload->>'code'),
        btrim(clean_payload->>'label_ar'), NULLIF(btrim(clean_payload->>'label_en'), ''),
        COALESCE((clean_payload->>'is_active')::boolean, true),
        COALESCE((clean_payload->>'sort_order')::integer, 0), 1
      ) RETURNING * INTO reference_row;
      operation_value := 'insert'; change_value := 'created';
    ELSE
      SELECT * INTO reference_row FROM public.promoter_reference_values
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF reference_row.id IS NULL THEN RAISE EXCEPTION 'Promoter reference was not found.' USING ERRCODE = 'P0002'; END IF;
      IF reference_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Promoter reference version conflict.' USING ERRCODE = '40001';
      END IF;
      reference_row := jsonb_populate_record(reference_row, clean_payload);
      reference_row.id := p_entity_id; reference_row.organization_id := p_org_id;
      reference_row.version := COALESCE(p_expected_version, 0) + 1;
      UPDATE public.promoter_reference_values SET
        kind = reference_row.kind, code = reference_row.code,
        label_ar = reference_row.label_ar, label_en = reference_row.label_en,
        is_active = reference_row.is_active, sort_order = reference_row.sort_order,
        version = reference_row.version
      WHERE id = reference_row.id RETURNING * INTO reference_row;
      change_value := 'updated';
    END IF;
    target_id_value := reference_row.id; version_value := reference_row.version;
    name_value := reference_row.label_ar; result_value := to_jsonb(reference_row);

  ELSIF p_entity_type = 'campaign' THEN
    table_name_value := 'promoter_campaigns';
    IF p_entity_id IS NULL THEN
      INSERT INTO public.promoter_campaigns (
        organization_id, company_id, name, code, start_date, end_date,
        target_leads, is_active, version
      ) VALUES (
        p_org_id, NULLIF(clean_payload->>'company_id', '')::uuid,
        btrim(clean_payload->>'name'), NULLIF(btrim(clean_payload->>'code'), ''),
        NULLIF(clean_payload->>'start_date', '')::date,
        NULLIF(clean_payload->>'end_date', '')::date,
        NULLIF(clean_payload->>'target_leads', '')::integer,
        COALESCE((clean_payload->>'is_active')::boolean, true), 1
      ) RETURNING * INTO campaign_row;
      operation_value := 'insert'; change_value := 'created';
    ELSE
      SELECT * INTO campaign_row FROM public.promoter_campaigns
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF campaign_row.id IS NULL THEN RAISE EXCEPTION 'Promoter campaign was not found.' USING ERRCODE = 'P0002'; END IF;
      IF campaign_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Promoter campaign version conflict.' USING ERRCODE = '40001';
      END IF;
      campaign_row := jsonb_populate_record(campaign_row, clean_payload);
      campaign_row.id := p_entity_id; campaign_row.organization_id := p_org_id;
      campaign_row.version := COALESCE(p_expected_version, 0) + 1;
      UPDATE public.promoter_campaigns SET
        company_id = campaign_row.company_id, name = campaign_row.name, code = campaign_row.code,
        start_date = campaign_row.start_date, end_date = campaign_row.end_date,
        target_leads = campaign_row.target_leads, is_active = campaign_row.is_active,
        version = campaign_row.version
      WHERE id = campaign_row.id RETURNING * INTO campaign_row;
      change_value := 'updated';
    END IF;
    company_id_value := campaign_row.company_id;
    target_id_value := campaign_row.id; version_value := campaign_row.version;
    name_value := campaign_row.name; result_value := to_jsonb(campaign_row);

  ELSE
    table_name_value := 'promoter_settings';
    company_id_value := NULLIF(clean_payload->>'company_id', '')::uuid;
    IF p_entity_id IS NULL THEN
      INSERT INTO public.promoter_settings (
        organization_id, company_id, weights, consent_version,
        consent_text_ar, consent_text_en, version
      ) VALUES (
        p_org_id, company_id_value, COALESCE(clean_payload->'weights',
          '{"savings":0.6,"data":0.2,"bundle":0.1,"priority":0.1}'::jsonb),
        COALESCE(NULLIF(btrim(clean_payload->>'consent_version'), ''), 'v1'),
        NULLIF(btrim(clean_payload->>'consent_text_ar'), ''),
        NULLIF(btrim(clean_payload->>'consent_text_en'), ''), 1
      ) RETURNING * INTO settings_row;
      operation_value := 'insert'; change_value := 'created';
    ELSE
      SELECT * INTO settings_row FROM public.promoter_settings
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF settings_row.id IS NULL THEN RAISE EXCEPTION 'Promoter settings were not found.' USING ERRCODE = 'P0002'; END IF;
      IF settings_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Promoter settings version conflict.' USING ERRCODE = '40001';
      END IF;
      settings_row := jsonb_populate_record(settings_row, clean_payload);
      settings_row.id := p_entity_id; settings_row.organization_id := p_org_id;
      settings_row.version := COALESCE(p_expected_version, 0) + 1;
      UPDATE public.promoter_settings SET
        company_id = settings_row.company_id, weights = settings_row.weights,
        consent_version = settings_row.consent_version,
        consent_text_ar = settings_row.consent_text_ar,
        consent_text_en = settings_row.consent_text_en, version = settings_row.version
      WHERE id = settings_row.id RETURNING * INTO settings_row;
      change_value := 'updated';
    END IF;
    company_id_value := settings_row.company_id;
    IF jsonb_typeof(settings_row.weights) <> 'object'
       OR COALESCE((settings_row.weights->>'savings')::numeric, -1) NOT BETWEEN 0 AND 1
       OR COALESCE((settings_row.weights->>'data')::numeric, -1) NOT BETWEEN 0 AND 1
       OR COALESCE((settings_row.weights->>'bundle')::numeric, -1) NOT BETWEEN 0 AND 1
       OR COALESCE((settings_row.weights->>'priority')::numeric, -1) NOT BETWEEN 0 AND 1
       OR COALESCE((settings_row.weights->>'savings')::numeric, 0)
        + COALESCE((settings_row.weights->>'data')::numeric, 0)
        + COALESCE((settings_row.weights->>'bundle')::numeric, 0)
        + COALESCE((settings_row.weights->>'priority')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Promoter recommendation weights are invalid.' USING ERRCODE = '23514';
    END IF;
    target_id_value := settings_row.id; version_value := settings_row.version;
    name_value := 'Promoter settings'; result_value := to_jsonb(settings_row);
  END IF;

  IF company_id_value IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id AND company.id = company_id_value
  ) THEN
    RAISE EXCEPTION 'Sales company does not belong to this organization.' USING ERRCODE = '23514';
  END IF;
  IF product_id_value IS NOT NULL THEN
    SELECT product.company_id INTO product_company_id_value
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id AND product.id = product_id_value;
    IF NOT FOUND OR (company_id_value IS NOT NULL
       AND product_company_id_value IS DISTINCT FROM company_id_value) THEN
      RAISE EXCEPTION 'Sales product does not match the offer organization/company.' USING ERRCODE = '23514';
    END IF;
  END IF;

  event_payload := jsonb_build_object(
    'event_type', 'promoter.configuration_saved',
    'entity_type', p_entity_type, 'entity_id', target_id_value,
    'operation', operation_value, 'change', change_value,
    'name', name_value, 'version', GREATEST(version_value, 1)
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'promoter_configuration', p_command_id::text, GREATEST(version_value, 1),
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'promoter.configuration_saved', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'promoter.' || p_entity_type || '_' || change_value, table_name_value,
    target_id_value::text, 'success', 200,
    jsonb_build_object('version', version_value, 'command_id', p_command_id)
  );
  UPDATE public.promoter_configuration_commands SET
    entity_id = target_id_value, status = 'completed', result = result_value,
    completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_promoter_configuration_command(
  uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_promoter_configuration_command(
  uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_promoter_configuration_command(uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb) IS
  'Atomically saves promoter offers, references, campaigns, and settings with tenant validation, optimistic versioning, audit, and outbox evidence.';
