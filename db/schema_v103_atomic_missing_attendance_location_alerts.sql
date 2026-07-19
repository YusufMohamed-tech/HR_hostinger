-- Serialize and durably enqueue the employee-without-location alert. The
-- business event is the daily idempotency record, so concurrent retries cannot
-- produce duplicate HR notifications.

CREATE OR REPLACE FUNCTION public.raise_missing_attendance_location_alert(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_record public.employees%ROWTYPE;
  business_date_value date;
  actor_role_value text;
  recipient_count_value integer;
  has_location_value boolean;
  event_payload jsonb;
  payload_hash_value text;
  event_id_value uuid;
  inserted_event boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_action NOT IN ('check_in', 'check_out') THEN
    RAISE EXCEPTION 'Missing-location alert input is invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO employee_record
  FROM public.employees
  WHERE org_id = p_org_id
    AND user_id = p_actor_user_id
    AND lifecycle_status IN ('onboarding', 'active')
  FOR UPDATE;
  IF employee_record.id IS NULL THEN
    RAISE EXCEPTION 'Active employee profile is required.' USING ERRCODE = '42501';
  END IF;

  business_date_value := public.organization_business_date(p_org_id, now());
  has_location_value := employee_record.location_id IS NOT NULL OR EXISTS (
    SELECT 1
    FROM public.employee_locations assignment
    WHERE assignment.org_id = p_org_id
      AND assignment.employee_id = employee_record.id
      AND assignment.location_id IS NOT NULL
      AND (assignment.assigned_from IS NULL OR assignment.assigned_from <= business_date_value)
      AND (assignment.assigned_to IS NULL OR assignment.assigned_to >= business_date_value)
  );
  IF has_location_value THEN
    RETURN jsonb_build_object(
      'notified', false,
      'hasLocation', true,
      'recipients', 0,
      'businessDate', business_date_value
    );
  END IF;

  SELECT role::text INTO actor_role_value
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT count(DISTINCT member.user_id)::integer INTO recipient_count_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id
    AND member.role IN ('admin', 'hr_admin')
    AND member.user_id <> p_actor_user_id;

  event_payload := jsonb_build_object(
    'event_type', 'attendance.location_missing',
    'employee_id', employee_record.id,
    'employee_name', employee_record.full_name,
    'employee_code', employee_record.employee_code,
    'actor_user_id', p_actor_user_id,
    'action', p_action,
    'business_date', business_date_value,
    'version', 1
  );
  payload_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');

  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'attendance_alert',
    'missing-location:' || employee_record.id::text || ':' || business_date_value::text,
    1, event_payload, payload_hash_value, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  ON CONFLICT (org_id, source_type, business_key) DO NOTHING
  RETURNING id INTO event_id_value;
  inserted_event := event_id_value IS NOT NULL;

  IF inserted_event THEN
    INSERT INTO public.event_outbox (
      org_id, business_event_id, topic, payload, payload_hash
    ) VALUES (
      p_org_id, event_id_value, 'attendance.location_missing',
      event_payload, payload_hash_value
    );
    INSERT INTO public.operational_audit_logs (
      org_id, request_id, actor_user_id, actor_role, action, target_type,
      target_id, outcome, status_code, metadata
    ) VALUES (
      p_org_id, p_request_id, p_actor_user_id, COALESCE(actor_role_value, 'employee'),
      'attendance.location_missing', 'employees', employee_record.id::text,
      'success', 202, event_payload
    );
  END IF;

  RETURN jsonb_build_object(
    'notified', inserted_event AND recipient_count_value > 0,
    'hasLocation', false,
    'recipients', CASE WHEN inserted_event THEN recipient_count_value ELSE 0 END,
    'businessDate', business_date_value
  );
END;
$$;

REVOKE ALL ON FUNCTION public.raise_missing_attendance_location_alert(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_missing_attendance_location_alert(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.raise_missing_attendance_location_alert(uuid, uuid, uuid, text) IS
  'Creates at most one durable missing-attendance-location alert per employee and organization business date.';
