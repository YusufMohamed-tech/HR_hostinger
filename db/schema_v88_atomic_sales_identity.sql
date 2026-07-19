-- v88: atomic and replay-safe field-agent / merchant identity provisioning.

CREATE TABLE IF NOT EXISTS public.sales_identity_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_type text NOT NULL CHECK (identity_type IN ('field_agent', 'merchant')),
  payload_hash text NOT NULL,
  result_snapshot jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, command_id),
  UNIQUE (org_id, identity_type, user_id)
);

ALTER TABLE public.sales_identity_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_identity_commands_service_only ON public.sales_identity_commands;
CREATE POLICY sales_identity_commands_service_only ON public.sales_identity_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.sales_identity_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sales_identity_commands TO service_role;

CREATE OR REPLACE FUNCTION public.guard_sales_identity_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role'
     OR current_setting('app.sales_identity_command', true) <> 'trusted' THEN
    RAISE EXCEPTION 'Sales identities must be created through the provisioning command.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_field_agent_insert_trigger ON public.field_agents;
CREATE TRIGGER guard_field_agent_insert_trigger
  BEFORE INSERT ON public.field_agents FOR EACH ROW EXECUTE FUNCTION public.guard_sales_identity_insert();
DROP TRIGGER IF EXISTS guard_merchant_insert_trigger ON public.merchants;
CREATE TRIGGER guard_merchant_insert_trigger
  BEFORE INSERT ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.guard_sales_identity_insert();

