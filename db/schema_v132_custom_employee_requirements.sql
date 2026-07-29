-- HR may add a one-off requirement to a specific employee without making it
-- a mandatory activation gate or a global template for future employees.

CREATE OR REPLACE FUNCTION public.create_employee_onboarding_requirement(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_employee_id uuid,
  p_label_ar text,
  p_label_en text DEFAULT NULL,
  p_category text DEFAULT 'other',
  p_evidence_kind text DEFAULT 'document',
  p_severity text DEFAULT 'required',
  p_capability text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_employee_can_submit boolean DEFAULT true
)
RETURNS SETOF public.employee_onboarding_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  case_id_value uuid;
  template_id_value uuid;
  code_value text := 'custom_' || replace(gen_random_uuid()::text, '-', '');
  item_row public.employee_onboarding_items%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT role::text INTO actor_role_value
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN
    RAISE EXCEPTION 'Only HR may add employee requirements.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_label_ar, ''))) < 2 THEN
    RAISE EXCEPTION 'Requirement label is required.' USING ERRCODE = '22023';
  END IF;
  IF p_category NOT IN ('identity', 'contract', 'compliance', 'payroll', 'attendance', 'employment', 'other')
     OR p_evidence_kind NOT IN ('document', 'form', 'assignment', 'approval', 'none')
     OR p_severity NOT IN ('required', 'compliance', 'capability', 'recommended')
     OR (
       p_capability IS NOT NULL
       AND p_capability NOT IN ('general', 'payroll', 'payroll_payment', 'attendance', 'inventory', 'sales', 'accounting')
     ) THEN
    RAISE EXCEPTION 'Requirement classification is invalid.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE org_id = p_org_id AND id = p_employee_id
      AND lifecycle_status NOT IN ('offboarded', 'archived')
  ) THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;

  case_id_value := public.ensure_employee_onboarding_case(p_employee_id, p_actor_user_id);
  INSERT INTO public.onboarding_requirement_templates (
    org_id, requirement_code, label_ar, label_en,
    category, evidence_kind, severity, capability, due_days,
    employee_can_submit, verification_required, is_active, created_by
  )
  VALUES (
    p_org_id, code_value, btrim(p_label_ar),
    COALESCE(NULLIF(btrim(p_label_en), ''), btrim(p_label_ar)),
    p_category, p_evidence_kind, p_severity, p_capability, 0,
    p_employee_can_submit, true, false, p_actor_user_id
  )
  RETURNING id INTO template_id_value;

  INSERT INTO public.employee_onboarding_items (
    org_id, case_id, employee_id, template_id, template_version,
    requirement_code, label_ar, label_en, category, evidence_kind,
    severity, capability, employee_can_submit, status, due_at, assigned_to
  )
  VALUES (
    p_org_id, case_id_value, p_employee_id, template_id_value, 1,
    code_value, btrim(p_label_ar),
    COALESCE(NULLIF(btrim(p_label_en), ''), btrim(p_label_ar)),
    p_category, p_evidence_kind, p_severity, p_capability,
    p_employee_can_submit, 'missing', p_due_at, p_actor_user_id
  )
  RETURNING * INTO item_row;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'employee.onboarding_requirement_created', 'employee_onboarding_item', item_row.id::text,
    'success', 201, jsonb_build_object(
      'employee_id', p_employee_id,
      'requirement_code', code_value,
      'evidence_kind', p_evidence_kind,
      'due_at', p_due_at
    )
  );

  PERFORM public.refresh_employee_onboarding(p_employee_id);
  RETURN QUERY SELECT * FROM public.employee_onboarding_items WHERE id = item_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_employee_onboarding_requirement(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, date, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_onboarding_requirement(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, date, boolean
) TO service_role;

