-- Enforce task state transitions and atomically publish task activity.

UPDATE storage.buckets SET public = false WHERE id = 'task-attachments';

ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.task_assignments DROP CONSTRAINT IF EXISTS task_assignments_version_check;
ALTER TABLE public.task_assignments ADD CONSTRAINT task_assignments_version_check CHECK (version > 0);

CREATE TABLE IF NOT EXISTS public.task_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  command_type text NOT NULL CHECK (command_type IN ('transition', 'add_update')),
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, id)
);
ALTER TABLE public.task_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_commands_service_only ON public.task_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_task_assignment_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Task status may only be changed through a trusted command.' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('in_progress', 'rejected', 'delayed')) OR
      (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'rejected', 'delayed')) OR
      (OLD.status = 'delayed' AND NEW.status IN ('in_progress', 'completed', 'rejected')) OR
      (NEW.employee_id IS DISTINCT FROM OLD.employee_id AND NEW.status = 'pending')
    ) THEN
      RAISE EXCEPTION 'Illegal task transition from % to %.', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_task_assignment_transition ON public.task_assignments;
CREATE TRIGGER trg_guard_task_assignment_transition BEFORE UPDATE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_assignment_transition();

CREATE OR REPLACE FUNCTION public.transition_task_assignment(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_assignment_id uuid, p_expected_version integer, p_target_status text,
  p_note text, p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_row public.task_assignments%ROWTYPE;
  task_row public.tasks%ROWTYPE;
  update_row public.task_updates%ROWTYPE;
  actor_employee_id uuid;
  input_value jsonb;
  input_hash_value text;
  command_row public.task_commands%ROWTYPE;
  event_payload jsonb;
  event_id uuid;
  progress_value integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_target_status NOT IN ('in_progress', 'completed', 'rejected', 'delayed')
     OR jsonb_typeof(COALESCE(p_attachments, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'Task transition input is invalid.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO actor_employee_id FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT * INTO assignment_row FROM public.task_assignments WHERE org_id = p_org_id AND id = p_assignment_id FOR UPDATE;
  IF assignment_row.id IS NULL OR assignment_row.employee_id IS DISTINCT FROM actor_employee_id THEN
    RAISE EXCEPTION 'Task assignment was not found for this employee.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO task_row FROM public.tasks WHERE org_id = p_org_id AND id = assignment_row.task_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_attachments, '[]'::jsonb)) attachment
    WHERE attachment->>'scan_status' <> 'clean' OR attachment->>'path' NOT LIKE p_org_id::text || '/' || task_row.id::text || '/' || p_command_id::text || '/%') THEN
    RAISE EXCEPTION 'Every task attachment must be scanned and tenant scoped.' USING ERRCODE = '23514';
  END IF;
  input_value := jsonb_build_object('assignment_id', p_assignment_id, 'expected_version', p_expected_version,
    'status', p_target_status, 'note', NULLIF(btrim(p_note), ''), 'attachments', COALESCE(p_attachments, '[]'::jsonb));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.task_commands (id, org_id, task_id, actor_user_id, command_type, input_hash, request_id)
  VALUES (p_command_id, p_org_id, task_row.id, p_actor_user_id, 'transition', input_hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.task_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Task command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;
  IF assignment_row.version <> p_expected_version THEN RAISE EXCEPTION 'Task assignment version conflict.' USING ERRCODE = '40001'; END IF;
  UPDATE public.task_assignments SET status = p_target_status::public.task_status, version = version + 1
    WHERE id = assignment_row.id RETURNING * INTO assignment_row;
  UPDATE public.tasks SET status = p_target_status::public.task_status, updated_at = now() WHERE id = task_row.id RETURNING * INTO task_row;
  progress_value := CASE p_target_status WHEN 'completed' THEN 100 WHEN 'in_progress' THEN 50 ELSE 0 END;
  INSERT INTO public.task_updates (org_id, task_id, employee_id, status, progress, note, attachments)
  VALUES (p_org_id, task_row.id, actor_employee_id, p_target_status::public.task_status, progress_value,
    COALESCE(NULLIF(left(btrim(p_note), 2000), ''), CASE p_target_status
      WHEN 'completed' THEN 'Task completed' WHEN 'in_progress' THEN 'Task started'
      WHEN 'delayed' THEN 'Task delayed' ELSE 'Task rejected' END), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING * INTO update_row;
  event_payload := jsonb_build_object('event_type', 'task.status_changed', 'task_id', task_row.id,
    'assignment_id', assignment_row.id, 'employee_id', assignment_row.employee_id,
    'status', assignment_row.status, 'title', task_row.title, 'version', assignment_row.version,
    'actor_user_id', p_actor_user_id);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'task', 'transition:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'task.status_changed', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.task_commands SET status = 'completed', completed_at = now(), result = jsonb_build_object(
    'assignment', to_jsonb(assignment_row), 'update', to_jsonb(update_row)) WHERE id = p_command_id;
  RETURN jsonb_build_object('assignment', to_jsonb(assignment_row), 'update', to_jsonb(update_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.add_task_update(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_task_id uuid, p_note text, p_progress integer DEFAULT NULL, p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF public.task_updates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  task_row public.tasks%ROWTYPE;
  update_row public.task_updates%ROWTYPE;
  actor_employee_id uuid;
  actor_role_value text;
  assignment_status public.task_status;
  input_value jsonb;
  input_hash_value text;
  command_row public.task_commands%ROWTYPE;
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(COALESCE(p_attachments, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'Task attachment input is invalid.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL AND jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Task note or attachment is required.' USING ERRCODE = '22023';
  END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT id INTO actor_employee_id FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT * INTO task_row FROM public.tasks WHERE org_id = p_org_id AND id = p_task_id FOR UPDATE;
  IF task_row.id IS NULL THEN RAISE EXCEPTION 'Task was not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT status INTO assignment_status FROM public.task_assignments WHERE org_id = p_org_id AND task_id = task_row.id
    AND employee_id = actor_employee_id LIMIT 1;
  IF assignment_status IS NULL AND NOT (
    actor_role_value = 'admin' OR
    (actor_role_value = 'hr_admin' AND task_row.created_by = p_actor_user_id) OR
    (actor_role_value = 'training_manager' AND EXISTS (SELECT 1 FROM public.task_assignments assignment
      JOIN public.employees employee ON employee.org_id = p_org_id AND employee.id = assignment.employee_id
      WHERE assignment.org_id = p_org_id AND assignment.task_id = task_row.id
        AND (employee.manager_id = actor_employee_id OR employee.department_id IN
          (SELECT id FROM public.departments WHERE org_id = p_org_id AND manager_employee_id = actor_employee_id)
        OR employee.location_id IN (SELECT id FROM public.locations WHERE org_id = p_org_id AND manager_employee_id = actor_employee_id))))
  ) THEN RAISE EXCEPTION 'Task is outside the actor scope.' USING ERRCODE = '42501'; END IF;
  assignment_status := COALESCE(assignment_status, task_row.status);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_attachments, '[]'::jsonb)) attachment
    WHERE attachment->>'scan_status' <> 'clean' OR attachment->>'path' NOT LIKE p_org_id::text || '/' || task_row.id::text || '/' || p_command_id::text || '/%') THEN
    RAISE EXCEPTION 'Every task attachment must be scanned and tenant scoped.' USING ERRCODE = '23514';
  END IF;
  input_value := jsonb_build_object('task_id', p_task_id, 'note', NULLIF(btrim(p_note), ''),
    'progress', p_progress, 'attachments', COALESCE(p_attachments, '[]'::jsonb));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.task_commands (id, org_id, task_id, actor_user_id, command_type, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_task_id, p_actor_user_id, 'add_update', input_hash_value, p_request_id) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.task_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Task command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    SELECT * INTO update_row FROM public.task_updates WHERE id = (command_row.result->>'update_id')::uuid;
    RETURN NEXT update_row; RETURN;
  END IF;
  INSERT INTO public.task_updates (org_id, task_id, employee_id, status, progress, note, attachments)
  VALUES (p_org_id, task_row.id, actor_employee_id, assignment_status,
    LEAST(GREATEST(COALESCE(p_progress, CASE assignment_status WHEN 'completed' THEN 100 WHEN 'in_progress' THEN 50 ELSE 0 END), 0), 100),
    COALESCE(NULLIF(left(btrim(p_note), 2000), ''), 'Attachment added'), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING * INTO update_row;
  event_payload := jsonb_build_object('event_type', 'task.update_added', 'task_id', task_row.id,
    'employee_id', actor_employee_id, 'status', assignment_status, 'title', task_row.title,
    'note_preview', left(update_row.note, 200), 'actor_user_id', p_actor_user_id);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'task', 'update:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'task.update_added', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.task_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('update_id', update_row.id) WHERE id = p_command_id;
  RETURN NEXT update_row;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_task_assignment(uuid, uuid, uuid, uuid, uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_task_update(uuid, uuid, uuid, uuid, uuid, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_task_assignment(uuid, uuid, uuid, uuid, uuid, integer, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_task_update(uuid, uuid, uuid, uuid, uuid, text, integer, jsonb) TO service_role;
