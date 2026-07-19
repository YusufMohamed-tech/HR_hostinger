-- Atomic, idempotent schedule commands with optimistic concurrency and overlap control.

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_version_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_version_check CHECK (version > 0);
ALTER TABLE public.employee_shifts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.employee_shifts DROP CONSTRAINT IF EXISTS employee_shifts_version_check;
ALTER TABLE public.employee_shifts ADD CONSTRAINT employee_shifts_version_check CHECK (version > 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.shifts GROUP BY org_id, lower(btrim(name)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized shift names must be resolved before applying schedule integrity controls.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS shifts_org_normalized_name_unique
  ON public.shifts(org_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.schedule_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  command_type text NOT NULL CHECK (command_type IN (
    'save_shift', 'delete_shift', 'assign_shift', 'remove_assignment'
  )),
  target_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_commands_org_created
  ON public.schedule_commands(org_id, created_at DESC);
ALTER TABLE public.schedule_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_commands_service_only ON public.schedule_commands;
CREATE POLICY schedule_commands_service_only ON public.schedule_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_trusted_schedule_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Schedule writes require a trusted command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_trusted_shift_write ON public.shifts;
CREATE TRIGGER trg_guard_trusted_shift_write BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_schedule_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_employee_shift_write ON public.employee_shifts;
CREATE TRIGGER trg_guard_trusted_employee_shift_write BEFORE INSERT OR UPDATE OR DELETE ON public.employee_shifts
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_schedule_write();

CREATE OR REPLACE FUNCTION public.execute_schedule_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_target_id uuid,
  p_expected_version integer,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.schedule_commands%ROWTYPE;
  shift_row public.shifts%ROWTYPE;
  assignment_row public.employee_shifts%ROWTYPE;
  actor_role_value text;
  input_value jsonb;
  input_hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_topic text;
  event_id uuid;
  employee_user_id uuid;
  start_value date;
  end_value date;
  assignment_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_command_type NOT IN ('save_shift', 'delete_shift', 'assign_shift', 'remove_assignment')
     OR p_target_id IS NULL OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Schedule command input is invalid.' USING ERRCODE = '22023';
  END IF;

  input_value := jsonb_build_object(
    'command_type', p_command_type,
    'target_id', p_target_id,
    'expected_version', p_expected_version,
    'payload', COALESCE(p_payload, '{}'::jsonb)
  );
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  SELECT * INTO command_row FROM public.schedule_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.id IS NOT NULL THEN
    IF command_row.org_id IS DISTINCT FROM p_org_id
       OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR command_row.command_type IS DISTINCT FROM p_command_type
       OR command_row.target_id IS DISTINCT FROM p_target_id
       OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
      RAISE EXCEPTION 'Schedule command id was reused with different input.' USING ERRCODE = '23505';
    END IF;
    RETURN command_row.result;
  END IF;

  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'super_admin', 'hr_admin') THEN
    RAISE EXCEPTION 'Schedule management permission is required.' USING ERRCODE = '42501';
  END IF;

  IF p_command_type = 'save_shift' THEN
    IF NULLIF(btrim(p_payload->>'name'), '') IS NULL
       OR length(btrim(p_payload->>'name')) > 160
       OR p_payload->>'shift_type' NOT IN ('morning', 'night', 'flexible')
       OR NULLIF(p_payload->>'start_time', '') IS NULL
       OR NULLIF(p_payload->>'end_time', '') IS NULL THEN
      RAISE EXCEPTION 'Shift details are invalid.' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'location_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.locations WHERE org_id = p_org_id AND id = (p_payload->>'location_id')::uuid
    ) THEN
      RAISE EXCEPTION 'Shift location is outside the organization.' USING ERRCODE = '23514';
    END IF;

    IF p_expected_version IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.shifts WHERE id = p_target_id) THEN
        RAISE EXCEPTION 'Shift id already exists without this command.' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.shifts (
        id, org_id, name, shift_type, start_time, end_time, location_id, version
      ) VALUES (
        p_target_id, p_org_id, btrim(p_payload->>'name'), (p_payload->>'shift_type')::public.shift_type,
        (p_payload->>'start_time')::time, (p_payload->>'end_time')::time,
        NULLIF(p_payload->>'location_id', '')::uuid, 1
      ) RETURNING * INTO shift_row;
      event_topic := 'schedule.shift_created';
    ELSE
      SELECT * INTO shift_row FROM public.shifts
      WHERE org_id = p_org_id AND id = p_target_id FOR UPDATE;
      IF shift_row.id IS NULL THEN RAISE EXCEPTION 'Shift was not found.' USING ERRCODE = 'P0002'; END IF;
      IF shift_row.version <> p_expected_version THEN RAISE EXCEPTION 'Shift version conflict.' USING ERRCODE = '40001'; END IF;
      UPDATE public.shifts SET
        name = btrim(p_payload->>'name'),
        shift_type = (p_payload->>'shift_type')::public.shift_type,
        start_time = (p_payload->>'start_time')::time,
        end_time = (p_payload->>'end_time')::time,
        location_id = NULLIF(p_payload->>'location_id', '')::uuid,
        version = version + 1,
        updated_at = now()
      WHERE id = shift_row.id RETURNING * INTO shift_row;
      event_topic := 'schedule.shift_updated';
    END IF;
    result_value := jsonb_build_object('shift', to_jsonb(shift_row));
    event_payload := jsonb_build_object('shift_id', shift_row.id, 'name', shift_row.name,
      'version', shift_row.version, 'actor_user_id', p_actor_user_id);

  ELSIF p_command_type = 'delete_shift' THEN
    SELECT * INTO shift_row FROM public.shifts
    WHERE org_id = p_org_id AND id = p_target_id FOR UPDATE;
    IF shift_row.id IS NULL THEN RAISE EXCEPTION 'Shift was not found.' USING ERRCODE = 'P0002'; END IF;
    IF p_expected_version IS NULL OR shift_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'Shift version conflict.' USING ERRCODE = '40001';
    END IF;
    SELECT count(*)::integer INTO assignment_count FROM public.employee_shifts
    WHERE org_id = p_org_id AND shift_id = shift_row.id;
    DELETE FROM public.shifts WHERE id = shift_row.id;
    event_topic := 'schedule.shift_deleted';
    result_value := jsonb_build_object('shift_id', shift_row.id, 'deleted_assignments', assignment_count);
    event_payload := result_value || jsonb_build_object('name', shift_row.name,
      'version', shift_row.version, 'actor_user_id', p_actor_user_id);

  ELSIF p_command_type = 'assign_shift' THEN
    start_value := COALESCE(NULLIF(p_payload->>'start_date', '')::date,
      public.organization_business_date(p_org_id, now()));
    end_value := NULLIF(p_payload->>'end_date', '')::date;
    IF end_value IS NOT NULL AND end_value < start_value THEN
      RAISE EXCEPTION 'Assignment end date cannot precede its start date.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO shift_row FROM public.shifts
    WHERE org_id = p_org_id AND id = NULLIF(p_payload->>'shift_id', '')::uuid;
    IF shift_row.id IS NULL THEN RAISE EXCEPTION 'Shift was not found.' USING ERRCODE = 'P0002'; END IF;
    SELECT user_id INTO employee_user_id FROM public.employees
    WHERE org_id = p_org_id AND id = NULLIF(p_payload->>'employee_id', '')::uuid
      AND lifecycle_status = 'active' AND lower(status::text) = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'An active employee is required.' USING ERRCODE = '23514'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || (p_payload->>'employee_id'), 0));
    IF EXISTS (
      SELECT 1 FROM public.employee_shifts existing
      WHERE existing.org_id = p_org_id
        AND existing.employee_id = (p_payload->>'employee_id')::uuid
        AND daterange(COALESCE(existing.start_date, '-infinity'::date),
          COALESCE(existing.end_date, 'infinity'::date), '[]')
          && daterange(start_value, COALESCE(end_value, 'infinity'::date), '[]')
    ) THEN
      RAISE EXCEPTION 'Employee already has an overlapping shift assignment.' USING ERRCODE = '23P01';
    END IF;
    INSERT INTO public.employee_shifts (
      id, org_id, employee_id, shift_id, start_date, end_date, version
    ) VALUES (
      p_target_id, p_org_id, (p_payload->>'employee_id')::uuid, shift_row.id,
      start_value, end_value, 1
    ) RETURNING * INTO assignment_row;
    event_topic := 'schedule.assignment_assigned';
    result_value := jsonb_build_object('assignment', to_jsonb(assignment_row));
    event_payload := jsonb_build_object('assignment_id', assignment_row.id,
      'employee_id', assignment_row.employee_id, 'employee_user_id', employee_user_id,
      'shift_id', shift_row.id, 'shift_name', shift_row.name, 'start_date', start_value,
      'end_date', end_value, 'version', assignment_row.version, 'actor_user_id', p_actor_user_id);

  ELSE
    SELECT * INTO assignment_row FROM public.employee_shifts
    WHERE org_id = p_org_id AND id = p_target_id FOR UPDATE;
    IF assignment_row.id IS NULL THEN RAISE EXCEPTION 'Shift assignment was not found.' USING ERRCODE = 'P0002'; END IF;
    IF p_expected_version IS NULL OR assignment_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'Shift assignment version conflict.' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO shift_row FROM public.shifts
    WHERE org_id = p_org_id AND id = assignment_row.shift_id;
    SELECT user_id INTO employee_user_id FROM public.employees
    WHERE org_id = p_org_id AND id = assignment_row.employee_id;
    DELETE FROM public.employee_shifts WHERE id = assignment_row.id;
    event_topic := 'schedule.assignment_removed';
    result_value := jsonb_build_object('assignment_id', assignment_row.id);
    event_payload := jsonb_build_object('assignment_id', assignment_row.id,
      'employee_id', assignment_row.employee_id, 'employee_user_id', employee_user_id,
      'shift_id', assignment_row.shift_id, 'shift_name', shift_row.name,
      'version', assignment_row.version, 'actor_user_id', p_actor_user_id);
  END IF;

  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'schedule', event_topic || ':' || p_command_id::text,
    COALESCE(shift_row.version, assignment_row.version, 1), event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id,
    p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, event_topic, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, event_topic,
    CASE WHEN p_command_type IN ('save_shift', 'delete_shift') THEN 'shift' ELSE 'shift_assignment' END,
    p_target_id::text, 'success', CASE WHEN p_expected_version IS NULL THEN 201 ELSE 200 END,
    jsonb_build_object('command_id', p_command_id, 'expected_version', p_expected_version)
  );
  INSERT INTO public.schedule_commands (
    id, org_id, actor_user_id, request_id, command_type, target_id, input_hash, result
  ) VALUES (
    p_command_id, p_org_id, p_actor_user_id, p_request_id, p_command_type,
    p_target_id, input_hash_value, result_value
  );
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_schedule_command(uuid, uuid, uuid, uuid, text, uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_schedule_command(uuid, uuid, uuid, uuid, text, uuid, integer, jsonb)
  TO service_role;
