-- Server-owned leave-balance commands and atomic cancellation/reversal.

CREATE TABLE IF NOT EXISTS public.leave_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('refresh_balance', 'adjust_balance', 'cancel_request')),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  leave_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, idempotency_key)
);

ALTER TABLE public.leave_balance_transactions
  ADD COLUMN IF NOT EXISTS command_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS leave_balance_transactions_command_idx
  ON public.leave_balance_transactions(org_id, command_id)
  WHERE command_id IS NOT NULL;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE INDEX IF NOT EXISTS leave_commands_org_created_idx
  ON public.leave_commands(org_id, created_at DESC);

ALTER TABLE public.leave_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_commands_select ON public.leave_commands;
CREATE POLICY leave_commands_select ON public.leave_commands
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.can_manage_leave())
  );

-- All mutations now go through service-only commands.
DROP POLICY IF EXISTS launch_insert_leave_balances ON public.leave_balances;
DROP POLICY IF EXISTS launch_update_leave_balances ON public.leave_balances;
DROP POLICY IF EXISTS launch_delete_leave_balances ON public.leave_balances;
DROP POLICY IF EXISTS org_insert_leave_balances ON public.leave_balances;
DROP POLICY IF EXISTS org_update_leave_balances ON public.leave_balances;
DROP POLICY IF EXISTS org_delete_leave_balances ON public.leave_balances;
DROP POLICY IF EXISTS leave_balance_transactions_admin_insert ON public.leave_balance_transactions;

