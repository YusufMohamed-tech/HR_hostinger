-- Make tenant provisioning and organization configuration atomic, versioned,
-- replay-safe, and exclusively owned by trusted server commands.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_version_check,
  ADD CONSTRAINT organizations_version_check CHECK (version >= 0);

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.organization_settings
  DROP CONSTRAINT IF EXISTS organization_settings_version_check,
  ADD CONSTRAINT organization_settings_version_check CHECK (version >= 0);

CREATE TABLE IF NOT EXISTS public.organization_commands (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (
    action IN ('platform_create', 'platform_update', 'tenant_settings_update')
  ),
  target_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_organization_commands_org_created
  ON public.organization_commands(target_org_id, created_at DESC);

ALTER TABLE public.organization_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_commands_service_only
  ON public.organization_commands;
CREATE POLICY organization_commands_service_only
  ON public.organization_commands
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Organization and settings writes must go through execute_organization_command.
DROP POLICY IF EXISTS org_insert ON public.organizations;
DROP POLICY IF EXISTS org_update ON public.organizations;
DROP POLICY IF EXISTS org_delete ON public.organizations;
CREATE POLICY org_insert ON public.organizations
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY org_update ON public.organizations
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY org_delete ON public.organizations
  FOR DELETE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS organization_settings_insert ON public.organization_settings;
DROP POLICY IF EXISTS organization_settings_update ON public.organization_settings;
CREATE POLICY organization_settings_insert ON public.organization_settings
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY organization_settings_update ON public.organization_settings
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.execute_organization_command(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_action text,
  p_target_org_id uuid,
  p_expected_org_version integer,
  p_expected_settings_version integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_record public.organization_commands%ROWTYPE;
  organization_record public.organizations%ROWTYPE;
  settings_record public.organization_settings%ROWTYPE;
  actor_role_value text;
  input_value jsonb;
  input_hash_value text;
  settings_payload jsonb := COALESCE(p_payload->'settings', '{}'::jsonb);
  old_organization jsonb;
  old_settings jsonb;
  event_payload jsonb;
  result_value jsonb;
  event_id_value uuid;
  audit_action text;
  organization_changed boolean := false;
  settings_changed boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL
     OR p_action NOT IN ('platform_create', 'platform_update', 'tenant_settings_update')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Organization command input is invalid.' USING ERRCODE = '22023';
  END IF;

  IF p_action IN ('platform_create', 'platform_update') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_admins platform
      WHERE platform.user_id = p_actor_user_id
        AND platform.role = 'superadmin'
        AND platform.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Active superadmin permission is required.' USING ERRCODE = '42501';
    END IF;
    actor_role_value := 'superadmin';
  ELSE
    IF p_target_org_id IS NULL THEN
      RAISE EXCEPTION 'Target organization is required.' USING ERRCODE = '22023';
    END IF;
    SELECT member.role::text INTO actor_role_value
    FROM public.org_members member
    JOIN public.profiles profile
      ON profile.user_id = member.user_id
     AND profile.org_id = member.org_id
     AND lower(profile.account_status) = 'active'
    WHERE member.org_id = p_target_org_id
      AND member.user_id = p_actor_user_id
      AND member.role::text IN ('admin', 'hr_admin');
    IF actor_role_value IS NULL THEN
      RAISE EXCEPTION 'Organization administration permission is required.' USING ERRCODE = '42501';
    END IF;
  END IF;

  input_value := jsonb_build_object(
    'action', p_action,
    'target_org_id', p_target_org_id,
    'payload', p_payload
  );
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');

  INSERT INTO public.organization_commands (
    id, actor_user_id, request_id, action, target_org_id, input_hash
  ) VALUES (
    p_command_id, p_actor_user_id, p_request_id, p_action, p_target_org_id, input_hash_value
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO command_record
  FROM public.organization_commands command
  WHERE command.id = p_command_id
  FOR UPDATE;
  IF command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.action <> p_action
     OR command_record.input_hash <> input_hash_value THEN
    RAISE EXCEPTION 'Organization command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_record.status = 'completed' THEN
    RETURN command_record.result;
  END IF;

  IF p_action = 'platform_create' THEN
    IF p_target_org_id IS NOT NULL
       OR COALESCE(p_expected_org_version, 0) <> 0
       OR COALESCE(p_expected_settings_version, 0) <> 0 THEN
      RAISE EXCEPTION 'New organizations must not provide an existing target or version.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_payload) key
      WHERE key NOT IN ('name', 'slug', 'status')
    ) THEN
      RAISE EXCEPTION 'Unsupported organization creation field.' USING ERRCODE = '22023';
    END IF;
    IF length(btrim(COALESCE(p_payload->>'name', ''))) < 2
       OR length(btrim(p_payload->>'name')) > 200 THEN
      RAISE EXCEPTION 'Organization name must contain 2 to 200 characters.' USING ERRCODE = '23514';
    END IF;
    IF length(btrim(COALESCE(p_payload->>'slug', ''))) > 80
       OR btrim(COALESCE(p_payload->>'slug', '')) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'Organization slug is invalid.' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(p_payload->>'status', 'Active') NOT IN ('Active', 'Suspended', 'Deleted') THEN
      RAISE EXCEPTION 'Organization status is invalid.' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.organizations (
      name, slug, status, deleted_at, deletion_requested_at,
      deletion_requested_by, version
    ) VALUES (
      btrim(p_payload->>'name'),
      btrim(p_payload->>'slug'),
      COALESCE(p_payload->>'status', 'Active'),
      CASE WHEN p_payload->>'status' = 'Deleted' THEN now() ELSE NULL END,
      CASE WHEN p_payload->>'status' = 'Deleted' THEN now() ELSE NULL END,
      CASE WHEN p_payload->>'status' = 'Deleted' THEN p_actor_user_id ELSE NULL END,
      0
    ) RETURNING * INTO organization_record;

    -- Both helpers execute inside this function's transaction. Any failed
    -- default, subscription, workflow, or usage row rolls back the tenant.
    PERFORM public.create_organization_defaults(organization_record.id, p_actor_user_id);
    PERFORM public.refresh_organization_usage(organization_record.id);

    event_payload := jsonb_build_object(
      'event_type', 'platform.organization_created',
      'organization_id', organization_record.id,
      'name', organization_record.name,
      'slug', organization_record.slug,
      'status', organization_record.status,
      'version', organization_record.version
    );
    INSERT INTO public.platform_audit_logs (
      actor_user_id, actor_role, action, target_org_id, target_type, target_id, metadata
    ) VALUES (
      p_actor_user_id, 'superadmin', 'organization.created', organization_record.id,
      'organization', organization_record.id::text,
      event_payload || jsonb_build_object('command_id', p_command_id, 'request_id', p_request_id)
    );
    result_value := to_jsonb(organization_record);

  ELSIF p_action = 'platform_update' THEN
    IF p_target_org_id IS NULL OR p_expected_org_version IS NULL THEN
      RAISE EXCEPTION 'Target organization and expected version are required.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_payload) key
      WHERE key NOT IN ('name', 'slug', 'status', 'deletion_reason')
    ) OR NOT (p_payload ?| ARRAY['name', 'slug', 'status', 'deletion_reason']) THEN
      RAISE EXCEPTION 'No supported organization updates were provided.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO organization_record
    FROM public.organizations organization
    WHERE organization.id = p_target_org_id
    FOR UPDATE;
    IF organization_record.id IS NULL THEN
      RAISE EXCEPTION 'Organization was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF organization_record.version <> p_expected_org_version THEN
      RAISE EXCEPTION 'Organization changed; reload and retry.' USING ERRCODE = '40001';
    END IF;
    IF p_payload ? 'name' AND (
      length(btrim(COALESCE(p_payload->>'name', ''))) < 2
      OR length(btrim(p_payload->>'name')) > 200
    ) THEN
      RAISE EXCEPTION 'Organization name must contain 2 to 200 characters.' USING ERRCODE = '23514';
    END IF;
    IF p_payload ? 'slug' AND (
      length(btrim(COALESCE(p_payload->>'slug', ''))) > 80
      OR btrim(COALESCE(p_payload->>'slug', '')) !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ) THEN
      RAISE EXCEPTION 'Organization slug is invalid.' USING ERRCODE = '23514';
    END IF;
    IF p_payload ? 'status'
       AND COALESCE(p_payload->>'status', '') NOT IN ('Active', 'Suspended', 'Deleted') THEN
      RAISE EXCEPTION 'Organization status is invalid.' USING ERRCODE = '23514';
    END IF;

    old_organization := to_jsonb(organization_record);
    audit_action := CASE
      WHEN p_payload->>'status' = 'Suspended' AND organization_record.status IS DISTINCT FROM 'Suspended'
        THEN 'organization.suspended'
      WHEN p_payload->>'status' = 'Deleted' AND organization_record.status IS DISTINCT FROM 'Deleted'
        THEN 'organization.deleted'
      WHEN p_payload->>'status' = 'Active' AND organization_record.status IS DISTINCT FROM 'Active'
        THEN 'organization.activated'
      ELSE 'organization.updated'
    END;

    UPDATE public.organizations SET
      name = CASE WHEN p_payload ? 'name' THEN btrim(p_payload->>'name') ELSE name END,
      slug = CASE WHEN p_payload ? 'slug' THEN btrim(p_payload->>'slug') ELSE slug END,
      status = CASE WHEN p_payload ? 'status' THEN p_payload->>'status' ELSE status END,
      deleted_at = CASE
        WHEN p_payload->>'status' = 'Deleted' THEN COALESCE(deleted_at, now())
        WHEN p_payload->>'status' = 'Active' THEN NULL
        ELSE deleted_at
      END,
      deletion_requested_at = CASE
        WHEN p_payload->>'status' = 'Deleted' THEN COALESCE(deletion_requested_at, now())
        WHEN p_payload->>'status' = 'Active' THEN NULL
        ELSE deletion_requested_at
      END,
      deletion_requested_by = CASE
        WHEN p_payload->>'status' = 'Deleted' THEN p_actor_user_id
        WHEN p_payload->>'status' = 'Active' THEN NULL
        ELSE deletion_requested_by
      END,
      deletion_reason = CASE
        WHEN p_payload ? 'deletion_reason' THEN NULLIF(btrim(p_payload->>'deletion_reason'), '')
        WHEN p_payload->>'status' = 'Active' THEN NULL
        ELSE deletion_reason
      END,
      version = version + 1,
      updated_at = now()
    WHERE id = p_target_org_id
    RETURNING * INTO organization_record;

    event_payload := jsonb_build_object(
      'event_type', 'platform.organization_updated',
      'organization_id', organization_record.id,
      'action', audit_action,
      'old', old_organization,
      'new', to_jsonb(organization_record),
      'version', organization_record.version
    );
    INSERT INTO public.platform_audit_logs (
      actor_user_id, actor_role, action, target_org_id, target_type, target_id, metadata
    ) VALUES (
      p_actor_user_id, 'superadmin', audit_action, organization_record.id,
      'organization', organization_record.id::text,
      event_payload || jsonb_build_object('command_id', p_command_id, 'request_id', p_request_id)
    );
    result_value := to_jsonb(organization_record);

  ELSE
    IF p_expected_org_version IS NULL OR p_expected_settings_version IS NULL THEN
      RAISE EXCEPTION 'Organization and settings versions are required.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_payload) key
      WHERE key NOT IN ('name', 'settings')
    ) OR (p_payload ? 'settings' AND jsonb_typeof(p_payload->'settings') <> 'object') THEN
      RAISE EXCEPTION 'Unsupported organization settings payload.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(settings_payload) key
      WHERE key NOT IN ('brand_name', 'tagline', 'primary_color', 'locale', 'timezone')
    ) THEN
      RAISE EXCEPTION 'Unsupported organization setting.' USING ERRCODE = '22023';
    END IF;
    organization_changed := p_payload ? 'name';
    settings_changed := settings_payload ?| ARRAY[
      'brand_name', 'tagline', 'primary_color', 'locale', 'timezone'
    ];
    IF NOT organization_changed AND NOT settings_changed THEN
      RAISE EXCEPTION 'No supported organization settings updates were provided.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO organization_record
    FROM public.organizations organization
    WHERE organization.id = p_target_org_id
      AND organization.deleted_at IS NULL
      AND lower(organization.status) = 'active'
    FOR UPDATE;
    IF organization_record.id IS NULL THEN
      RAISE EXCEPTION 'Active organization was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO settings_record
    FROM public.organization_settings settings
    WHERE settings.org_id = p_target_org_id
    FOR UPDATE;
    IF settings_record.org_id IS NULL THEN
      RAISE EXCEPTION 'Organization settings are not provisioned.' USING ERRCODE = 'P0002';
    END IF;
    IF organization_record.version <> p_expected_org_version
       OR settings_record.version <> p_expected_settings_version THEN
      RAISE EXCEPTION 'Organization settings changed; reload and retry.' USING ERRCODE = '40001';
    END IF;
    IF organization_changed AND (
      length(btrim(COALESCE(p_payload->>'name', ''))) < 2
      OR length(btrim(p_payload->>'name')) > 200
    ) THEN
      RAISE EXCEPTION 'Organization name must contain 2 to 200 characters.' USING ERRCODE = '23514';
    END IF;
    IF settings_payload ? 'primary_color'
       AND COALESCE(settings_payload->>'primary_color', '') !~ '^#[0-9A-Fa-f]{6}$' THEN
      RAISE EXCEPTION 'Primary color must be a six-digit hex color.' USING ERRCODE = '23514';
    END IF;
    IF settings_payload ? 'locale'
       AND COALESCE(settings_payload->>'locale', '') !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$' THEN
      RAISE EXCEPTION 'Organization locale is invalid.' USING ERRCODE = '23514';
    END IF;
    IF settings_payload ? 'timezone' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names timezone
      WHERE timezone.name = settings_payload->>'timezone'
    ) THEN
      RAISE EXCEPTION 'Organization timezone is invalid.' USING ERRCODE = '22023';
    END IF;

    old_organization := to_jsonb(organization_record);
    old_settings := to_jsonb(settings_record);
    IF organization_changed THEN
      UPDATE public.organizations SET
        name = btrim(p_payload->>'name'),
        version = version + 1,
        updated_at = now()
      WHERE id = p_target_org_id
      RETURNING * INTO organization_record;
    END IF;
    IF settings_changed THEN
      UPDATE public.organization_settings SET
        brand_name = CASE WHEN settings_payload ? 'brand_name'
          THEN NULLIF(btrim(settings_payload->>'brand_name'), '') ELSE brand_name END,
        tagline = CASE WHEN settings_payload ? 'tagline'
          THEN NULLIF(btrim(settings_payload->>'tagline'), '') ELSE tagline END,
        primary_color = CASE WHEN settings_payload ? 'primary_color'
          THEN settings_payload->>'primary_color' ELSE primary_color END,
        locale = CASE WHEN settings_payload ? 'locale'
          THEN settings_payload->>'locale' ELSE locale END,
        timezone = CASE WHEN settings_payload ? 'timezone'
          THEN settings_payload->>'timezone' ELSE timezone END,
        version = version + 1,
        updated_at = now()
      WHERE org_id = p_target_org_id
      RETURNING * INTO settings_record;
    END IF;

    event_payload := jsonb_build_object(
      'event_type', 'organization.settings_updated',
      'organization_id', organization_record.id,
      'actor_user_id', p_actor_user_id,
      'changed_organization', organization_changed,
      'changed_settings', settings_changed,
      'organization_version', organization_record.version,
      'settings_version', settings_record.version
    );
    INSERT INTO public.operational_audit_logs (
      org_id, request_id, actor_user_id, actor_role, action, target_type,
      target_id, outcome, status_code, metadata
    ) VALUES (
      p_target_org_id, p_request_id, p_actor_user_id, actor_role_value,
      'organization.settings_updated', 'organization', p_target_org_id::text,
      'success', 200, jsonb_build_object(
        'command_id', p_command_id,
        'old', jsonb_build_object('organization', old_organization, 'settings', old_settings),
        'new', jsonb_build_object('organization', to_jsonb(organization_record), 'settings', to_jsonb(settings_record))
      )
    );
    result_value := jsonb_build_object(
      'organization', to_jsonb(organization_record),
      'settings', to_jsonb(settings_record)
    );
  END IF;

  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    organization_record.id,
    CASE WHEN p_action = 'tenant_settings_update' THEN 'organization_settings' ELSE 'platform_organization' END,
    p_action || ':' || p_command_id::text,
    1,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    organization_record.id,
    event_id_value,
    CASE
      WHEN p_action = 'platform_create' THEN 'platform.organization_created'
      WHEN p_action = 'platform_update' THEN 'platform.organization_updated'
      ELSE 'organization.settings_updated'
    END,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );

  UPDATE public.organization_commands SET
    target_org_id = organization_record.id,
    status = 'completed',
    result = result_value,
    completed_at = now()
  WHERE id = p_command_id;

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_organization_command(
  uuid, uuid, uuid, text, uuid, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_organization_command(
  uuid, uuid, uuid, text, uuid, integer, integer, jsonb
) TO service_role;

COMMENT ON TABLE public.organization_commands IS
  'Replay ledger for atomic platform tenant lifecycle and tenant configuration commands.';
COMMENT ON FUNCTION public.execute_organization_command(
  uuid, uuid, uuid, text, uuid, integer, integer, jsonb
) IS
  'Atomically creates/configures organizations with authorization, optimistic versions, audit, and durable events.';
