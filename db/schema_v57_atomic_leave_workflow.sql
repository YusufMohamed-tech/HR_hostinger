-- Atomic leave review and balance ledger workflow.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.leave_balance_transactions
  DROP CONSTRAINT IF EXISTS leave_balance_transactions_transaction_type_check;
ALTER TABLE public.leave_balance_transactions
  ADD CONSTRAINT leave_balance_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'initial', 'accrual', 'manual_adjustment', 'leave_deduction', 'leave_reversal'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS leave_balance_one_request_transaction_idx
  ON public.leave_balance_transactions(leave_request_id, transaction_type)
  WHERE leave_request_id IS NOT NULL
    AND transaction_type IN ('leave_deduction', 'leave_reversal');

DO $$
DECLARE
  overlapping record;
BEGIN
  SELECT first_request.id AS first_id, second_request.id AS second_id
  INTO overlapping
  FROM public.leave_requests first_request
  JOIN public.leave_requests second_request
    ON second_request.org_id = first_request.org_id
   AND second_request.employee_id = first_request.employee_id
   AND second_request.id > first_request.id
   AND daterange(second_request.start_date, second_request.end_date, '[]')
       && daterange(first_request.start_date, first_request.end_date, '[]')
  WHERE first_request.status IN ('pending', 'approved')
    AND second_request.status IN ('pending', 'approved')
  LIMIT 1;

  IF overlapping.first_id IS NOT NULL THEN
    RAISE EXCEPTION 'Overlapping leave requests must be reconciled before launch: % and %.',
      overlapping.first_id, overlapping.second_id;
  END IF;
