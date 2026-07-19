-- v92: atomic, replay-safe sales-team configuration and assignment lifecycle.

CREATE TABLE IF NOT EXISTS public.sales_team_commands (
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
CREATE INDEX IF NOT EXISTS idx_sales_team_commands_org_created
  ON public.sales_team_commands(org_id, created_at DESC);
ALTER TABLE public.sales_team_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_team_commands_service_only ON public.sales_team_commands;
CREATE POLICY sales_team_commands_service_only ON public.sales_team_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_sales_company_assignment_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Sales company assignments require a trusted server command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_sales_company_assignment_write ON public.sales_company_assignments;
CREATE TRIGGER trg_guard_sales_company_assignment_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_company_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_company_assignment_write();

CREATE OR REPLACE FUNCTION public.guard_employee_location_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Employee locations require a trusted server command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_employee_location_write ON public.employee_locations;
CREATE TRIGGER trg_guard_employee_location_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.employee_locations
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_location_write();

CREATE OR REPLACE FUNCTION public.execute_sales_team_command(
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
  command_record public.sales_team_commands%ROWTYPE;
  employee_record public.employees%ROWTYPE;
  actor_role_value text;
  current_role_value text;
  next_role_value text;
  title_value text;
  full_name_value text;
  phone_value text;
  national_id_value text;
  assignments_value jsonb;
  assignment_value jsonb;
  company_id_value uuid;
  assignment_role_value text;
  start_date_value date;
  end_date_value date;
  daily_target_value numeric;
  business_date_value date;
  location_id_value uuid;
  shift_id_value uuid;
  input_value jsonb;
  input_hash_value text;
  event_payload jsonb;
  event_id_value uuid;
  result_value jsonb;
  old_snapshot jsonb;
  new_snapshot jsonb;
  invalid_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL
     OR p_target_user_id IS NULL OR p_employee_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Sales-team command input is invalid.' USING ERRCODE = '22023';
  END IF;

  input_value := jsonb_build_object(
    'target_user_id', p_target_user_id,
    'employee_id', p_employee_id,
    'expected_version', p_expected_version,
    'payload', COALESCE(p_payload, '{}'::jsonb)
  );
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.sales_team_commands(
    id, org_id, actor_user_id, request_id, target_user_id, employee_id, input_hash
  ) VALUES (
    p_command_id, p_org_id, p_actor_user_id, p_request_id, p_target_user_id, p_employee_id, input_hash_value
  ) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.sales_team_commands WHERE id = p_command_id FOR UPDATE;
  IF command_record.org_id IS DISTINCT FROM p_org_id
     OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.target_user_id IS DISTINCT FROM p_target_user_id
     OR command_record.employee_id IS DISTINCT FROM p_employee_id
     OR command_record.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Sales-team command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_record.status = 'completed' THEN RETURN command_record.result; END IF;

  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin', 'sales_manager') THEN
    RAISE EXCEPTION 'Sales-team management permission is required.' USING ERRCODE = '42501';
  END IF;
  SELECT role::text INTO current_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_target_user_id AND role::text IN ('sales', 'sales_manager') FOR UPDATE;
  IF current_role_value IS NULL THEN
    RAISE EXCEPTION 'Sales-team member was not found in the organization.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO employee_record FROM public.employees
  WHERE org_id = p_org_id AND id = p_employee_id AND user_id = p_target_user_id
    AND lifecycle_status IN ('onboarding', 'active') FOR UPDATE;
  IF employee_record.id IS NULL THEN
    RAISE EXCEPTION 'Active employee identity was not found for the sales-team member.' USING ERRCODE = 'P0002';
  END IF;
  IF employee_record.lifecycle_version <> p_expected_version THEN
    RAISE EXCEPTION 'Sales-team member changed; reload and retry.' USING ERRCODE = '40001';
  END IF;

  full_name_value := btrim(COALESCE(p_payload->>'full_name', employee_record.full_name));
  phone_value := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');
  national_id_value := NULLIF(btrim(COALESCE(p_payload->>'national_id', '')), '');
  next_role_value := lower(btrim(COALESCE(p_payload->>'role', current_role_value)));
  assignments_value := p_payload->'company_assignments';
  IF length(full_name_value) < 2 OR length(full_name_value) > 200
     OR next_role_value NOT IN ('sales', 'sales_manager')
     OR jsonb_typeof(assignments_value) <> 'array' OR jsonb_array_length(assignments_value) = 0 THEN
    RAISE EXCEPTION 'Sales-team member details and at least one company assignment are required.' USING ERRCODE = '22023';
  END IF;
  IF actor_role_value = 'sales_manager' AND next_role_value <> current_role_value THEN
    RAISE EXCEPTION 'Only HR or organization administrators may change sales account roles.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO invalid_count
  FROM jsonb_array_elements(assignments_value) assignment
  WHERE NULLIF(assignment->>'company_id', '') IS NULL
     OR COALESCE(assignment->>'assignment_role', '') NOT IN ('sales', 'manager')
     OR NULLIF(assignment->>'start_date', '') IS NULL
     OR COALESCE((assignment->>'daily_target')::numeric, 0) < 0
     OR (NULLIF(assignment->>'end_date', '') IS NOT NULL
         AND (assignment->>'end_date')::date < (assignment->>'start_date')::date);
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'A sales company assignment is invalid.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO invalid_count FROM (
    SELECT assignment->>'company_id' AS company_id
    FROM jsonb_array_elements(assignments_value) assignment
    GROUP BY assignment->>'company_id' HAVING count(*) > 1
  ) duplicates;
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'A sales company can only be assigned once per command.' USING ERRCODE = '23505';
  END IF;
  SELECT count(*)::integer INTO invalid_count
  FROM jsonb_array_elements(assignments_value) assignment
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id AND company.id = (assignment->>'company_id')::uuid AND company.is_active
  );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'A sales company is outside the active organization.' USING ERRCODE = '23503';
  END IF;
  IF next_role_value = 'sales' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(assignments_value) assignment WHERE assignment->>'assignment_role' = 'manager'
  ) THEN
    RAISE EXCEPTION 'A sales account cannot receive a company-manager assignment.' USING ERRCODE = '23514';
  END IF;
  IF next_role_value = 'sales_manager' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(assignments_value) assignment WHERE assignment->>'assignment_role' = 'manager'
  ) THEN
    RAISE EXCEPTION 'A sales manager requires at least one company-manager assignment.' USING ERRCODE = '23514';
  END IF;

  IF actor_role_value = 'sales_manager' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(assignments_value) assignment
      WHERE NOT EXISTS (
        SELECT 1 FROM public.sales_company_assignments managed
        WHERE managed.organization_id = p_org_id AND managed.user_id = p_actor_user_id
          AND managed.company_id = (assignment->>'company_id')::uuid
          AND managed.assignment_role = 'manager' AND managed.is_active
          AND managed.start_date <= public.organization_business_date(p_org_id, now())
          AND (managed.end_date IS NULL OR managed.end_date >= public.organization_business_date(p_org_id, now()))
      )
    ) THEN
      RAISE EXCEPTION 'Sales managers may only assign companies they currently manage.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.sales_company_assignments target_assignment
      JOIN public.sales_company_assignments managed
        ON managed.organization_id = target_assignment.organization_id
       AND managed.company_id = target_assignment.company_id
       AND managed.user_id = p_actor_user_id AND managed.assignment_role = 'manager' AND managed.is_active
      WHERE target_assignment.organization_id = p_org_id AND target_assignment.user_id = p_target_user_id
        AND target_assignment.is_active
    ) AND NOT EXISTS (
      SELECT 1 FROM public.employee_lifecycle_commands lifecycle_command
      WHERE lifecycle_command.org_id = p_org_id AND lifecycle_command.employee_id = p_employee_id
        AND lifecycle_command.action = 'begin_onboarding' AND lifecycle_command.source_type = 'sales'
        AND lifecycle_command.actor_user_id = p_actor_user_id AND lifecycle_command.status = 'completed'
    ) THEN
      RAISE EXCEPTION 'Sales manager is not authorized to modify this team member.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE((p_payload->>'location_touched')::boolean, false) THEN
    location_id_value := NULLIF(p_payload->>'location_id', '')::uuid;
    IF location_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.locations WHERE org_id = p_org_id AND id = location_id_value
    ) THEN RAISE EXCEPTION 'Attendance location is outside the organization.' USING ERRCODE = '23503'; END IF;
  ELSE
    location_id_value := employee_record.location_id;
  END IF;
  IF COALESCE((p_payload->>'shift_touched')::boolean, false) THEN
    shift_id_value := NULLIF(p_payload->>'shift_id', '')::uuid;
    IF shift_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.shifts WHERE org_id = p_org_id AND id = shift_id_value
    ) THEN RAISE EXCEPTION 'Shift is outside the organization.' USING ERRCODE = '23503'; END IF;
  END IF;

  business_date_value := public.organization_business_date(p_org_id, now());
  title_value := CASE WHEN next_role_value = 'sales_manager' THEN 'Sales Manager' ELSE 'Sales' END;
  old_snapshot := jsonb_build_object(
    'full_name', employee_record.full_name, 'phone', employee_record.phone,
    'national_id', employee_record.national_id, 'job_title', employee_record.job_title,
    'location_id', employee_record.location_id, 'sales_role', current_role_value
  );

  UPDATE public.org_members SET role = next_role_value::public.org_role
  WHERE org_id = p_org_id AND user_id = p_target_user_id;
  UPDATE public.profiles SET full_name = full_name_value, phone = phone_value, title = title_value, updated_at = now()
  WHERE org_id = p_org_id AND user_id = p_target_user_id;
  UPDATE public.employees SET full_name = full_name_value, phone = phone_value, national_id = national_id_value,
    job_title = title_value,
    location_id = CASE WHEN COALESCE((p_payload->>'location_touched')::boolean, false) THEN location_id_value ELSE location_id END
  WHERE org_id = p_org_id AND id = p_employee_id
  RETURNING * INTO employee_record;

  IF COALESCE((p_payload->>'location_touched')::boolean, false) THEN
    UPDATE public.employee_locations SET assigned_to = business_date_value, is_primary = false
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND assigned_to IS NULL
      AND (location_id_value IS NULL OR location_id <> location_id_value);
    UPDATE public.employee_locations SET is_primary = true
    WHERE org_id = p_org_id AND employee_id = p_employee_id AND assigned_to IS NULL
      AND location_id = location_id_value;
    IF location_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.employee_locations
      WHERE org_id = p_org_id AND employee_id = p_employee_id
        AND location_id = location_id_value AND assigned_to IS NULL
    ) THEN
      INSERT INTO public.employee_locations(org_id, employee_id, location_id, is_primary, assigned_from)
      VALUES(p_org_id, p_employee_id, location_id_value, true, business_date_value);
    END IF;
  END IF;

  IF COALESCE((p_payload->>'shift_touched')::boolean, false) THEN
    UPDATE public.employee_shifts
    SET end_date = business_date_value - 1, version = version + 1
    WHERE org_id = p_org_id AND employee_id = p_employee_id
      AND COALESCE(start_date, business_date_value) <= business_date_value
      AND (end_date IS NULL OR end_date >= business_date_value)
      AND (shift_id_value IS NULL OR shift_id <> shift_id_value);
    IF shift_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.employee_shifts
      WHERE org_id = p_org_id AND employee_id = p_employee_id AND shift_id = shift_id_value
        AND COALESCE(start_date, business_date_value) <= business_date_value
        AND (end_date IS NULL OR end_date >= business_date_value)
    ) THEN
      INSERT INTO public.employee_shifts(org_id, employee_id, shift_id, start_date, end_date, version)
      VALUES(p_org_id, p_employee_id, shift_id_value, business_date_value, NULL, 1);
    END IF;
  END IF;

  IF actor_role_value IN ('admin', 'hr_admin') THEN
    UPDATE public.sales_company_assignments
    SET is_active = false, end_date = GREATEST(start_date, business_date_value)
    WHERE organization_id = p_org_id AND user_id = p_target_user_id AND is_active;
  ELSE
    UPDATE public.sales_company_assignments existing
    SET is_active = false, end_date = GREATEST(existing.start_date, business_date_value)
    WHERE existing.organization_id = p_org_id AND existing.user_id = p_target_user_id AND existing.is_active
      AND EXISTS (
        SELECT 1 FROM public.sales_company_assignments managed
        WHERE managed.organization_id = p_org_id AND managed.user_id = p_actor_user_id
          AND managed.company_id = existing.company_id AND managed.assignment_role = 'manager' AND managed.is_active
      );
  END IF;
  FOR assignment_value IN SELECT value FROM jsonb_array_elements(assignments_value)
  LOOP
    company_id_value := (assignment_value->>'company_id')::uuid;
    assignment_role_value := assignment_value->>'assignment_role';
    start_date_value := (assignment_value->>'start_date')::date;
    end_date_value := NULLIF(assignment_value->>'end_date', '')::date;
    daily_target_value := COALESCE((assignment_value->>'daily_target')::numeric, 0);
    INSERT INTO public.sales_company_assignments(
      organization_id, company_id, user_id, assignment_role, start_date, end_date,
      daily_target, target_notes, notes, is_active, created_by
    ) VALUES (
      p_org_id, company_id_value, p_target_user_id, assignment_role_value,
      start_date_value, end_date_value, daily_target_value,
      NULLIF(btrim(assignment_value->>'target_notes'), ''), NULLIF(btrim(assignment_value->>'notes'), ''),
      true, p_actor_user_id
    );
  END LOOP;

  new_snapshot := jsonb_build_object(
    'full_name', employee_record.full_name, 'phone', employee_record.phone,
    'national_id', employee_record.national_id, 'job_title', employee_record.job_title,
    'location_id', employee_record.location_id, 'sales_role', next_role_value,
    'company_assignments', assignments_value, 'lifecycle_version', employee_record.lifecycle_version
  );
  IF next_role_value <> current_role_value THEN
    PERFORM set_config('app.hr_structure_command', 'trusted', true);
    INSERT INTO public.employee_career_events(
      employee_id, event_type, previous_value, new_value, effective_date, notes, created_by
    ) VALUES (
      p_employee_id, CASE WHEN next_role_value = 'sales_manager' THEN 'promoted' ELSE 'role_change' END,
      old_snapshot, new_snapshot, business_date_value, 'Atomic sales-team role command', p_actor_user_id
    );
  END IF;

  event_payload := jsonb_build_object(
    'event_type', 'sales.team_configured', 'employee_id', p_employee_id,
    'user_id', p_target_user_id, 'role', next_role_value,
    'lifecycle_version', employee_record.lifecycle_version, 'actor_user_id', p_actor_user_id
  );
  INSERT INTO public.business_events(
    org_id, source_type, business_key, event_version, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'sales_team', 'configured:' || p_command_id::text, employee_record.lifecycle_version,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id, business_event_id, topic, payload, payload_hash)
  VALUES(p_org_id, event_id_value, 'sales.team_configured', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs(
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'sales.team_configured',
    'employee', p_employee_id::text, 'success', 200,
    jsonb_build_object('command_id', p_command_id, 'old', old_snapshot, 'new', new_snapshot)
  );

  result_value := jsonb_build_object(
    'employee_id', p_employee_id, 'user_id', p_target_user_id,
    'role', next_role_value, 'lifecycle_version', employee_record.lifecycle_version
  );
  UPDATE public.sales_team_commands SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = p_command_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_sales_team_command(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sales_team_command(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  TO service_role;

-- Sales access follows the employee lifecycle; offboarding must close active company assignments.
CREATE OR REPLACE FUNCTION public.close_sales_assignments_on_employee_offboard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE effective_date_value date;
BEGIN
  IF NEW.lifecycle_status = 'offboarded' AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
     AND NEW.user_id IS NOT NULL THEN
    effective_date_value := COALESCE(NEW.termination_date, public.organization_business_date(NEW.org_id, now()));
    UPDATE public.sales_company_assignments
    SET is_active = false, end_date = GREATEST(start_date, effective_date_value)
    WHERE organization_id = NEW.org_id AND user_id = NEW.user_id AND is_active;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_close_sales_assignments_on_employee_offboard ON public.employees;
CREATE TRIGGER trg_close_sales_assignments_on_employee_offboard
  AFTER UPDATE OF lifecycle_status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.close_sales_assignments_on_employee_offboard();
