-- Atomic, idempotent leave submission with durable approval routing.

ALTER TABLE public.leave_commands DROP CONSTRAINT IF EXISTS leave_commands_action_check;
ALTER TABLE public.leave_commands ADD CONSTRAINT leave_commands_action_check
  CHECK (action IN ('refresh_balance', 'adjust_balance', 'cancel_request', 'submit_request'));

CREATE OR REPLACE FUNCTION public.submit_leave_request(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_leave_request_id uuid, p_employee_id uuid, p_leave_type text,
  p_start_date date, p_end_date date, p_reason text,
  p_attachment_path text DEFAULT NULL, p_attachment_name text DEFAULT NULL
)
RETURNS SETOF public.leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.leave_commands%ROWTYPE; request_row public.leave_requests%ROWTYPE;
  employee_row public.employees%ROWTYPE; requester_role text; input_value jsonb; hash_value text;
  attachment_required_value boolean; direct_hr_review boolean; total_steps_value integer;
  current_step_value integer; manager_status_value text; manager_employee_id uuid;
  recipient_ids uuid[] := ARRAY[]::uuid[]; event_id_value uuid; outbox_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO requester_role FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF requester_role NOT IN ('employee', 'training_manager', 'hr_admin', 'hr_recruitment', 'sales', 'sales_manager') THEN
    RAISE EXCEPTION 'Self-service leave is forbidden for this role.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO employee_row FROM public.employees
  WHERE org_id = p_org_id AND id = p_employee_id AND user_id = p_actor_user_id
    AND lifecycle_status NOT IN ('offboarded', 'archived') FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Active employee profile is required.' USING ERRCODE = '42501'; END IF;
  IF p_leave_type NOT IN ('sick', 'vacation', 'emergency', 'unpaid', 'weekly', 'marriage', 'bereavement')
     OR p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Leave type and date range are invalid.' USING ERRCODE = '23514'; END IF;
  attachment_required_value := p_leave_type IN ('sick', 'marriage', 'bereavement');
  IF attachment_required_value AND length(btrim(COALESCE(p_attachment_path, ''))) = 0 THEN
    RAISE EXCEPTION 'This leave type requires a scanned attachment.' USING ERRCODE = '23514'; END IF;
  IF p_attachment_path IS NOT NULL AND p_attachment_path NOT LIKE
    'leave-requests/' || p_org_id::text || '/' || p_employee_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Leave attachment is not command scoped.' USING ERRCODE = '23514'; END IF;
  input_value := jsonb_build_object('leave_request_id', p_leave_request_id, 'employee_id', p_employee_id,
    'leave_type', p_leave_type, 'start_date', p_start_date, 'end_date', p_end_date,
    'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''), 'attachment_path', p_attachment_path,
    'attachment_name', p_attachment_name);
  hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.leave_commands (org_id, idempotency_key, action, employee_id, leave_request_id,
    payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'submit_request', p_employee_id, NULL, hash_value, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.leave_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'submit_request' OR command_row.employee_id IS DISTINCT FROM p_employee_id
     OR (command_row.leave_request_id IS NOT NULL AND command_row.leave_request_id IS DISTINCT FROM p_leave_request_id)
     OR command_row.payload_hash <> hash_value THEN
    RAISE EXCEPTION 'Idempotency key was used for a different leave command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.leave_requests WHERE org_id = p_org_id AND id = p_leave_request_id;
    RETURN;
  END IF;

  direct_hr_review := requester_role = 'sales_manager';
  total_steps_value := CASE WHEN requester_role IN ('hr_admin', 'hr_recruitment') THEN 1 ELSE 2 END;
  current_step_value := CASE WHEN direct_hr_review THEN 2 ELSE 1 END;
  manager_status_value := CASE WHEN direct_hr_review THEN 'approved' ELSE 'pending' END;
  IF requester_role = 'sales' THEN
    SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO recipient_ids FROM public.org_members
    WHERE org_id = p_org_id AND role::text = 'sales_manager';
  ELSIF requester_role = 'sales_manager' THEN
    SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO recipient_ids FROM public.org_members
    WHERE org_id = p_org_id AND role::text IN ('admin', 'hr_admin');
  ELSIF requester_role IN ('hr_admin', 'hr_recruitment') THEN
    SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO recipient_ids FROM public.platform_admins
    WHERE role = 'superadmin' AND status = 'active';
  ELSE
    manager_employee_id := employee_row.manager_id;
    IF manager_employee_id IS NULL AND employee_row.department_id IS NOT NULL THEN
      SELECT department.manager_employee_id INTO manager_employee_id FROM public.departments department
      WHERE department.id = employee_row.department_id AND department.org_id = p_org_id;
    END IF;
    IF manager_employee_id IS NULL AND employee_row.location_id IS NOT NULL THEN
      SELECT location.manager_employee_id INTO manager_employee_id FROM public.locations location
      WHERE location.id = employee_row.location_id AND location.org_id = p_org_id;
    END IF;
    IF manager_employee_id IS NOT NULL THEN
      SELECT ARRAY[user_id] INTO recipient_ids FROM public.employees
      WHERE org_id = p_org_id AND id = manager_employee_id AND user_id IS NOT NULL;
    END IF;
    IF COALESCE(array_length(recipient_ids, 1), 0) = 0 THEN
      SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO recipient_ids FROM public.org_members
      WHERE org_id = p_org_id AND role::text IN ('admin', 'hr_admin');
    END IF;
  END IF;
  IF COALESCE(array_length(recipient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'No authorized leave reviewer is configured.' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.leave_requests (id, org_id, employee_id, leave_type, start_date, end_date,
    reason, days_count, attachment_url, attachment_name, attachment_required, status,
    manager_approval_status, hr_approval_status, current_step, total_steps, approval_history)
  VALUES (p_leave_request_id, p_org_id, p_employee_id, p_leave_type::public.leave_type,
    p_start_date, p_end_date, NULLIF(btrim(COALESCE(p_reason, '')), ''), (p_end_date - p_start_date) + 1,
    NULLIF(btrim(COALESCE(p_attachment_path, '')), ''), NULLIF(btrim(COALESCE(p_attachment_name, '')), ''),
    attachment_required_value, 'pending', manager_status_value, 'pending', current_step_value,
    total_steps_value, jsonb_build_array(jsonb_build_object('step', current_step_value,
      'status', 'submitted', 'at', now(), 'by', p_actor_user_id, 'command_id', p_command_id)))
  RETURNING * INTO request_row;
  SELECT id INTO event_id_value FROM public.business_events
  WHERE org_id = p_org_id AND source_type = 'leave.submitted' AND business_key = request_row.id::text;
  IF event_id_value IS NULL THEN RAISE EXCEPTION 'Leave submission event was not recorded.' USING ERRCODE = 'P0001'; END IF;
  outbox_payload := jsonb_build_object('event_type', 'leave.request_submitted',
    'leave_request_id', request_row.id, 'employee_id', request_row.employee_id,
    'employee_name', employee_row.full_name, 'leave_type', p_leave_type,
    'start_date', p_start_date, 'end_date', p_end_date, 'days', request_row.days_count,
    'recipient_user_ids', to_jsonb(recipient_ids));
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id_value, 'leave.request_submitted', outbox_payload,
    encode(digest(outbox_payload::text, 'sha256'), 'hex'))
  ON CONFLICT (business_event_id, topic) DO NOTHING;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, requester_role, 'leave.request_submitted',
    'leave_request', request_row.id::text, 'success', 201,
    jsonb_build_object('employee_id', p_employee_id, 'leave_type', p_leave_type,
      'start_date', p_start_date, 'end_date', p_end_date, 'has_attachment', p_attachment_path IS NOT NULL));
  UPDATE public.leave_commands SET status = 'completed', leave_request_id = request_row.id,
    result = to_jsonb(request_row), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT request_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_leave_request(uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, text, text, text)
  TO service_role;
