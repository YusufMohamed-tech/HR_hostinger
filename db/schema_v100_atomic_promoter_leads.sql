-- Keep promoter lead capture/update, lead history, cross-module references,
-- durable assignment notification, and audit in one replay-safe transaction.

ALTER TABLE public.promoter_leads
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.promoter_leads
  DROP CONSTRAINT IF EXISTS promoter_leads_version_check,
  ADD CONSTRAINT promoter_leads_version_check CHECK (version >= 0);

CREATE TABLE IF NOT EXISTS public.promoter_lead_commands (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('lead_create', 'lead_update')),
  lead_id uuid REFERENCES public.promoter_leads(id) ON DELETE RESTRICT,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS idx_promoter_lead_commands_org_created
  ON public.promoter_lead_commands(organization_id, created_at DESC);

ALTER TABLE public.promoter_lead_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promoter_lead_commands_service_only
  ON public.promoter_lead_commands;
CREATE POLICY promoter_lead_commands_service_only
  ON public.promoter_lead_commands
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS promoter_leads_insert ON public.promoter_leads;
DROP POLICY IF EXISTS promoter_leads_update ON public.promoter_leads;
CREATE POLICY promoter_leads_insert ON public.promoter_leads
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY promoter_leads_update ON public.promoter_leads
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS promoter_lead_events_insert ON public.promoter_lead_events;
CREATE POLICY promoter_lead_events_insert ON public.promoter_lead_events
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.save_promoter_lead_atomic(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_lead_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS SETOF public.promoter_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_record public.promoter_lead_commands%ROWTYPE;
  lead_record public.promoter_leads%ROWTYPE;
  actor_role_value text;
  action_value text := CASE WHEN p_lead_id IS NULL THEN 'lead_create' ELSE 'lead_update' END;
  input_value jsonb := jsonb_build_object('lead_id', p_lead_id, 'payload', p_payload);
  input_hash_value text;
  previous_assigned_agent_id uuid;
  assigned_agent_changed boolean := false;
  event_type_value text;
  event_payload jsonb;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Promoter lead command input is invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.profiles profile
    ON profile.user_id = member.user_id
   AND profile.org_id = member.org_id
   AND lower(profile.account_status) = 'active'
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Active organization membership is required.' USING ERRCODE = '42501';
  END IF;
  IF p_lead_id IS NULL
     AND actor_role_value NOT IN ('promoter', 'admin', 'hr_admin', 'sales_manager') THEN
    RAISE EXCEPTION 'Promoter lead capture permission is required.' USING ERRCODE = '42501';
  END IF;

  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.promoter_lead_commands (
    id, organization_id, actor_user_id, request_id, action, lead_id, input_hash
  ) VALUES (
    p_command_id, p_org_id, p_actor_user_id, p_request_id, action_value, p_lead_id, input_hash_value
  ) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_record
  FROM public.promoter_lead_commands command
  WHERE command.id = p_command_id
  FOR UPDATE;
  IF command_record.organization_id IS DISTINCT FROM p_org_id
     OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.action <> action_value
     OR command_record.input_hash <> input_hash_value THEN
    RAISE EXCEPTION 'Promoter lead command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_record.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.promoter_leads lead
      WHERE lead.organization_id = p_org_id AND lead.id = command_record.lead_id;
    RETURN;
  END IF;

  IF p_lead_id IS NOT NULL THEN
    SELECT * INTO lead_record
    FROM public.promoter_leads lead
    WHERE lead.organization_id = p_org_id AND lead.id = p_lead_id
    FOR UPDATE;
    IF lead_record.id IS NULL THEN
      RAISE EXCEPTION 'Promoter lead was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF lead_record.version <> p_expected_version THEN
      RAISE EXCEPTION 'Promoter lead changed; reload and retry.' USING ERRCODE = '40001';
    END IF;
    IF actor_role_value NOT IN ('admin', 'hr_admin', 'sales_manager')
       AND NOT (actor_role_value = 'sales' AND lead_record.assigned_agent_id = p_actor_user_id) THEN
      RAISE EXCEPTION 'Promoter lead update permission is required.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_payload) key
      WHERE key NOT IN ('status', 'assigned_agent_id', 'conversion_sale_log_id', 'pushed_offer_id', 'agent_reviewed_at')
    ) OR NOT (p_payload ?| ARRAY[
      'status', 'assigned_agent_id', 'conversion_sale_log_id', 'pushed_offer_id', 'agent_reviewed_at'
    ]) THEN
      RAISE EXCEPTION 'No supported promoter lead update was provided.' USING ERRCODE = '22023';
    END IF;
    previous_assigned_agent_id := lead_record.assigned_agent_id;
  ELSE
    IF COALESCE(p_expected_version, 0) <> 0 THEN
      RAISE EXCEPTION 'New promoter leads must use expected version zero.' USING ERRCODE = '40001';
    END IF;
    IF length(btrim(COALESCE(p_payload->>'full_name', ''))) < 2
       OR length(btrim(p_payload->>'full_name')) > 180
       OR length(btrim(COALESCE(p_payload->>'mobile', ''))) < 7
       OR length(btrim(p_payload->>'mobile')) > 30
       OR COALESCE((p_payload->>'consent_given')::boolean, false) = false THEN
      RAISE EXCEPTION 'Promoter lead identity and consent are invalid.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NULLIF(p_payload->>'company_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = (p_payload->>'company_id')::uuid
      AND company.is_active
  ) THEN
    RAISE EXCEPTION 'Promoter lead company must be active and belong to the organization.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(p_payload->>'campaign_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.promoter_campaigns campaign
    WHERE campaign.organization_id = p_org_id
      AND campaign.id = (p_payload->>'campaign_id')::uuid
      AND campaign.is_active
      AND (campaign.company_id IS NULL OR campaign.company_id IS NOT DISTINCT FROM NULLIF(p_payload->>'company_id', '')::uuid)
  ) THEN
    RAISE EXCEPTION 'Promoter campaign must be active and match the organization/company.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(p_payload->>'location_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations location
    WHERE location.org_id = p_org_id AND location.id = (p_payload->>'location_id')::uuid
  ) THEN
    RAISE EXCEPTION 'Promoter location must belong to the organization.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(p_payload->>'recommended_offer_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.telecom_offers offer
    WHERE offer.organization_id = p_org_id
      AND offer.id = (p_payload->>'recommended_offer_id')::uuid
      AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'Recommended offer must be active and belong to the organization.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(p_payload->>'pushed_offer_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.telecom_offers offer
    WHERE offer.organization_id = p_org_id
      AND offer.id = (p_payload->>'pushed_offer_id')::uuid
      AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'Pushed offer must be active and belong to the organization.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(p_payload->>'assigned_agent_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.org_members member
    JOIN public.profiles profile
      ON profile.user_id = member.user_id
     AND profile.org_id = member.org_id
     AND lower(profile.account_status) = 'active'
    WHERE member.org_id = p_org_id
      AND member.user_id = (p_payload->>'assigned_agent_id')::uuid
      AND member.role::text IN ('sales', 'sales_manager')
  ) THEN
    RAISE EXCEPTION 'Assigned Sales agent must be active and belong to the organization.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(p_payload->>'conversion_sale_log_id', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_logs sale
    WHERE sale.organization_id = p_org_id
      AND sale.id = (p_payload->>'conversion_sale_log_id')::uuid
  ) THEN
    RAISE EXCEPTION 'Conversion sales log must belong to the organization.' USING ERRCODE = '23514';
  END IF;

  IF p_lead_id IS NULL THEN
    INSERT INTO public.promoter_leads (
      organization_id, company_id, campaign_id, promoter_id, location_id,
      full_name, mobile, email, city, current_operator, sim_count,
      monthly_mobile_spend, home_internet_provider, monthly_home_spend,
      recommended_offer_id, pushed_offer_id, estimated_savings,
      recommendation_source, recommendation_snapshot, status, assigned_agent_id,
      consent_given, marketing_consent, consent_version, consent_at, language, version
    ) VALUES (
      p_org_id, NULLIF(p_payload->>'company_id', '')::uuid,
      NULLIF(p_payload->>'campaign_id', '')::uuid, p_actor_user_id,
      NULLIF(p_payload->>'location_id', '')::uuid, btrim(p_payload->>'full_name'),
      btrim(p_payload->>'mobile'), NULLIF(btrim(p_payload->>'email'), ''),
      NULLIF(btrim(p_payload->>'city'), ''), NULLIF(btrim(p_payload->>'current_operator'), ''),
      NULLIF(p_payload->>'sim_count', '')::integer,
      NULLIF(p_payload->>'monthly_mobile_spend', '')::numeric,
      NULLIF(btrim(p_payload->>'home_internet_provider'), ''),
      NULLIF(p_payload->>'monthly_home_spend', '')::numeric,
      NULLIF(p_payload->>'recommended_offer_id', '')::uuid,
      NULLIF(p_payload->>'pushed_offer_id', '')::uuid,
      COALESCE((p_payload->>'estimated_savings')::numeric, 0),
      COALESCE(NULLIF(p_payload->>'recommendation_source', ''), 'auto'),
      COALESCE(p_payload->'recommendation_snapshot', '{}'::jsonb),
      CASE
        WHEN NULLIF(p_payload->>'assigned_agent_id', '') IS NOT NULL THEN 'sent_to_agent'
        WHEN NULLIF(p_payload->>'recommended_offer_id', '') IS NOT NULL
          OR NULLIF(p_payload->>'pushed_offer_id', '') IS NOT NULL THEN 'recommended'
        ELSE 'captured'
      END,
      NULLIF(p_payload->>'assigned_agent_id', '')::uuid,
      true, COALESCE((p_payload->>'marketing_consent')::boolean, false),
      NULLIF(btrim(p_payload->>'consent_version'), ''), now(),
      COALESCE(NULLIF(p_payload->>'language', ''), 'ar'), 0
    ) RETURNING * INTO lead_record;

    INSERT INTO public.promoter_lead_events (
      organization_id, lead_id, event_type, actor_id, meta
    ) VALUES (
      p_org_id, lead_record.id, 'captured', p_actor_user_id,
      jsonb_build_object('recommended_offer_id', lead_record.recommended_offer_id)
    );
    IF lead_record.recommended_offer_id IS NOT NULL OR lead_record.pushed_offer_id IS NOT NULL THEN
      INSERT INTO public.promoter_lead_events (
        organization_id, lead_id, event_type, actor_id, meta
      ) VALUES (
        p_org_id, lead_record.id,
        CASE WHEN lead_record.pushed_offer_id IS NULL THEN 'recommended' ELSE 'manual_offer_pushed' END,
        p_actor_user_id, lead_record.recommendation_snapshot
      );
    END IF;
    IF lead_record.assigned_agent_id IS NOT NULL THEN
      INSERT INTO public.promoter_lead_events (
        organization_id, lead_id, event_type, actor_id, meta
      ) VALUES (
        p_org_id, lead_record.id, 'sent_to_agent', p_actor_user_id,
        jsonb_build_object('assigned_agent_id', lead_record.assigned_agent_id)
      );
    END IF;
    assigned_agent_changed := lead_record.assigned_agent_id IS NOT NULL;
    event_type_value := 'created';
  ELSE
    IF p_payload ? 'status'
       AND p_payload->>'status' NOT IN ('captured', 'recommended', 'sent_to_agent', 'converted', 'not_interested', 'invalid') THEN
      RAISE EXCEPTION 'Promoter lead status is invalid.' USING ERRCODE = '23514';
    END IF;
    IF p_payload->>'status' = 'converted'
       AND COALESCE(NULLIF(p_payload->>'conversion_sale_log_id', '')::uuid, lead_record.conversion_sale_log_id) IS NULL THEN
      RAISE EXCEPTION 'Converted promoter leads require a Sales log.' USING ERRCODE = '23514';
    END IF;

    UPDATE public.promoter_leads SET
      status = CASE WHEN p_payload ? 'status' THEN p_payload->>'status' ELSE status END,
      assigned_agent_id = CASE WHEN p_payload ? 'assigned_agent_id'
        THEN NULLIF(p_payload->>'assigned_agent_id', '')::uuid ELSE assigned_agent_id END,
      conversion_sale_log_id = CASE WHEN p_payload ? 'conversion_sale_log_id'
        THEN NULLIF(p_payload->>'conversion_sale_log_id', '')::uuid ELSE conversion_sale_log_id END,
      pushed_offer_id = CASE WHEN p_payload ? 'pushed_offer_id'
        THEN NULLIF(p_payload->>'pushed_offer_id', '')::uuid ELSE pushed_offer_id END,
      agent_reviewed_at = CASE
        WHEN p_payload ? 'agent_reviewed_at' THEN NULLIF(p_payload->>'agent_reviewed_at', '')::timestamptz
        WHEN p_payload ? 'status' AND p_payload->>'status' IS DISTINCT FROM status THEN now()
        ELSE agent_reviewed_at
      END,
      version = version + 1,
      updated_at = now()
    WHERE id = lead_record.id
    RETURNING * INTO lead_record;

    assigned_agent_changed := lead_record.assigned_agent_id IS DISTINCT FROM previous_assigned_agent_id;
    event_type_value := COALESCE(
      NULLIF(p_payload->>'status', ''),
      CASE WHEN assigned_agent_changed THEN 'sent_to_agent' ELSE 'updated' END
    );
    INSERT INTO public.promoter_lead_events (
      organization_id, lead_id, event_type, actor_id, meta
    ) VALUES (
      p_org_id, lead_record.id, event_type_value, p_actor_user_id, p_payload
    );
  END IF;

  event_payload := jsonb_build_object(
    'event_type', 'promoter.lead_saved',
    'lead_id', lead_record.id,
    'full_name', lead_record.full_name,
    'status', lead_record.status,
    'assigned_agent_id', lead_record.assigned_agent_id,
    'previous_assigned_agent_id', previous_assigned_agent_id,
    'assigned_agent_changed', assigned_agent_changed,
    'version', lead_record.version
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'promoter_lead', action_value || ':' || p_command_id::text, 1,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, 'promoter.lead_saved', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'promoter.lead_' || event_type_value, 'promoter_lead', lead_record.id::text,
    'success', CASE WHEN p_lead_id IS NULL THEN 201 ELSE 200 END, event_payload
  );
  UPDATE public.promoter_lead_commands SET
    lead_id = lead_record.id, status = 'completed', result = to_jsonb(lead_record), completed_at = now()
  WHERE id = command_record.id;

  RETURN NEXT lead_record;
END;
$$;

REVOKE ALL ON FUNCTION public.save_promoter_lead_atomic(
  uuid, uuid, uuid, uuid, uuid, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_promoter_lead_atomic(
  uuid, uuid, uuid, uuid, uuid, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.save_promoter_lead_atomic(
  uuid, uuid, uuid, uuid, uuid, integer, jsonb
) IS
  'Atomically persists promoter leads, their history, tenant references, audit, and durable Sales assignment events.';
