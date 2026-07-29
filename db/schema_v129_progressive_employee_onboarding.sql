-- Progressive employee onboarding.
-- Account access and active employment are created immediately, while HR,
-- compliance, payroll, attendance, and document readiness are tracked separately.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_suspension_reason text,
  ADD COLUMN IF NOT EXISTS password_last_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_last_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.profiles
SET access_activated_at = COALESCE(access_activated_at, created_at)
WHERE lower(btrim(COALESCE(account_status, ''))) = 'active';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS onboarding_progress numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_due_at date;

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_onboarding_status_check,
  ADD CONSTRAINT employees_onboarding_status_check
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'complete', 'overdue', 'waived')),
  DROP CONSTRAINT IF EXISTS employees_onboarding_progress_check,
  ADD CONSTRAINT employees_onboarding_progress_check
    CHECK (onboarding_progress >= 0 AND onboarding_progress <= 100);

-- Readiness rollups are derived metadata. Updating only those fields must not
-- create optimistic-lock conflicts in unrelated employee-master workflows.
CREATE OR REPLACE FUNCTION public.bump_employee_lifecycle_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    to_jsonb(NEW) - ARRAY[
      'lifecycle_version', 'updated_at',
      'onboarding_status', 'onboarding_progress', 'onboarding_due_at'
    ]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY[
      'lifecycle_version', 'updated_at',
      'onboarding_status', 'onboarding_progress', 'onboarding_due_at'
    ]
  ) THEN
    IF NEW.lifecycle_version = OLD.lifecycle_version THEN
      NEW.lifecycle_version := OLD.lifecycle_version + 1;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Missing insurance is a payroll/compliance readiness issue, not an account-access
-- or employment-activation issue.
DROP TRIGGER IF EXISTS require_verified_insurance_for_activation_trigger ON public.employees;

CREATE TABLE IF NOT EXISTS public.onboarding_requirement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  requirement_code text NOT NULL,
  label_ar text NOT NULL,
  label_en text NOT NULL,
  description_ar text,
  description_en text,
  category text NOT NULL CHECK (category IN (
    'identity', 'contract', 'compliance', 'payroll', 'attendance', 'employment', 'other'
  )),
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'document', 'form', 'assignment', 'approval', 'none'
  )),
  severity text NOT NULL CHECK (severity IN (
    'required', 'compliance', 'capability', 'recommended'
  )),
  capability text CHECK (capability IS NULL OR capability IN (
    'general', 'payroll', 'payroll_payment', 'attendance', 'inventory', 'sales', 'accounting'
  )),
  due_days integer NOT NULL DEFAULT 7 CHECK (due_days BETWEEN 0 AND 3650),
  applies_to jsonb NOT NULL DEFAULT '{}'::jsonb,
  employee_can_submit boolean NOT NULL DEFAULT true,
  verification_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(requirement_code)) BETWEEN 2 AND 80),
  CHECK (jsonb_typeof(applies_to) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_requirement_templates_scope_code_unique
  ON public.onboarding_requirement_templates(
    COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(requirement_code))
  );
CREATE INDEX IF NOT EXISTS onboarding_requirement_templates_org_active_idx
  ON public.onboarding_requirement_templates(org_id, is_active, category, requirement_code);

