-- Migration v140: Allow supervisor role in link_employee_identity
-- Fixes: creating an employee with role='supervisor' fails with
-- "Unsupported employee account role" because the role allow-list
-- in link_employee_identity was never updated when v138 added the
-- supervisor enum value.
-- Also cleans up orphaned lifecycle commands from failed attempts.

CREATE OR REPLACE FUNCTION public.link_employee_identity(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role public.org_role
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_payload jsonb := jsonb_build_object(
    'employee_id', p_employee_id,
    'user_id', p_user_id,
    'email', lower(btrim(p_email)),
    'role', p_role
  );
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id
      AND (
        role::text IN ('admin', 'hr_admin')
        OR (role::text = 'sales_manager' AND p_role::text IN ('sales', 'sales_manager'))
        OR (role::text = 'supervisor' AND p_role::text = 'supervisor')
      )
  ) THEN
    RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_role::text NOT IN (
    'employee', 'hr_admin', 'hr_recruitment', 'training_manager',
    'onground_agent_manager', 'inventory_receiver', 'promoter',
    'finance_manager', 'accountant', 'finance_viewer', 'sales', 'sales_manager',
    'supervisor'
  ) THEN
    RAISE EXCEPTION 'Unsupported employee account role.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_lifecycle_commands (
    org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id
  )
  VALUES (p_org_id, p_command_id, 'link_identity', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'link_identity' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different employee command.'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO employee_row
  FROM public.employees
  WHERE id = p_employee_id AND org_id = p_org_id
  FOR UPDATE;
  IF employee_row.id IS NULL THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF employee_row.lifecycle_status IN ('offboarding', 'offboarded', 'archived') THEN
    RAISE EXCEPTION 'Identity cannot be linked to an offboarded employee.'
      USING ERRCODE = '23514';
  END IF;
  IF employee_row.user_id IS NOT NULL AND employee_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Employee already has a different login identity.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = p_user_id AND org_id <> p_org_id
  ) THEN
    RAISE EXCEPTION 'Login identity belongs to another organization.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.profiles (
    user_id, org_id, full_name, email, phone, title, account_status
  )
  VALUES (
    p_user_id, p_org_id, p_full_name, lower(btrim(p_email)), employee_row.phone,
    COALESCE(employee_row.job_title, 'Employee'), 'Pending'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    title = EXCLUDED.title,
    account_status = 'Pending',
    updated_at = now();

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (p_org_id, p_user_id, p_role)
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.employees
  SET user_id = p_user_id,
      email = lower(btrim(p_email)),
      updated_at = now(),
      lifecycle_version = lifecycle_version + 1
  WHERE id = p_employee_id AND org_id = p_org_id
  RETURNING * INTO employee_row;

  UPDATE public.employee_lifecycle_commands
  SET status = 'completed',
      result = jsonb_build_object('employee_id', employee_row.id, 'user_id', p_user_id),
      completed_at = now()
  WHERE id = command_row.id;

  RETURN NEXT employee_row;
END;
$$;

-- Clean up any orphaned commands from previously failed supervisor creation attempts.
-- These are commands where begin_onboarding completed but link_identity failed,
-- leaving the identity command in a stuck state that blocks retries.
DELETE FROM public.employee_lifecycle_commands
WHERE action = 'link_identity'
  AND status <> 'completed'
  AND created_at < now() - interval '1 hour';
