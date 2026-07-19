-- Route every task write through one tenant-scoped, idempotent transaction.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_version_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_version_check CHECK (version > 0);

ALTER TABLE public.task_commands DROP CONSTRAINT IF EXISTS task_commands_command_type_check;
ALTER TABLE public.task_commands ADD CONSTRAINT task_commands_command_type_check
  CHECK (command_type IN ('transition', 'add_update', 'save'));

CREATE OR REPLACE FUNCTION public.guard_trusted_task_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Task writes require a trusted command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_trusted_task_write ON public.tasks;
CREATE TRIGGER trg_guard_trusted_task_write BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_task_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_task_assignment_write ON public.task_assignments;
CREATE TRIGGER trg_guard_trusted_task_assignment_write BEFORE INSERT OR UPDATE OR DELETE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_task_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_task_update_write ON public.task_updates;
CREATE TRIGGER trg_guard_trusted_task_update_write BEFORE INSERT OR UPDATE OR DELETE ON public.task_updates
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_task_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_task_attachment_write ON public.task_attachments;
CREATE TRIGGER trg_guard_trusted_task_attachment_write BEFORE INSERT OR UPDATE OR DELETE ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_task_write();

CREATE OR REPLACE FUNCTION public.save_task(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_task_id uuid, p_expected_version integer, p_title text, p_description text,
  p_priority text, p_due_date date, p_assignee_employee_id uuid, p_note text,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  task_row public.tasks%ROWTYPE;
  assignment_row public.task_assignments%ROWTYPE;
  update_row public.task_updates%ROWTYPE;
  command_row public.task_commands%ROWTYPE;
  actor_employee_id uuid;
  actor_role_value text;
  assignee_user_id uuid;
  input_value jsonb;
  input_hash_value text;
  event_payload jsonb;
  event_id uuid;
  event_topic text;
  platform_actor boolean := false;
  actor_allowed boolean := false;
  is_create boolean := p_expected_version IS NULL;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL OR length(btrim(p_title)) > 160
     OR p_priority NOT IN ('low', 'medium', 'high', 'urgent')
     OR (p_expected_version IS NOT NULL AND p_expected_version < 1)
     OR jsonb_typeof(COALESCE(p_attachments, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'Task command input is invalid.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_attachments, '[]'::jsonb)) attachment
    WHERE attachment->>'scan_status' <> 'clean'
      OR attachment->>'path' NOT LIKE p_org_id::text || '/' || p_task_id::text || '/' || p_command_id::text || '/%') THEN
    RAISE EXCEPTION 'Every task attachment must be scanned and tenant scoped.' USING ERRCODE = '23514';
  END IF;

  input_value := jsonb_build_object('task_id', p_task_id, 'expected_version', p_expected_version,
    'title', btrim(p_title), 'description', NULLIF(btrim(p_description), ''), 'priority', p_priority,
    'due_date', p_due_date, 'assignee_employee_id', p_assignee_employee_id,
    'note', NULLIF(btrim(p_note), ''), 'attachments', COALESCE(p_attachments, '[]'::jsonb));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  SELECT * INTO command_row FROM public.task_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.id IS NOT NULL THEN
    IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.task_id IS DISTINCT FROM p_task_id
       OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id OR command_row.command_type <> 'save'
       OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
      RAISE EXCEPTION 'Task command id was reused with different input.' USING ERRCODE = '23505';
    END IF;
    IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;
  END IF;

  SELECT role::text INTO actor_role_value FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT id INTO actor_employee_id FROM public.employees
    WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT EXISTS (SELECT 1 FROM public.platform_admins
    WHERE user_id = p_actor_user_id AND role::text = 'superadmin' AND status = 'active') INTO platform_actor;
  SELECT user_id INTO assignee_user_id FROM public.employees
    WHERE org_id = p_org_id AND id = p_assignee_employee_id
      AND lifecycle_status = 'active' AND lower(status::text) = 'active';
  IF assignee_user_id IS NULL THEN
    RAISE EXCEPTION 'An active assignee in the organization is required.' USING ERRCODE = '23514';
  END IF;

  actor_allowed := actor_role_value IN ('admin', 'super_admin', 'hr_admin');
  IF actor_role_value = 'training_manager' THEN
    actor_allowed := actor_employee_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.org_id = p_org_id AND employee.id = p_assignee_employee_id
        AND (employee.manager_id = actor_employee_id
          OR employee.department_id IN (SELECT id FROM public.departments WHERE org_id = p_org_id AND manager_employee_id = actor_employee_id)
          OR employee.location_id IN (SELECT id FROM public.locations WHERE org_id = p_org_id AND manager_employee_id = actor_employee_id))
    );
  ELSIF platform_actor THEN
    actor_allowed := EXISTS (SELECT 1 FROM public.org_members
      WHERE org_id = p_org_id AND user_id = assignee_user_id AND role::text IN ('hr_admin', 'hr_recruitment'));
  END IF;
  IF NOT actor_allowed THEN RAISE EXCEPTION 'Task is outside the actor scope.' USING ERRCODE = '42501'; END IF;

  IF is_create THEN
    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = p_task_id) THEN
      RAISE EXCEPTION 'Task id already exists without this command.' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.tasks (id, org_id, title, description, priority, due_date, created_by, status, version)
    VALUES (p_task_id, p_org_id, btrim(p_title), NULLIF(btrim(p_description), ''), p_priority,
      p_due_date, p_actor_user_id, 'pending', 1) RETURNING * INTO task_row;
    INSERT INTO public.task_assignments (org_id, task_id, employee_id, status, version)
    VALUES (p_org_id, task_row.id, p_assignee_employee_id, 'pending', 1) RETURNING * INTO assignment_row;
    event_topic := 'task.created';
  ELSE
    SELECT * INTO task_row FROM public.tasks WHERE org_id = p_org_id AND id = p_task_id FOR UPDATE;
    IF task_row.id IS NULL THEN RAISE EXCEPTION 'Task was not found.' USING ERRCODE = 'P0002'; END IF;
    IF actor_role_value = 'hr_admin' AND task_row.created_by IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'HR administrators may update only tasks they created.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO assignment_row FROM public.task_assignments
      WHERE org_id = p_org_id AND task_id = task_row.id ORDER BY assigned_at, id LIMIT 1 FOR UPDATE;
    IF actor_role_value = 'training_manager' AND (assignment_row.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.employees employee WHERE employee.org_id = p_org_id AND employee.id = assignment_row.employee_id
        AND (employee.manager_id = actor_employee_id
          OR employee.department_id IN (SELECT id FROM public.departments WHERE org_id = p_org_id AND manager_employee_id = actor_employee_id)
          OR employee.location_id IN (SELECT id FROM public.locations WHERE org_id = p_org_id AND manager_employee_id = actor_employee_id)))) THEN
      RAISE EXCEPTION 'Manager may update only tasks already assigned to their team.' USING ERRCODE = '42501';
    END IF;
    IF task_row.version <> p_expected_version THEN RAISE EXCEPTION 'Task version conflict.' USING ERRCODE = '40001'; END IF;
    UPDATE public.tasks SET title = btrim(p_title), description = NULLIF(btrim(p_description), ''),
      priority = p_priority, due_date = p_due_date,
      status = CASE WHEN assignment_row.id IS NULL OR assignment_row.employee_id IS DISTINCT FROM p_assignee_employee_id
        THEN 'pending'::public.task_status ELSE status END,
      version = version + 1, updated_at = now()
    WHERE id = task_row.id RETURNING * INTO task_row;
    IF assignment_row.id IS NULL THEN
      INSERT INTO public.task_assignments (org_id, task_id, employee_id, status, version)
      VALUES (p_org_id, task_row.id, p_assignee_employee_id, 'pending', 1) RETURNING * INTO assignment_row;
    ELSIF assignment_row.employee_id IS DISTINCT FROM p_assignee_employee_id THEN
      UPDATE public.task_assignments SET employee_id = p_assignee_employee_id, status = 'pending', version = version + 1,
        assigned_at = now() WHERE id = assignment_row.id RETURNING * INTO assignment_row;
    END IF;
    event_topic := 'task.updated';
  END IF;

  INSERT INTO public.task_commands (id, org_id, task_id, actor_user_id, command_type, input_hash, request_id)
  VALUES (p_command_id, p_org_id, task_row.id, p_actor_user_id, 'save', input_hash_value, p_request_id)
  RETURNING * INTO command_row;
  INSERT INTO public.task_updates (org_id, task_id, employee_id, status, progress, note, attachments)
  VALUES (p_org_id, task_row.id, actor_employee_id, assignment_row.status,
    CASE assignment_row.status WHEN 'completed' THEN 100 WHEN 'in_progress' THEN 50 ELSE 0 END,
    COALESCE(NULLIF(left(btrim(p_note), 2000), ''), CASE WHEN is_create THEN 'Task assigned' ELSE 'Task details updated' END),
    COALESCE(p_attachments, '[]'::jsonb)) RETURNING * INTO update_row;
  event_payload := jsonb_build_object('event_type', event_topic, 'task_id', task_row.id,
    'assignment_id', assignment_row.id, 'employee_id', assignment_row.employee_id,
    'recipient_user_ids', jsonb_build_array(assignee_user_id), 'status', assignment_row.status,
    'title', task_row.title, 'version', task_row.version, 'note_preview', left(update_row.note, 200),
    'actor_user_id', p_actor_user_id);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'task', event_topic || ':' || p_command_id::text, task_row.version, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, event_topic, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, COALESCE(actor_role_value, 'superadmin'), event_topic,
    'task', task_row.id::text, 'success', CASE WHEN is_create THEN 201 ELSE 200 END,
    jsonb_build_object('assignment_id', assignment_row.id, 'assignee_employee_id', assignment_row.employee_id,
      'version', task_row.version));
  IF platform_actor THEN
    INSERT INTO public.platform_audit_logs (actor_user_id, actor_role, action, target_org_id,
      target_user_id, target_type, target_id, metadata)
    VALUES (p_actor_user_id, 'superadmin', event_topic, p_org_id, assignee_user_id, 'task', task_row.id::text,
      jsonb_build_object('title', task_row.title, 'priority', task_row.priority,
        'due_date', task_row.due_date, 'assignee_employee_id', assignment_row.employee_id,
        'version', task_row.version, 'request_id', p_request_id));
  END IF;
  UPDATE public.task_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('task', to_jsonb(task_row), 'assignment', to_jsonb(assignment_row),
      'update', to_jsonb(update_row)) WHERE id = p_command_id;
  RETURN jsonb_build_object('task', to_jsonb(task_row), 'assignment', to_jsonb(assignment_row),
    'update', to_jsonb(update_row));
END;
$$;

REVOKE ALL ON FUNCTION public.save_task(uuid, uuid, uuid, uuid, uuid, integer, text, text, text, date, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_task(uuid, uuid, uuid, uuid, uuid, integer, text, text, text, date, uuid, text, jsonb)
  TO service_role;