CREATE OR REPLACE FUNCTION public.provision_sales_identity(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_user_id uuid,
  p_identity_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_record public.sales_identity_commands%ROWTYPE;
  actor_role text;
  normalized_payload jsonb;
  payload_hash_value text;
  entity_result jsonb;
  entity_id uuid := gen_random_uuid();
  agent_record public.field_agents%ROWTYPE;
  merchant_record public.merchants%ROWTYPE;
  owner_agent public.field_agents%ROWTYPE;
  event_payload jsonb;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, command, and user ids are required.' USING ERRCODE = '22023';
  END IF;
  IF p_identity_type NOT IN ('field_agent', 'merchant') THEN
    RAISE EXCEPTION 'Unsupported sales identity type.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id;
  IF (p_identity_type = 'field_agent' AND actor_role NOT IN ('admin', 'sales_manager', 'onground_agent_manager'))
     OR (p_identity_type = 'merchant' AND actor_role NOT IN ('admin', 'sales_manager', 'onground_agent_manager', 'field_agent')) THEN
    RAISE EXCEPTION 'Actor cannot provision this sales identity.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Auth identity does not exist.' USING ERRCODE = '23503';
  END IF;

  normalized_payload := jsonb_strip_nulls(COALESCE(p_payload, '{}'::jsonb));
  payload_hash_value := encode(digest(jsonb_build_object(
    'user_id', p_user_id,
    'identity_type', p_identity_type,
    'payload', normalized_payload
  )::text, 'sha256'), 'hex');

  SELECT * INTO command_record FROM public.sales_identity_commands
  WHERE org_id = p_org_id AND command_id = p_command_id FOR UPDATE;
  IF command_record.id IS NOT NULL THEN
    IF command_record.actor_user_id <> p_actor_user_id
       OR command_record.user_id <> p_user_id
       OR command_record.identity_type <> p_identity_type
       OR command_record.payload_hash <> payload_hash_value THEN
      RAISE EXCEPTION 'Command id was already used with different identity input.' USING ERRCODE = '23505';
    END IF;
    IF command_record.status = 'completed' AND command_record.result_snapshot IS NOT NULL THEN
      RETURN command_record.result_snapshot;
    END IF;
    RAISE EXCEPTION 'Sales identity command is already processing.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.sales_identity_commands(
    org_id, command_id, actor_user_id, user_id, identity_type, payload_hash
  ) VALUES (
    p_org_id, p_command_id, p_actor_user_id, p_user_id, p_identity_type, payload_hash_value
  );

  IF length(btrim(COALESCE(normalized_payload->>'email', ''))) = 0
     OR length(btrim(COALESCE(normalized_payload->>'display_name', ''))) < 2 THEN
    RAISE EXCEPTION 'Email and display name are required.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.profiles(user_id, org_id, full_name, email, title, account_status)
  VALUES (
    p_user_id,
    p_org_id,
    btrim(normalized_payload->>'display_name'),
    lower(btrim(normalized_payload->>'email')),
    CASE WHEN p_identity_type = 'field_agent' THEN 'مندوب ميداني' ELSE 'تاجر' END,
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    title = EXCLUDED.title,
    account_status = 'active';

  INSERT INTO public.org_members(org_id, user_id, role)
  VALUES (p_org_id, p_user_id,
    CASE WHEN p_identity_type = 'field_agent' THEN 'field_agent'::public.org_role ELSE 'merchant'::public.org_role END)
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  PERFORM set_config('app.sales_identity_command', 'trusted', true);
  IF p_identity_type = 'field_agent' THEN
    IF length(btrim(COALESCE(normalized_payload->>'phone', ''))) < 8
       OR length(btrim(COALESCE(normalized_payload->>'national_id', ''))) < 5 THEN
      RAISE EXCEPTION 'Field-agent phone and national id are required.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.field_agents(
      id, organization_id, user_id, full_name, phone, national_id, region,
      commission_rate, sim_price, max_sim_capacity, created_by
    ) VALUES (
      entity_id, p_org_id, p_user_id, btrim(normalized_payload->>'display_name'),
      btrim(normalized_payload->>'phone'), btrim(normalized_payload->>'national_id'),
      NULLIF(btrim(COALESCE(normalized_payload->>'region', '')), ''),
      COALESCE((normalized_payload->>'commission_rate')::numeric, 0),
      COALESCE((normalized_payload->>'sim_price')::numeric, 0),
      (normalized_payload->>'max_sim_capacity')::integer,
      p_actor_user_id
    ) RETURNING * INTO agent_record;
    entity_result := to_jsonb(agent_record);
  ELSE
    SELECT * INTO owner_agent FROM public.field_agents
    WHERE id = (normalized_payload->>'agent_id')::uuid AND organization_id = p_org_id AND status = 'active';
    IF owner_agent.id IS NULL THEN
      RAISE EXCEPTION 'Active owning field agent was not found in this organization.' USING ERRCODE = '23503';
    END IF;
    IF actor_role = 'field_agent' AND owner_agent.user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'Field agents can provision merchants only for themselves.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.merchants(
      id, organization_id, agent_id, user_id, business_name, owner_name, phone,
      location, city, region, latitude, longitude, place_photo_url,
      sim_price, commission_rate, created_by
    ) VALUES (
      entity_id, p_org_id, owner_agent.id, p_user_id, btrim(normalized_payload->>'display_name'),
      NULLIF(btrim(COALESCE(normalized_payload->>'owner_name', '')), ''),
      NULLIF(btrim(COALESCE(normalized_payload->>'phone', '')), ''),
      NULLIF(btrim(COALESCE(normalized_payload->>'location', '')), ''),
      NULLIF(btrim(COALESCE(normalized_payload->>'city', '')), ''),
      NULLIF(btrim(COALESCE(normalized_payload->>'region', '')), ''),
      (normalized_payload->>'latitude')::numeric,
      (normalized_payload->>'longitude')::numeric,
      NULLIF(btrim(COALESCE(normalized_payload->>'place_photo_url', '')), ''),
      COALESCE((normalized_payload->>'sim_price')::numeric, 0),
      COALESCE((normalized_payload->>'commission_rate')::numeric, 0),
      p_actor_user_id
    ) RETURNING * INTO merchant_record;
    entity_result := to_jsonb(merchant_record);
  END IF;

  event_payload := jsonb_build_object(
    'identity_type', p_identity_type,
    'entity_id', entity_id,
    'user_id', p_user_id,
    'actor_user_id', p_actor_user_id
  );
  INSERT INTO public.business_events(
    org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'sales.identity_provisioned', p_identity_type || ':' || entity_id::text,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, clock_timestamp(), clock_timestamp()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id_value, 'sales.identity_provisioned', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs(
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role,
    'sales.identity_provisioned', p_identity_type, entity_id::text,
    'success', 201, event_payload
  );
  UPDATE public.sales_identity_commands
  SET status = 'completed', result_snapshot = entity_result, completed_at = clock_timestamp()
  WHERE org_id = p_org_id AND command_id = p_command_id;
  RETURN entity_result;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_sales_identity(uuid, uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_sales_identity(uuid, uuid, uuid, uuid, uuid, text, jsonb)
  TO service_role;

COMMENT ON TABLE public.sales_identity_commands IS
  'Idempotency and recovery ledger for field-agent and merchant identity provisioning.';