END $$;

ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_valid_date_range;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_valid_date_range CHECK (end_date >= start_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_requests_no_active_overlap'
      AND conrelid = 'public.leave_requests'::regclass
  ) THEN
    ALTER TABLE public.leave_requests
      ADD CONSTRAINT leave_requests_no_active_overlap
      EXCLUDE USING gist (
        org_id WITH =,
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      )
      WHERE (status IN ('pending', 'approved'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_leave_submission_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_payload jsonb;
BEGIN
  event_payload := jsonb_build_object(
    'leave_request_id', NEW.id,
    'employee_id', NEW.employee_id,
    'leave_type', NEW.leave_type,
    'start_date', NEW.start_date,
    'end_date', NEW.end_date,
    'days', COALESCE(NEW.days_count, (NEW.end_date - NEW.start_date) + 1),
    'status', NEW.status
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    actor_user_id, occurred_at, processed_at
  )
  SELECT
    NEW.org_id,
    'leave.submitted',
    NEW.id::text,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed',
    employee.user_id,
    NEW.requested_at,
    clock_timestamp()
  FROM public.employees employee
  WHERE employee.id = NEW.employee_id
    AND employee.org_id = NEW.org_id
  ON CONFLICT (org_id, source_type, business_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_leave_submission_event_trigger ON public.leave_requests;
CREATE TRIGGER record_leave_submission_event_trigger
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.record_leave_submission_event();

CREATE OR REPLACE FUNCTION public.review_leave_request(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_leave_request_id uuid,
  p_command_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS SETOF public.leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  leave_record public.leave_requests%ROWTYPE;
  employee_record public.employees%ROWTYPE;
  balance_record public.leave_balances%ROWTYPE;
  actor_role text;
  requester_role text;
  actor_employee_id uuid;
  requester_user_id uuid;
  manager_employee_id uuid;
  platform_actor boolean := false;
  authorized boolean := false;
  leave_days numeric;
  balance_before numeric;
  balance_after numeric;
  history_entry jsonb;
  event_payload jsonb;
  event_id uuid;
  notification_payload jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_leave_request_id IS NULL THEN
    RAISE EXCEPTION 'Command and leave request ids are required.' USING ERRCODE = '22023';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'rejected' AND length(btrim(COALESCE(p_note, ''))) = 0 THEN
    RAISE EXCEPTION 'A rejection note is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO leave_record
  FROM public.leave_requests
  WHERE id = p_leave_request_id AND org_id = p_org_id
  FOR UPDATE;
  IF leave_record.id IS NULL THEN
    RAISE EXCEPTION 'Leave request was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF leave_record.status::text <> 'pending' THEN
    IF leave_record.status::text = p_decision THEN
      RETURN NEXT leave_record;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Leave request is already in a terminal state.' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO employee_record
  FROM public.employees
  WHERE id = leave_record.employee_id AND org_id = p_org_id;
  requester_user_id := employee_record.user_id;
  SELECT role::text INTO requester_role
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = requester_user_id;

  SELECT role::text INTO actor_role
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT id INTO actor_employee_id
  FROM public.employees
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_actor_user_id AND role = 'superadmin' AND status = 'active'
  ) INTO platform_actor;

  SELECT COALESCE(
    employee_record.manager_id,
    department.manager_employee_id,
    location.manager_employee_id
  ) INTO manager_employee_id
  FROM public.employees employee
  LEFT JOIN public.departments department
    ON department.id = employee.department_id AND department.org_id = employee.org_id
  LEFT JOIN public.locations location
    ON location.id = employee.location_id AND location.org_id = employee.org_id
  WHERE employee.id = employee_record.id;

  IF requester_role IN ('hr_admin', 'hr_recruitment') THEN
    authorized := platform_actor;
  ELSIF COALESCE(leave_record.current_step, 1) <= 1 THEN
    authorized := platform_actor
      OR actor_role = 'admin'
      OR (requester_role = 'sales' AND actor_role = 'sales_manager')
      OR (actor_employee_id IS NOT NULL AND actor_employee_id = manager_employee_id);
  ELSE
    authorized := platform_actor OR actor_role IN ('admin', 'hr_admin');
  END IF;
  IF NOT authorized THEN
    RAISE EXCEPTION 'Actor is not authorized for the current leave step.' USING ERRCODE = '42501';
  END IF;

  history_entry := jsonb_build_object(
    'step', CASE WHEN platform_actor THEN to_jsonb('superadmin'::text) ELSE to_jsonb(COALESCE(leave_record.current_step, 1)) END,
    'status', p_decision,
    'at', clock_timestamp(),
    'by', p_actor_user_id,
    'command_id', p_command_id,
    'note', NULLIF(btrim(COALESCE(p_note, '')), '')
  );

  IF p_decision = 'approved'
     AND requester_role NOT IN ('hr_admin', 'hr_recruitment')
     AND COALESCE(leave_record.current_step, 1) < COALESCE(leave_record.total_steps, 2) THEN
    UPDATE public.leave_requests request
    SET manager_approval_status = 'approved',
        current_step = COALESCE(request.current_step, 1) + 1,
        approval_history = COALESCE(request.approval_history, '[]'::jsonb) || jsonb_build_array(history_entry)
    WHERE request.id = leave_record.id
    RETURNING request.* INTO leave_record;
    RETURN NEXT leave_record;
    RETURN;
  END IF;

  IF p_decision = 'approved' THEN
    leave_days := COALESCE(leave_record.days_count, (leave_record.end_date - leave_record.start_date) + 1);
    IF leave_days <= 0 THEN
      RAISE EXCEPTION 'Leave duration is invalid.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.leave_balances (
      org_id, employee_id, sick_remaining, vacation_remaining,
      emergency_remaining, accrual_start_date, vacation_accrued_days,
      manual_adjustment, last_accrual_calculated_at
    ) VALUES (
      p_org_id,
      employee_record.id,
      0,
      COALESCE(employee_record.leave_balance_days, 0) + COALESCE(employee_record.leave_balance_manual_adjustment, 0),
      0,
      COALESCE(employee_record.leave_accrual_start_date, employee_record.hiring_date, CURRENT_DATE),
      COALESCE(employee_record.leave_balance_days, 0),
      COALESCE(employee_record.leave_balance_manual_adjustment, 0),
      clock_timestamp()
    ) ON CONFLICT (org_id, employee_id) DO NOTHING;

    SELECT * INTO balance_record
    FROM public.leave_balances
    WHERE org_id = p_org_id AND employee_id = employee_record.id
    FOR UPDATE;
    balance_before := CASE leave_record.leave_type::text
      WHEN 'vacation' THEN COALESCE(balance_record.vacation_remaining, 0)
      WHEN 'sick' THEN COALESCE(balance_record.sick_remaining, 0)
      WHEN 'emergency' THEN COALESCE(balance_record.emergency_remaining, 0)
      ELSE NULL
    END;
    IF balance_before IS NULL THEN
      RAISE EXCEPTION 'Unsupported leave type.' USING ERRCODE = '22023';
    END IF;
    IF balance_before < leave_days THEN
      RAISE EXCEPTION 'Insufficient leave balance: available %, requested %.', balance_before, leave_days
        USING ERRCODE = 'P0001';
    END IF;
    balance_after := balance_before - leave_days;

    UPDATE public.leave_balances balance
    SET vacation_remaining = CASE WHEN leave_record.leave_type::text = 'vacation' THEN balance_after ELSE balance.vacation_remaining END,
        sick_remaining = CASE WHEN leave_record.leave_type::text = 'sick' THEN balance_after ELSE balance.sick_remaining END,
        emergency_remaining = CASE WHEN leave_record.leave_type::text = 'emergency' THEN balance_after ELSE balance.emergency_remaining END,
        updated_at = clock_timestamp()
    WHERE balance.id = balance_record.id;

    INSERT INTO public.leave_balance_transactions (
      org_id, employee_id, leave_balance_id, leave_request_id, leave_type,
      transaction_type, amount, balance_before, balance_after, reason, created_by
    ) VALUES (
      p_org_id, employee_record.id, balance_record.id, leave_record.id,
      leave_record.leave_type::text, 'leave_deduction', -leave_days,
      balance_before, balance_after, 'Approved leave request', p_actor_user_id
    );
  END IF;

  UPDATE public.leave_requests request
  SET status = p_decision::public.leave_status,
      manager_approval_status = CASE
        WHEN platform_actor OR COALESCE(request.current_step, 1) <= 1 THEN p_decision
        ELSE COALESCE(request.manager_approval_status, 'approved')
      END,
      hr_approval_status = CASE
        WHEN platform_actor OR COALESCE(request.current_step, 1) >= 2 THEN p_decision
        ELSE request.hr_approval_status
      END,
      decision_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      decided_at = clock_timestamp(),
      decided_by = p_actor_user_id,
      approval_history = COALESCE(request.approval_history, '[]'::jsonb) || jsonb_build_array(history_entry)
  WHERE request.id = leave_record.id
  RETURNING request.* INTO leave_record;

  event_payload := jsonb_build_object(
    'leave_request_id', leave_record.id,
    'employee_id', leave_record.employee_id,
    'decision', p_decision,
    'leave_type', leave_record.leave_type,
    'days', COALESCE(leave_record.days_count, (leave_record.end_date - leave_record.start_date) + 1),
    'balance_before', balance_before,
    'balance_after', balance_after
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id,
    'leave.reviewed',
    leave_record.id::text || ':' || p_decision,
    event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed',
    p_command_id,
    p_actor_user_id,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (org_id, source_type, business_key) DO UPDATE
    SET processed_at = public.business_events.processed_at
  RETURNING id INTO event_id;

  IF requester_user_id IS NOT NULL THEN
    notification_payload := jsonb_build_object(
      'userId', requester_user_id,
      'title', CASE WHEN p_decision = 'approved' THEN 'تم اعتماد طلب الإجازة' ELSE 'تم رفض طلب الإجازة' END,
      'body', NULLIF(btrim(COALESCE(p_note, '')), ''),
      'type', 'leave',
      'link', '/leave?view=mine'
    );
    INSERT INTO public.event_outbox (
      org_id, business_event_id, topic, payload, payload_hash
    ) VALUES (
      p_org_id,
      event_id,
      'notification.create',
      notification_payload,
      encode(digest(notification_payload::text, 'sha256'), 'hex')
    ) ON CONFLICT (business_event_id, topic) DO NOTHING;
  END IF;

  RETURN NEXT leave_record;
  RETURN;
END;
$$;

DROP POLICY IF EXISTS leave_requests_insert ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_update ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_delete ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_self_insert ON public.leave_requests;

REVOKE ALL ON FUNCTION public.review_leave_request(uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_leave_request(uuid, uuid, uuid, uuid, text, text)
  TO service_role;