CREATE OR REPLACE FUNCTION public.refresh_employee_leave_balance(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid
)
RETURNS SETOF public.leave_balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.leave_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  balance_row public.leave_balances%ROWTYPE;
  input_payload jsonb := jsonb_build_object('employee_id', p_employee_id);
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
  accrual_start date;
  accrued_days numeric;
  previous_accrued numeric;
  before_balance numeric;
  after_balance numeric;
  delta numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE org_id = p_org_id AND id = p_employee_id AND user_id = p_actor_user_id
      AND lifecycle_status NOT IN ('offboarded', 'archived')
  ) THEN RAISE EXCEPTION 'HR Admin or employee self-service access is required.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.leave_commands (org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'refresh_balance', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.leave_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'refresh_balance' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for a different leave command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.leave_balances WHERE org_id = p_org_id AND employee_id = p_employee_id;
    RETURN;
  END IF;

  SELECT * INTO employee_row FROM public.employees
  WHERE id = p_employee_id AND org_id = p_org_id AND lifecycle_status <> 'archived' FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  accrual_start := COALESCE(employee_row.leave_accrual_start_date, employee_row.hiring_date, current_date);
  accrued_days := round((GREATEST(0, extract(year FROM age(current_date, accrual_start))::integer * 12
    + extract(month FROM age(current_date, accrual_start))::integer) * 1.75)::numeric, 2);

  SELECT * INTO balance_row FROM public.leave_balances
  WHERE org_id = p_org_id AND employee_id = p_employee_id FOR UPDATE;
  IF balance_row.id IS NULL THEN
    after_balance := round((accrued_days + COALESCE(employee_row.leave_balance_manual_adjustment, 0))::numeric, 2);
    INSERT INTO public.leave_balances (
      org_id, employee_id, sick_remaining, vacation_remaining, emergency_remaining,
      accrual_start_date, vacation_accrued_days, manual_adjustment, last_accrual_calculated_at
    ) VALUES (
      p_org_id, p_employee_id, 0, after_balance, 0, accrual_start, accrued_days,
      COALESCE(employee_row.leave_balance_manual_adjustment, 0), now()
    ) RETURNING * INTO balance_row;
    INSERT INTO public.leave_balance_transactions (
      org_id, employee_id, leave_balance_id, leave_type, transaction_type, amount,
      balance_before, balance_after, reason, created_by, command_id
    ) VALUES (
      p_org_id, p_employee_id, balance_row.id, 'vacation', 'initial', after_balance,
      0, after_balance, 'Initial annual leave balance', p_actor_user_id, p_command_id
    );
  ELSE
    previous_accrued := COALESCE(balance_row.vacation_accrued_days, 0);
    before_balance := COALESCE(balance_row.vacation_remaining, 0);
    delta := round((accrued_days - previous_accrued)::numeric, 2);
    after_balance := round((before_balance + GREATEST(delta, 0))::numeric, 2);
    UPDATE public.leave_balances
    SET accrual_start_date = COALESCE(accrual_start_date, accrual_start),
        vacation_accrued_days = accrued_days,
        vacation_remaining = after_balance,
        last_accrual_calculated_at = now(),
        updated_at = now()
    WHERE id = balance_row.id
    RETURNING * INTO balance_row;
    IF delta > 0 THEN
      INSERT INTO public.leave_balance_transactions (
        org_id, employee_id, leave_balance_id, leave_type, transaction_type, amount,
        balance_before, balance_after, reason, created_by, command_id
      ) VALUES (
        p_org_id, p_employee_id, balance_row.id, 'vacation', 'accrual', delta,
        before_balance, after_balance, 'Automatic monthly annual leave accrual', p_actor_user_id, p_command_id
      );
    END IF;
  END IF;

  UPDATE public.leave_commands
  SET status = 'completed', result = jsonb_build_object('leave_balance_id', balance_row.id), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT balance_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_employee_leave_balance(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_leave_type text,
  p_amount numeric,
  p_reason text
)
RETURNS SETOF public.leave_balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.leave_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  balance_row public.leave_balances%ROWTYPE;
  input_payload jsonb := jsonb_build_object('employee_id', p_employee_id, 'leave_type', p_leave_type, 'amount', p_amount, 'reason', btrim(p_reason));
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
  before_balance numeric;
  after_balance numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin')
  ) THEN RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501'; END IF;
  IF p_leave_type NOT IN ('vacation', 'sick', 'emergency') OR p_amount = 0 OR length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Supported leave type, non-zero amount, and reason are required.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.leave_commands (org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'adjust_balance', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.leave_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'adjust_balance' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for a different leave command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.leave_balances WHERE org_id = p_org_id AND employee_id = p_employee_id;
    RETURN;
  END IF;

  SELECT * INTO employee_row FROM public.employees
  WHERE id = p_employee_id AND org_id = p_org_id AND lifecycle_status <> 'archived' FOR UPDATE;
  IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO balance_row FROM public.leave_balances
  WHERE org_id = p_org_id AND employee_id = p_employee_id FOR UPDATE;
  IF balance_row.id IS NULL THEN
    INSERT INTO public.leave_balances (
      org_id, employee_id, sick_remaining, vacation_remaining, emergency_remaining,
      accrual_start_date, vacation_accrued_days, manual_adjustment, last_accrual_calculated_at
    ) VALUES (
      p_org_id, p_employee_id, 0, 0, 0,
      COALESCE(employee_row.leave_accrual_start_date, employee_row.hiring_date, current_date), 0, 0, now()
    ) RETURNING * INTO balance_row;
  END IF;

  before_balance := CASE p_leave_type
    WHEN 'vacation' THEN COALESCE(balance_row.vacation_remaining, 0)
    WHEN 'sick' THEN COALESCE(balance_row.sick_remaining, 0)
    ELSE COALESCE(balance_row.emergency_remaining, 0)
  END;
  after_balance := round((before_balance + p_amount)::numeric, 2);
  IF after_balance < 0 THEN RAISE EXCEPTION 'Leave balance cannot become negative.' USING ERRCODE = '23514'; END IF;

  UPDATE public.leave_balances
  SET vacation_remaining = CASE WHEN p_leave_type = 'vacation' THEN after_balance ELSE vacation_remaining END,
      sick_remaining = CASE WHEN p_leave_type = 'sick' THEN after_balance ELSE sick_remaining END,
      emergency_remaining = CASE WHEN p_leave_type = 'emergency' THEN after_balance ELSE emergency_remaining END,
      manual_adjustment = CASE WHEN p_leave_type = 'vacation' THEN COALESCE(manual_adjustment, 0) + p_amount ELSE manual_adjustment END,
      updated_at = now()
  WHERE id = balance_row.id
  RETURNING * INTO balance_row;

  INSERT INTO public.leave_balance_transactions (
    org_id, employee_id, leave_balance_id, leave_type, transaction_type, amount,
    balance_before, balance_after, reason, created_by, command_id
  ) VALUES (
    p_org_id, p_employee_id, balance_row.id, p_leave_type, 'manual_adjustment', p_amount,
    before_balance, after_balance, btrim(p_reason), p_actor_user_id, p_command_id
  );
  UPDATE public.leave_commands
  SET status = 'completed', result = jsonb_build_object('leave_balance_id', balance_row.id, 'balance_after', after_balance), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT balance_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(
  p_org_id uuid,
  p_leave_request_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text
)
RETURNS SETOF public.leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.leave_commands%ROWTYPE;
  request_row public.leave_requests%ROWTYPE;
  balance_row public.leave_balances%ROWTYPE;
  employee_user_id uuid;
  actor_role text;
  input_payload jsonb := jsonb_build_object('leave_request_id', p_leave_request_id, 'reason', btrim(p_reason));
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
  balance_column text;
  before_balance numeric;
  deduction_days numeric;
  after_balance numeric;
  event_id uuid;
  event_payload jsonb;
  notification_payload jsonb;
  previous_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Cancellation reason is required.' USING ERRCODE = '22023'; END IF;

  SELECT role::text INTO actor_role FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Organization membership is required.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.leave_commands (org_id, idempotency_key, action, leave_request_id, payload_hash, actor_user_id)
  VALUES (p_org_id, p_command_id, 'cancel_request', p_leave_request_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.leave_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'cancel_request' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for a different leave command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.leave_requests WHERE org_id = p_org_id AND id = p_leave_request_id;
    RETURN;
  END IF;

  SELECT request.* INTO request_row FROM public.leave_requests request
  WHERE request.org_id = p_org_id AND request.id = p_leave_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Leave request was not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT user_id INTO employee_user_id FROM public.employees
  WHERE org_id = p_org_id AND id = request_row.employee_id;

  IF request_row.status = 'cancelled' THEN
    UPDATE public.leave_commands SET status = 'completed', result = jsonb_build_object('leave_request_id', request_row.id), completed_at = now()
    WHERE id = command_row.id;
    RETURN NEXT request_row;
    RETURN;
  END IF;
  IF request_row.status = 'rejected' THEN RAISE EXCEPTION 'Rejected leave cannot be cancelled.' USING ERRCODE = '23514'; END IF;
  IF actor_role NOT IN ('admin', 'hr_admin') AND NOT (
    employee_user_id = p_actor_user_id AND request_row.status = 'pending'
  ) THEN RAISE EXCEPTION 'Only HR may cancel approved leave; employees may cancel their own pending request.' USING ERRCODE = '42501'; END IF;

  previous_status := request_row.status::text;

  IF request_row.status = 'approved' THEN
    balance_column := CASE request_row.leave_type::text
      WHEN 'vacation' THEN 'vacation_remaining'
      WHEN 'sick' THEN 'sick_remaining'
      WHEN 'emergency' THEN 'emergency_remaining'
      ELSE NULL
    END;
    IF balance_column IS NOT NULL THEN
      SELECT * INTO balance_row FROM public.leave_balances
      WHERE org_id = p_org_id AND employee_id = request_row.employee_id FOR UPDATE;
      IF balance_row.id IS NULL THEN RAISE EXCEPTION 'Leave balance is missing for approved leave.' USING ERRCODE = '23514'; END IF;
      SELECT abs(amount) INTO deduction_days FROM public.leave_balance_transactions
      WHERE leave_request_id = request_row.id AND transaction_type = 'leave_deduction'
      ORDER BY created_at LIMIT 1;
      deduction_days := COALESCE(deduction_days, request_row.days_count, (request_row.end_date - request_row.start_date) + 1);
      before_balance := CASE balance_column
        WHEN 'vacation_remaining' THEN COALESCE(balance_row.vacation_remaining, 0)
        WHEN 'sick_remaining' THEN COALESCE(balance_row.sick_remaining, 0)
        ELSE COALESCE(balance_row.emergency_remaining, 0)
      END;
      after_balance := round((before_balance + deduction_days)::numeric, 2);
      UPDATE public.leave_balances
      SET vacation_remaining = CASE WHEN balance_column = 'vacation_remaining' THEN after_balance ELSE vacation_remaining END,
          sick_remaining = CASE WHEN balance_column = 'sick_remaining' THEN after_balance ELSE sick_remaining END,
          emergency_remaining = CASE WHEN balance_column = 'emergency_remaining' THEN after_balance ELSE emergency_remaining END,
          updated_at = now()
      WHERE id = balance_row.id;
      INSERT INTO public.leave_balance_transactions (
        org_id, employee_id, leave_balance_id, leave_request_id, leave_type, transaction_type,
        amount, balance_before, balance_after, reason, created_by, command_id
      ) VALUES (
        p_org_id, request_row.employee_id, balance_row.id, request_row.id, request_row.leave_type::text,
        'leave_reversal', deduction_days, before_balance, after_balance,
        'Approved leave cancelled: ' || btrim(p_reason), p_actor_user_id, p_command_id
      );
    END IF;
  END IF;

  UPDATE public.leave_requests
  SET status = 'cancelled', cancellation_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = p_actor_user_id,
      decision_note = CASE WHEN status = 'approved' THEN decision_note ELSE btrim(p_reason) END
  WHERE id = request_row.id
  RETURNING * INTO request_row;

  event_payload := jsonb_build_object(
    'leave_request_id', request_row.id, 'employee_id', request_row.employee_id,
    'previous_status', previous_status, 'status', 'cancelled', 'reason', btrim(p_reason)
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status, request_id,
    actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'leave.cancelled', request_row.id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_command_id,
    p_actor_user_id, now(), now()
  ) ON CONFLICT (org_id, source_type, business_key) DO UPDATE SET updated_at = now()
  RETURNING id INTO event_id;
  IF employee_user_id IS NOT NULL AND employee_user_id <> p_actor_user_id THEN
    notification_payload := jsonb_build_object(
      'userId', employee_user_id, 'title', 'تم إلغاء طلب الإجازة', 'body', btrim(p_reason),
      'type', 'leave', 'link', '/leave?view=mine'
    );
    INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
    VALUES (p_org_id, event_id, 'notification.create', notification_payload, encode(digest(notification_payload::text, 'sha256'), 'hex'))
    ON CONFLICT (business_event_id, topic) DO NOTHING;
  END IF;
  UPDATE public.leave_commands
  SET status = 'completed', employee_id = request_row.employee_id,
      result = jsonb_build_object('leave_request_id', request_row.id, 'status', request_row.status), completed_at = now()
  WHERE id = command_row.id;
  RETURN NEXT request_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_employee_leave_balance(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_employee_leave_balance(uuid, uuid, uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_leave_request(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_employee_leave_balance(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_employee_leave_balance(uuid, uuid, uuid, uuid, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_leave_request(uuid, uuid, uuid, uuid, text) TO service_role;