CREATE TABLE IF NOT EXISTS public.employee_onboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'not_started', 'in_progress', 'complete', 'overdue', 'waived'
  )),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  target_completion_at date,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_items integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  completed_items integer NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (
    progress_percent >= 0 AND progress_percent <= 100
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, employee_id)
);
CREATE INDEX IF NOT EXISTS employee_onboarding_cases_org_status_idx
  ON public.employee_onboarding_cases(org_id, status, target_completion_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.employee_onboarding_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.employee_onboarding_cases(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.onboarding_requirement_templates(id) ON DELETE SET NULL,
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  requirement_code text NOT NULL,
  label_ar text NOT NULL,
  label_en text NOT NULL,
  category text NOT NULL,
  evidence_kind text NOT NULL,
  severity text NOT NULL,
  capability text,
  employee_can_submit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'missing' CHECK (status IN (
    'missing', 'requested', 'submitted', 'under_review', 'verified',
    'rejected', 'waived', 'not_applicable', 'overdue'
  )),
  due_at date,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  managed_file_id uuid REFERENCES public.managed_files(id) ON DELETE SET NULL,
  requested_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  waived_at timestamptz,
  waived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_reason text,
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, requirement_code)
);
CREATE INDEX IF NOT EXISTS employee_onboarding_items_org_status_idx
  ON public.employee_onboarding_items(org_id, status, due_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS employee_onboarding_items_employee_idx
  ON public.employee_onboarding_items(org_id, employee_id, category, requirement_code);

ALTER TABLE public.onboarding_requirement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_onboarding_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_onboarding_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_requirement_templates_service_only ON public.onboarding_requirement_templates;
CREATE POLICY onboarding_requirement_templates_service_only
  ON public.onboarding_requirement_templates FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS employee_onboarding_cases_service_only ON public.employee_onboarding_cases;
CREATE POLICY employee_onboarding_cases_service_only
  ON public.employee_onboarding_cases FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS employee_onboarding_items_service_only ON public.employee_onboarding_items;
CREATE POLICY employee_onboarding_items_service_only
  ON public.employee_onboarding_items FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.onboarding_requirement_templates (
  requirement_code, label_ar, label_en, description_ar, description_en,
  category, evidence_kind, severity, capability, due_days,
  employee_can_submit, verification_required
)
SELECT seed.*
FROM (VALUES
  (
    'official_id', 'الهوية أو الملف الرسمي', 'Official identity document',
    'ارفع مستند الهوية أو الملف الرسمي للموظف.', 'Upload the employee official identity document.',
    'identity', 'document', 'required', NULL::text, 7, true, true
  ),
  (
    'signed_contract', 'العقد الموقّع', 'Signed employment contract',
    'ارفع نسخة العقد الموقعة وسجّل بيانات العقد.', 'Upload the signed contract and register its details.',
    'contract', 'document', 'compliance', NULL::text, 7, true, true
  ),
  (
    'social_insurance', 'إعداد التأمينات الاجتماعية', 'Social-insurance setup',
    'أكمل رقم ونسب وأجر التأمينات للموظف.', 'Complete the employee social-insurance configuration.',
    'compliance', 'form', 'capability', 'payroll', 7, false, true
  ),
  (
    'bank_details', 'بيانات الدفع أو الحساب البنكي', 'Payment and bank details',
    'أكمل وسيلة الدفع وبيانات الحساب البنكي قبل الصرف.', 'Complete payment and bank details before disbursement.',
    'payroll', 'form', 'capability', 'payroll_payment', 14, false, true
  ),
  (
    'work_location', 'موقع العمل', 'Work location assignment',
    'عيّن موقع عمل نشط للموظف.', 'Assign an active work location.',
    'attendance', 'assignment', 'capability', 'attendance', 3, false, true
  ),
  (
    'work_shift', 'الوردية', 'Work shift assignment',
    'عيّن وردية للموظف إذا كان عمله يعتمد على الورديات.', 'Assign a shift for shift-based work.',
    'attendance', 'assignment', 'capability', 'attendance', 3, false, true
  ),
  (
    'emergency_contact', 'جهة اتصال للطوارئ', 'Emergency contact',
    'أضف اسم ورقم جهة اتصال للطوارئ.', 'Add an emergency contact name and phone number.',
    'employment', 'form', 'recommended', NULL::text, 14, false, false
  )
) AS seed(
  requirement_code, label_ar, label_en, description_ar, description_en,
  category, evidence_kind, severity, capability, due_days,
  employee_can_submit, verification_required
)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.onboarding_requirement_templates existing
  WHERE existing.org_id IS NULL
    AND lower(existing.requirement_code) = lower(seed.requirement_code)
);

