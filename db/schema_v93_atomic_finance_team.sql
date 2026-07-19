-- v93: atomic, replay-safe finance-team identity and employee-master updates.

CREATE TABLE IF NOT EXISTS public.finance_team_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_finance_team_commands_org_created
  ON public.finance_team_commands(org_id, created_at DESC);
ALTER TABLE public.finance_team_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_team_commands_service_only ON public.finance_team_commands;
CREATE POLICY finance_team_commands_service_only ON public.finance_team_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.execute_finance_team_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_target_user_id uuid,
  p_employee_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_record public.finance_team_commands%ROWTYPE;
  employee_record public.employees%ROWTYPE;
  actor_role_value text;
  current_role_value text;
  next_role_value text;
  current_profile_name text;
  current_profile_phone text;
  full_name_value text;
  phone_value text;
  title_value text;
  input_value jsonb;
  input_hash_value text;
  business_date_value date;
  old_snapshot jsonb;
  new_snapshot jsonb;
  event_payload jsonb;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL
     OR p_target_user_id IS NULL OR p_employee_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version < 1 OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Finance-team command input is invalid.' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE((p_payload->>'role_touched')::boolean, false)
     AND NOT COALESCE((p_payload->>'full_name_touched')::boolean, false)
     AND NOT COALESCE((p_payload->>'phone_touched')::boolean, false) THEN
    RAISE EXCEPTION 'No finance-team changes were provided.' USING ERRCODE = '22023';
  END IF;

  input_value := jsonb_build_object(
    'target_user_id', p_target_user_id,
    'employee_id', p_employee_id,
    'expected_version', p_expected_version,
    'payload', COALESCE(p_payload, '{}'::jsonb)
  );
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.finance_team_commands(
    id, org_id, actor_user_id, request_id, target_user_id, employee_id, input_hash
  ) VALUES (
    p_command_id, p_org_id, p_actor_user_id, p_request_id, p_target_user_id, p_employee_id, input_hash_value
  ) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.finance_team_commands WHERE id = p_command_id FOR UPDATE;
  IF command_record.org_id IS DISTINCT FROM p_org_id
     OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.target_user_id IS DISTINCT FROM p_target_user_id
     OR command_record.employee_id IS DISTINCT FROM p_employee_id
     OR command_record.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Finance-team command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_record.status = 'completed' THEN RETURN command_record.result; END IF;

  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN
    IF EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = p_actor_user_id AND role = 'superadmin' AND status = 'active'
    ) THEN
      actor_role_value := 'superadmin';
    ELSE
      RAISE EXCEPTION 'Finance-team management permission is required.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT role::text INTO current_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_target_user_id FOR UPDATE;
  IF current_role_value NOT IN ('finance_manager', 'accountant', 'finance_viewer') THEN
    RAISE EXCEPTION 'Finance-team membership was not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO employee_record FROM public.employees
  WHERE org_id = p_org_id AND id = p_employee_id AND user_id = p_target_user_id
    AND lifecycle_status IN ('onboarding', 'active') FOR UPDATE;
  IF employee_record.id IS NULL THEN
    RAISE EXCEPTION 'Active finance employee was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF employee_record.lifecycle_version <> p_expected_version THEN
    RAISE EXCEPTION 'Finance employee changed; reload and retry.' USING ERRCODE = '40001';
  END IF;
  SELECT full_name, phone INTO current_profile_name, current_profile_phone FROM public.profiles
  WHERE org_id = p_org_id AND user_id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finance user profile was not found.' USING ERRCODE = 'P0002'; END IF;

  next_role_value := CASE WHEN COALESCE((p_payload->>'role_touched')::boolean, false)
    THEN lower(btrim(COALESCE(p_payload->>'role', ''))) ELSE current_role_value END;
  IF next_role_value NOT IN ('finance_manager', 'accountant', 'finance_viewer') THEN
    RAISE EXCEPTION 'A valid finance role is required.' USING ERRCODE = '23514';
  END IF;
  full_name_value := CASE WHEN COALESCE((p_payload->>'full_name_touched')::boolean, false)
    THEN btrim(COALESCE(p_payload->>'full_name', ''))
    ELSE COALESCE(NULLIF(btrim(current_profile_name), ''), employee_record.full_name) END;
  IF length(full_name_value) < 2 THEN
    RAISE EXCEPTION 'Finance employee full name is required.' USING ERRCODE = '23514';
  END IF;
  phone_value := CASE WHEN COALESCE((p_payload->>'phone_touched')::boolean, false)
    THEN NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '')
    ELSE COALESCE(current_profile_phone, employee_record.phone) END;
  title_value := CASE next_role_value
    WHEN 'finance_manager' THEN 'Finance Manager'
    WHEN 'accountant' THEN 'Accountant'
    ELSE 'Finance Viewer' END;
  business_date_value := public.organization_business_date(p_org_id, now());
  old_snapshot := jsonb_build_object(
    'role', current_role_value, 'full_name', employee_record.full_name,
    'phone', employee_record.phone, 'job_title', employee_record.job_title,
    'lifecycle_version', employee_record.lifecycle_version
  );

  UPDATE public.org_members SET role = next_role_value::public.org_role
  WHERE org_id = p_org_id AND user_id = p_target_user_id;
  UPDATE public.profiles SET full_name = full_name_value, phone = phone_value,
    title = title_value, updated_at = now()
  WHERE org_id = p_org_id AND user_id = p_target_user_id;
  UPDATE public.employees SET full_name = full_name_value, phone = phone_value, job_title = title_value
  WHERE org_id = p_org_id AND id = p_employee_id RETURNING * INTO employee_record;

  new_snapshot := jsonb_build_object(
    'role', next_role_value, 'full_name', employee_record.full_name,
    'phone', employee_record.phone, 'job_title', employee_record.job_title,
    'lifecycle_version', employee_record.lifecycle_version
  );
  IF next_role_value <> current_role_value THEN
    PERFORM set_config('app.hr_structure_command', 'trusted', true);
    INSERT INTO public.employee_career_events(
      employee_id, event_type, previous_value, new_value, effective_date, notes, created_by
    ) VALUES (
      p_employee_id, 'role_change', old_snapshot, new_snapshot, business_date_value,
      'Atomic finance-team role command', p_actor_user_id
    );
  END IF;

  event_payload := jsonb_build_object(
    'event_type', 'finance.team_configured', 'employee_id', p_employee_id,
    'user_id', p_target_user_id, 'role', next_role_value,
    'lifecycle_version', employee_record.lifecycle_version, 'actor_user_id', p_actor_user_id
  );
  INSERT INTO public.business_events(
    org_id, source_type, business_key, event_version, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'finance_team', 'configured:' || p_command_id::text, employee_record.lifecycle_version,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id, business_event_id, topic, payload, payload_hash)
  VALUES(p_org_id, event_id_value, 'finance.team_configured', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs(
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'finance.team_configured',
    'employee', p_employee_id::text, 'success', 200,
    jsonb_build_object('command_id', p_command_id, 'old', old_snapshot, 'new', new_snapshot)
  );

  result_value := jsonb_build_object(
    'employee_id', p_employee_id, 'user_id', p_target_user_id,
    'role', next_role_value, 'lifecycle_version', employee_record.lifecycle_version
  );
  UPDATE public.finance_team_commands SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = p_command_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_finance_team_command(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_finance_team_command(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  TO service_role;