CREATE OR REPLACE FUNCTION public.refresh_employee_onboarding(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_row public.employees%ROWTYPE;
  case_row public.employee_onboarding_cases%ROWTYPE;
  total_value integer := 0;
  completed_value integer := 0;
  overdue_value integer := 0;
  progress_value numeric(5,2) := 0;
  status_value text := 'in_progress';
  due_value date;
BEGIN
  SELECT * INTO employee_row
  FROM public.employees
  WHERE id = p_employee_id;
  IF employee_row.id IS NULL THEN RETURN; END IF;

  SELECT * INTO case_row
  FROM public.employee_onboarding_cases
  WHERE org_id = employee_row.org_id AND employee_id = employee_row.id
  FOR UPDATE;
  IF case_row.id IS NULL THEN RETURN; END IF;

  UPDATE public.employee_onboarding_items item
  SET
    status = 'verified',
    verified_at = COALESCE(item.verified_at, now()),
    updated_at = now(),
    version = item.version + 1
  WHERE item.case_id = case_row.id
    AND item.status IN ('missing', 'requested', 'rejected', 'overdue')
    AND (
      (item.requirement_code = 'official_id' AND EXISTS (
        SELECT 1 FROM public.personnel_files file
        WHERE file.org_id = employee_row.org_id
          AND file.employee_id = employee_row.id
          AND file.category = 'official'
      ))
      OR (item.requirement_code = 'signed_contract' AND EXISTS (
        SELECT 1 FROM public.employee_contracts contract
        WHERE contract.org_id = employee_row.org_id
          AND contract.employee_id = employee_row.id
          AND contract.status = 'active'
      ))
      OR (item.requirement_code = 'social_insurance' AND EXISTS (
        SELECT 1 FROM public.social_insurance insurance
        WHERE insurance.org_id = employee_row.org_id
          AND insurance.employee_id = employee_row.id
          AND insurance.status = 'active'
      ))
      OR (item.requirement_code = 'bank_details'
        AND NULLIF(btrim(COALESCE(employee_row.payment_method, '')), '') IS NOT NULL
        AND (
          NULLIF(btrim(COALESCE(employee_row.iban, '')), '') IS NOT NULL
          OR NULLIF(btrim(COALESCE(employee_row.bank_account, '')), '') IS NOT NULL
          OR lower(btrim(COALESCE(employee_row.payment_method, ''))) = 'cash'
        ))
      OR (item.requirement_code = 'work_location' AND EXISTS (
        SELECT 1 FROM public.employee_locations location
        WHERE location.org_id = employee_row.org_id
          AND location.employee_id = employee_row.id
          AND location.assigned_from <= current_date
          AND (location.assigned_to IS NULL OR location.assigned_to >= current_date)
      ))
      OR (item.requirement_code = 'work_shift' AND EXISTS (
        SELECT 1 FROM public.employee_shifts shift
        WHERE shift.org_id = employee_row.org_id
          AND shift.employee_id = employee_row.id
          AND COALESCE(shift.start_date, current_date) <= current_date
          AND (shift.end_date IS NULL OR shift.end_date >= current_date)
      ))
      OR (item.requirement_code = 'emergency_contact'
        AND NULLIF(btrim(COALESCE(employee_row.emergency_contact_name, '')), '') IS NOT NULL
        AND NULLIF(btrim(COALESCE(employee_row.emergency_contact_phone, '')), '') IS NOT NULL)
    );

  UPDATE public.employee_onboarding_items item
  SET status = 'overdue', updated_at = now(), version = item.version + 1
  WHERE item.case_id = case_row.id
    AND item.due_at < current_date
    AND item.status IN ('missing', 'requested', 'rejected');

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status IN ('verified', 'waived', 'not_applicable'))::integer,
    count(*) FILTER (WHERE status = 'overdue')::integer,
    min(due_at) FILTER (WHERE status NOT IN ('verified', 'waived', 'not_applicable'))
  INTO total_value, completed_value, overdue_value, due_value
  FROM public.employee_onboarding_items
  WHERE case_id = case_row.id;

  progress_value := CASE
    WHEN total_value = 0 THEN 100
    ELSE round((completed_value::numeric / total_value::numeric) * 100, 2)
  END;
  status_value := CASE
    WHEN total_value = 0 OR completed_value = total_value THEN 'complete'
    WHEN overdue_value > 0 THEN 'overdue'
    ELSE 'in_progress'
  END;

  UPDATE public.employee_onboarding_cases
  SET
    status = status_value,
    total_items = total_value,
    completed_items = completed_value,
    progress_percent = progress_value,
    target_completion_at = due_value,
    completed_at = CASE
      WHEN status_value = 'complete' THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    updated_at = now(),
    version = version + 1
  WHERE id = case_row.id;

  UPDATE public.employees
  SET
    onboarding_status = status_value,
    onboarding_progress = progress_value,
    onboarding_due_at = due_value
  WHERE id = employee_row.id
    AND ROW(onboarding_status, onboarding_progress, onboarding_due_at)
      IS DISTINCT FROM ROW(status_value, progress_value, due_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_employee_onboarding_case(
  p_employee_id uuid,
  p_owner_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_row public.employees%ROWTYPE;
  case_id_value uuid;
BEGIN
  SELECT * INTO employee_row
  FROM public.employees
  WHERE id = p_employee_id;
  IF employee_row.id IS NULL THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.employee_onboarding_cases (
    org_id, employee_id, owner_user_id, started_at
  )
  VALUES (
    employee_row.org_id, employee_row.id, p_owner_user_id, COALESCE(employee_row.created_at, now())
  )
  ON CONFLICT (org_id, employee_id) DO UPDATE
    SET owner_user_id = COALESCE(employee_onboarding_cases.owner_user_id, EXCLUDED.owner_user_id),
        updated_at = now()
  RETURNING id INTO case_id_value;

  INSERT INTO public.employee_onboarding_items (
    org_id, case_id, employee_id, template_id, template_version,
    requirement_code, label_ar, label_en, category, evidence_kind,
    severity, capability, employee_can_submit, status, due_at, assigned_to
  )
  SELECT
    employee_row.org_id,
    case_id_value,
    employee_row.id,
    selected.id,
    selected.version,
    selected.requirement_code,
    selected.label_ar,
    selected.label_en,
    selected.category,
    selected.evidence_kind,
    selected.severity,
    selected.capability,
    selected.employee_can_submit,
    'missing',
    COALESCE(employee_row.hiring_date, employee_row.created_at::date, current_date) + selected.due_days,
    p_owner_user_id
  FROM (
    SELECT DISTINCT ON (lower(template.requirement_code)) template.*
    FROM public.onboarding_requirement_templates template
    WHERE template.is_active
      AND (template.org_id IS NULL OR template.org_id = employee_row.org_id)
      AND NOT (
        template.requirement_code = 'social_insurance'
        AND employee_row.employment_type = 'intern'
      )
    ORDER BY lower(template.requirement_code), (template.org_id IS NOT NULL) DESC, template.version DESC
  ) selected
  ON CONFLICT (case_id, requirement_code) DO NOTHING;

  PERFORM public.refresh_employee_onboarding(employee_row.id);
  RETURN case_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_progressive_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lifecycle_status = 'onboarding' THEN
    NEW.lifecycle_status := 'active';
    NEW.status := 'Active';
    NEW.onboarded_at := COALESCE(NEW.onboarded_at, now());
  END IF;
  NEW.onboarding_status := COALESCE(NULLIF(NEW.onboarding_status, ''), 'in_progress');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_progressive_employee_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_employee_onboarding_case(NEW.id, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_progressive_employee_trigger ON public.employees;
CREATE TRIGGER initialize_progressive_employee_trigger
  BEFORE INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.initialize_progressive_employee();

DROP TRIGGER IF EXISTS create_progressive_employee_case_trigger ON public.employees;
CREATE TRIGGER create_progressive_employee_case_trigger
  AFTER INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.create_progressive_employee_case();

CREATE OR REPLACE FUNCTION public.activate_linked_employee_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND NEW.lifecycle_status NOT IN ('offboarding', 'offboarded', 'archived')
     AND lower(COALESCE(NEW.status, '')) = 'active' THEN
    UPDATE public.profiles
    SET
      account_status = 'Active',
      access_activated_at = COALESCE(access_activated_at, now()),
      access_suspended_at = NULL,
      access_suspension_reason = NULL,
      updated_at = now()
    WHERE org_id = NEW.org_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activate_linked_employee_profile_trigger ON public.employees;
CREATE TRIGGER activate_linked_employee_profile_trigger
  AFTER INSERT OR UPDATE OF user_id, lifecycle_status, status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.activate_linked_employee_profile();

CREATE OR REPLACE FUNCTION public.update_employee_onboarding_item(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_item_id uuid,
  p_action text,
  p_reason text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_managed_file_id uuid DEFAULT NULL
)
RETURNS SETOF public.employee_onboarding_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_row public.employee_onboarding_items%ROWTYPE;
  actor_role_value text;
  actor_employee_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN (
    'request', 'submit', 'review', 'verify', 'reject', 'waive',
    'not_applicable', 'reopen', 'set_due', 'attach_file'
  ) THEN
    RAISE EXCEPTION 'Unsupported onboarding action.' USING ERRCODE = '22023';
  END IF;

  SELECT role::text INTO actor_role_value
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT id INTO actor_employee_id
  FROM public.employees
  WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND lifecycle_status NOT IN ('offboarded', 'archived');

  SELECT * INTO item_row
  FROM public.employee_onboarding_items
  WHERE org_id = p_org_id AND id = p_item_id
  FOR UPDATE;
  IF item_row.id IS NULL THEN
    RAISE EXCEPTION 'Onboarding item was not found.' USING ERRCODE = 'P0002';
  END IF;

  IF actor_role_value NOT IN ('admin', 'hr_admin')
     AND NOT (
       actor_employee_id = item_row.employee_id
       AND item_row.evidence_kind = 'document'
       AND p_action IN ('submit', 'attach_file')
     ) THEN
    RAISE EXCEPTION 'Onboarding item access is forbidden.' USING ERRCODE = '42501';
  END IF;

  IF p_action IN ('reject', 'waive', 'not_applicable') AND length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A decision reason is required.' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('submit', 'attach_file') THEN
    IF p_managed_file_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.managed_files file
      WHERE file.id = p_managed_file_id
        AND file.org_id = p_org_id
        AND file.employee_id = item_row.employee_id
        AND file.deleted_at IS NULL
        AND file.scan_status = 'clean'
    ) THEN
      RAISE EXCEPTION 'A clean employee file is required.' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.employee_onboarding_items
  SET
    status = CASE p_action
      WHEN 'request' THEN 'requested'
      WHEN 'submit' THEN 'submitted'
      WHEN 'attach_file' THEN 'submitted'
      WHEN 'review' THEN 'under_review'
      WHEN 'verify' THEN 'verified'
      WHEN 'reject' THEN 'rejected'
      WHEN 'waive' THEN 'waived'
      WHEN 'not_applicable' THEN 'not_applicable'
      WHEN 'reopen' THEN 'missing'
      ELSE status
    END,
    due_at = CASE WHEN p_action = 'set_due' THEN p_due_at ELSE due_at END,
    managed_file_id = CASE
      WHEN p_action IN ('submit', 'attach_file') THEN p_managed_file_id
      ELSE managed_file_id
    END,
    requested_at = CASE WHEN p_action = 'request' THEN now() ELSE requested_at END,
    submitted_at = CASE WHEN p_action IN ('submit', 'attach_file') THEN now() ELSE submitted_at END,
    submitted_by = CASE WHEN p_action IN ('submit', 'attach_file') THEN p_actor_user_id ELSE submitted_by END,
    verified_at = CASE WHEN p_action = 'verify' THEN now() WHEN p_action = 'reopen' THEN NULL ELSE verified_at END,
    verified_by = CASE WHEN p_action = 'verify' THEN p_actor_user_id WHEN p_action = 'reopen' THEN NULL ELSE verified_by END,
    rejected_at = CASE WHEN p_action = 'reject' THEN now() WHEN p_action = 'reopen' THEN NULL ELSE rejected_at END,
    rejected_by = CASE WHEN p_action = 'reject' THEN p_actor_user_id WHEN p_action = 'reopen' THEN NULL ELSE rejected_by END,
    waived_at = CASE WHEN p_action IN ('waive', 'not_applicable') THEN now() WHEN p_action = 'reopen' THEN NULL ELSE waived_at END,
    waived_by = CASE WHEN p_action IN ('waive', 'not_applicable') THEN p_actor_user_id WHEN p_action = 'reopen' THEN NULL ELSE waived_by END,
    decision_reason = CASE
      WHEN p_action IN ('reject', 'waive', 'not_applicable') THEN btrim(p_reason)
      WHEN p_action = 'reopen' THEN NULL
      ELSE decision_reason
    END,
    updated_at = now(),
    version = version + 1
  WHERE id = item_row.id
  RETURNING * INTO item_row;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, COALESCE(actor_role_value, 'employee'),
    'employee.onboarding_item_' || p_action, 'employee_onboarding_item', item_row.id::text,
    'success', 200, jsonb_build_object(
      'employee_id', item_row.employee_id,
      'requirement_code', item_row.requirement_code,
      'status', item_row.status,
      'due_at', item_row.due_at
    )
  );

  PERFORM public.refresh_employee_onboarding(item_row.employee_id);
  RETURN QUERY
  SELECT * FROM public.employee_onboarding_items WHERE id = item_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_employee_onboarding(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_payload jsonb := jsonb_build_object('employee_id', p_employee_id);
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id
      AND role::text IN ('admin', 'hr_admin', 'sales_manager')
  ) THEN
    RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.employee_lifecycle_commands (
    org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id
  )
  VALUES (
    p_org_id, p_command_id, 'finalize_onboarding', p_employee_id, input_hash, p_actor_user_id
  )
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'finalize_onboarding' OR command_row.payload_hash <> input_hash THEN
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
    RAISE EXCEPTION 'An offboarded or archived employee cannot complete onboarding.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.ensure_employee_onboarding_case(employee_row.id, p_actor_user_id);
  PERFORM public.refresh_employee_onboarding(employee_row.id);

  UPDATE public.employee_lifecycle_commands
  SET
    employee_id = employee_row.id,
    status = 'completed',
    result = jsonb_build_object(
      'employee_id', employee_row.id,
      'lifecycle_status', employee_row.lifecycle_status,
      'onboarding_status', (
        SELECT onboarding_status FROM public.employees WHERE id = employee_row.id
      )
    ),
    completed_at = now()
  WHERE id = command_row.id;

  RETURN QUERY
  SELECT * FROM public.employees WHERE id = employee_row.id;
END;
$$;

-- Existing records receive a checklist, but legacy onboarding accounts are not
-- silently granted access by this migration.
SELECT public.ensure_employee_onboarding_case(employee.id, NULL)
FROM public.employees employee
WHERE employee.lifecycle_status NOT IN ('offboarded', 'archived');

REVOKE ALL ON FUNCTION public.refresh_employee_onboarding(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_employee_onboarding_case(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_employee_onboarding_item(
  uuid, uuid, uuid, uuid, text, text, date, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_progressive_employee() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_progressive_employee_case() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_linked_employee_profile() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_employee_onboarding(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_employee_onboarding_case(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_employee_onboarding_item(
  uuid, uuid, uuid, uuid, text, text, date, uuid
) TO service_role;

COMMENT ON COLUMN public.profiles.account_status IS
  'Login access only. HR/compliance onboarding completeness must not change this status.';
COMMENT ON COLUMN public.employees.onboarding_status IS
  'Progressive HR readiness state independent of account access and employment lifecycle.';
