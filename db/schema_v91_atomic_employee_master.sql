-- v91: atomic employee master, location assignment, and department-manager update.

ALTER TABLE public.employee_lifecycle_commands
  DROP CONSTRAINT IF EXISTS employee_lifecycle_commands_action_check;
ALTER TABLE public.employee_lifecycle_commands
  ADD CONSTRAINT employee_lifecycle_commands_action_check
  CHECK (action IN ('begin_onboarding','finalize_onboarding','link_identity','offboard','update_master'));

ALTER TABLE public.employee_locations
  DROP CONSTRAINT IF EXISTS employee_locations_employee_id_location_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS employee_locations_active_assignment_key
  ON public.employee_locations(org_id,employee_id,location_id) WHERE assigned_to IS NULL;

CREATE OR REPLACE FUNCTION public.update_employee_master(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,
  p_employee_id uuid,p_expected_version integer,p_updates jsonb,
  p_location_ids uuid[] DEFAULT NULL,p_primary_location_id uuid DEFAULT NULL,
  p_managed_department_ids uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE command_record public.employee_lifecycle_commands%ROWTYPE; employee_record public.employees%ROWTYPE;
  updated_record public.employees%ROWTYPE; actor_role text; input_value jsonb; hash_value text;
  invalid_key text; invalid_count integer; selected_primary uuid; business_date_value date;
  old_snapshot jsonb; new_snapshot jsonb; event_payload jsonb; event_id_value uuid; result_value jsonb;
  locations_value uuid[]; departments_value uuid[];
  allowed_keys text[]:=ARRAY['full_name','full_name_ar','full_name_en','employee_code','email','phone','address',
    'work_city','national_address_code','emergency_contact_name','emergency_contact_phone','national_id',
    'date_of_birth','date_of_birth_hijri','gender','hiring_date','department_id','job_title','manager_id',
    'company_id','project_id','city','province','employment_type','base_salary','bonus','deductions',
    'deduction_rule_group_id','leave_balance_manual_adjustment','leave_accrual_start_date','can_multi_checkin',
    'carrier_supervisor_id','payment_method','bank_account','bank_account_name','bank_name','iban','education_level'];
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_command_id IS NULL OR p_employee_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 THEN
    RAISE EXCEPTION 'Command, employee, and expected version are required.' USING ERRCODE='22023'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  IF actor_role NOT IN('admin','hr_admin') THEN RAISE EXCEPTION 'Actor cannot update employee master data.' USING ERRCODE='42501'; END IF;
  SELECT key INTO invalid_key FROM jsonb_object_keys(COALESCE(p_updates,'{}'::jsonb)) key
  WHERE NOT(key=ANY(allowed_keys)) LIMIT 1;
  IF invalid_key IS NOT NULL THEN RAISE EXCEPTION 'Employee field % cannot be changed here.',invalid_key USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_object_keys(COALESCE(p_updates,'{}'::jsonb)))
     AND p_location_ids IS NULL AND p_managed_department_ids IS NULL THEN
    RAISE EXCEPTION 'No employee changes were provided.' USING ERRCODE='22023'; END IF;
  locations_value:=CASE WHEN p_location_ids IS NULL THEN NULL ELSE ARRAY(SELECT DISTINCT unnest(p_location_ids)) END;
  departments_value:=CASE WHEN p_managed_department_ids IS NULL THEN NULL ELSE ARRAY(SELECT DISTINCT unnest(p_managed_department_ids)) END;
  input_value:=jsonb_build_object('employee_id',p_employee_id,'expected_version',p_expected_version,
    'updates',COALESCE(p_updates,'{}'::jsonb),'location_ids',to_jsonb(locations_value),
    'primary_location_id',p_primary_location_id,'managed_department_ids',to_jsonb(departments_value));
  hash_value:=encode(digest(input_value::text,'sha256'),'hex');
  INSERT INTO public.employee_lifecycle_commands(org_id,idempotency_key,action,employee_id,payload_hash,actor_user_id)
  VALUES(p_org_id,p_command_id,'update_master',p_employee_id,hash_value,p_actor_user_id)
  ON CONFLICT(org_id,idempotency_key) DO NOTHING;
  SELECT * INTO command_record FROM public.employee_lifecycle_commands
  WHERE org_id=p_org_id AND idempotency_key=p_command_id FOR UPDATE;
  IF command_record.action<>'update_master' OR command_record.employee_id IS DISTINCT FROM p_employee_id
     OR command_record.payload_hash<>hash_value OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Command id was already used with different employee input.' USING ERRCODE='23505'; END IF;
  IF command_record.status='completed' THEN RETURN command_record.result; END IF;
  SELECT * INTO employee_record FROM public.employees
  WHERE org_id=p_org_id AND id=p_employee_id AND lifecycle_status NOT IN('offboarded','archived') FOR UPDATE;
  IF employee_record.id IS NULL THEN RAISE EXCEPTION 'Active employee was not found.' USING ERRCODE='P0002'; END IF;
  IF employee_record.lifecycle_version<>p_expected_version THEN
    RAISE EXCEPTION 'Employee changed; reload and retry.' USING ERRCODE='40001'; END IF;
  SELECT * INTO updated_record FROM jsonb_populate_record(employee_record,COALESCE(p_updates,'{}'::jsonb));
  IF length(btrim(COALESCE(updated_record.full_name,'')))<2 THEN
    RAISE EXCEPTION 'Employee full name is required.' USING ERRCODE='23514'; END IF;
  IF updated_record.manager_id=p_employee_id OR updated_record.carrier_supervisor_id=p_employee_id THEN
    RAISE EXCEPTION 'Employee cannot manage or supervise themselves.' USING ERRCODE='23514'; END IF;
  IF updated_record.department_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.departments WHERE org_id=p_org_id AND id=updated_record.department_id) THEN
    RAISE EXCEPTION 'Department is outside the organization.' USING ERRCODE='23503'; END IF;
  IF updated_record.manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employees WHERE org_id=p_org_id AND id=updated_record.manager_id AND lifecycle_status IN('active','onboarding')) THEN
    RAISE EXCEPTION 'Manager is outside the active organization.' USING ERRCODE='23503'; END IF;
  IF updated_record.carrier_supervisor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employees WHERE org_id=p_org_id AND id=updated_record.carrier_supervisor_id AND lifecycle_status IN('active','onboarding')) THEN
    RAISE EXCEPTION 'Carrier supervisor is outside the active organization.' USING ERRCODE='23503'; END IF;
  IF updated_record.company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_companies WHERE organization_id=p_org_id AND id=updated_record.company_id) THEN
    RAISE EXCEPTION 'Company is outside the organization.' USING ERRCODE='23503'; END IF;
  IF updated_record.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_companies WHERE organization_id=p_org_id AND id=updated_record.project_id) THEN
    RAISE EXCEPTION 'Project is outside the organization.' USING ERRCODE='23503'; END IF;
  IF updated_record.deduction_rule_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.deduction_rule_groups WHERE org_id=p_org_id AND id=updated_record.deduction_rule_group_id) THEN
    RAISE EXCEPTION 'Deduction policy is outside the organization.' USING ERRCODE='23503'; END IF;
  business_date_value:=public.organization_business_date(p_org_id,now());
  IF locations_value IS NOT NULL THEN
    SELECT count(*) INTO invalid_count FROM unnest(locations_value) location_id
    WHERE NOT EXISTS(SELECT 1 FROM public.locations WHERE org_id=p_org_id AND id=location_id);
    IF invalid_count>0 THEN RAISE EXCEPTION 'A location is outside the organization.' USING ERRCODE='23503'; END IF;
    selected_primary:=CASE WHEN p_primary_location_id=ANY(locations_value) THEN p_primary_location_id ELSE locations_value[1] END;
    updated_record.location_id:=selected_primary;
  END IF;
  IF departments_value IS NOT NULL THEN
    SELECT count(*) INTO invalid_count FROM unnest(departments_value) department_id
    WHERE NOT EXISTS(SELECT 1 FROM public.departments WHERE org_id=p_org_id AND id=department_id);
    IF invalid_count>0 THEN RAISE EXCEPTION 'A managed department is outside the organization.' USING ERRCODE='23503'; END IF;
  END IF;
  old_snapshot:=jsonb_build_object('full_name',employee_record.full_name,'job_title',employee_record.job_title,
    'department_id',employee_record.department_id,'manager_id',employee_record.manager_id,'location_id',employee_record.location_id);
  UPDATE public.employees SET
    employee_code=updated_record.employee_code,full_name=updated_record.full_name,full_name_ar=updated_record.full_name_ar,
    full_name_en=updated_record.full_name_en,email=updated_record.email,phone=updated_record.phone,address=updated_record.address,
    work_city=updated_record.work_city,national_address_code=updated_record.national_address_code,
    emergency_contact_name=updated_record.emergency_contact_name,emergency_contact_phone=updated_record.emergency_contact_phone,
    national_id=updated_record.national_id,date_of_birth=updated_record.date_of_birth,date_of_birth_hijri=updated_record.date_of_birth_hijri,
    gender=updated_record.gender,hiring_date=updated_record.hiring_date,department_id=updated_record.department_id,
    job_title=updated_record.job_title,manager_id=updated_record.manager_id,location_id=updated_record.location_id,
    company_id=updated_record.company_id,project_id=updated_record.project_id,city=updated_record.city,province=updated_record.province,
    employment_type=updated_record.employment_type,base_salary=updated_record.base_salary,bonus=updated_record.bonus,
    deductions=updated_record.deductions,deduction_rule_group_id=updated_record.deduction_rule_group_id,
    leave_balance_manual_adjustment=updated_record.leave_balance_manual_adjustment,
    leave_accrual_start_date=updated_record.leave_accrual_start_date,can_multi_checkin=updated_record.can_multi_checkin,
    carrier_supervisor_id=updated_record.carrier_supervisor_id,payment_method=updated_record.payment_method,
    bank_account=updated_record.bank_account,bank_account_name=updated_record.bank_account_name,bank_name=updated_record.bank_name,
    iban=updated_record.iban,education_level=updated_record.education_level
  WHERE id=p_employee_id RETURNING * INTO employee_record;
  IF locations_value IS NOT NULL THEN
    UPDATE public.employee_locations SET assigned_to=business_date_value,is_primary=false
    WHERE org_id=p_org_id AND employee_id=p_employee_id AND assigned_to IS NULL
      AND NOT(location_id=ANY(locations_value));
    UPDATE public.employee_locations SET is_primary=(location_id=selected_primary)
    WHERE org_id=p_org_id AND employee_id=p_employee_id AND assigned_to IS NULL
      AND location_id=ANY(locations_value);
    INSERT INTO public.employee_locations(org_id,employee_id,location_id,is_primary,assigned_from)
    SELECT p_org_id,p_employee_id,location_id,location_id=selected_primary,business_date_value
    FROM unnest(locations_value) location_id
    WHERE NOT EXISTS(SELECT 1 FROM public.employee_locations existing
      WHERE existing.org_id=p_org_id AND existing.employee_id=p_employee_id
        AND existing.location_id=location_id AND existing.assigned_to IS NULL);
  END IF;
  IF departments_value IS NOT NULL THEN
    PERFORM set_config('app.hr_structure_command','trusted',true);
    UPDATE public.departments SET manager_employee_id=NULL,version=version+1,updated_at=clock_timestamp()
    WHERE org_id=p_org_id AND manager_employee_id=p_employee_id AND NOT(id=ANY(departments_value));
    UPDATE public.departments SET manager_employee_id=p_employee_id,version=version+1,updated_at=clock_timestamp()
    WHERE org_id=p_org_id AND id=ANY(departments_value) AND manager_employee_id IS DISTINCT FROM p_employee_id;
  END IF;
  new_snapshot:=jsonb_build_object('full_name',employee_record.full_name,'job_title',employee_record.job_title,
    'department_id',employee_record.department_id,'manager_id',employee_record.manager_id,'location_id',employee_record.location_id,
    'managed_department_ids',to_jsonb(departments_value),'location_ids',to_jsonb(locations_value));
  PERFORM set_config('app.hr_structure_command','trusted',true);
  INSERT INTO public.employee_career_events(employee_id,event_type,previous_value,new_value,effective_date,notes,created_by)
  VALUES(p_employee_id,'role_change',old_snapshot,new_snapshot,business_date_value,'Employee master command',p_actor_user_id);
  event_payload:=jsonb_build_object('event_type','employee.updated','employee_id',p_employee_id,
    'changed_fields',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(COALESCE(p_updates,'{}'::jsonb)) key),
    'version',employee_record.lifecycle_version);
  INSERT INTO public.business_events(org_id,source_type,business_key,event_version,payload,payload_hash,status,request_id,
    actor_user_id,occurred_at,processed_at) VALUES(p_org_id,'employee','updated:'||p_employee_id::text||':'||employee_record.lifecycle_version,
    employee_record.lifecycle_version,event_payload,encode(digest(event_payload::text,'sha256'),'hex'),'completed',p_request_id,
    p_actor_user_id,clock_timestamp(),clock_timestamp()) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id_value,'employee.updated',event_payload,encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,
    status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,'employee.updated','employee',p_employee_id::text,
    'success',200,jsonb_build_object('old',old_snapshot,'new',new_snapshot,'version',employee_record.lifecycle_version));
  result_value:=to_jsonb(employee_record);
  UPDATE public.employee_lifecycle_commands SET status='completed',result=result_value,completed_at=clock_timestamp()
  WHERE id=command_record.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.update_employee_master(uuid,uuid,uuid,uuid,uuid,integer,jsonb,uuid[],uuid,uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_master(uuid,uuid,uuid,uuid,uuid,integer,jsonb,uuid[],uuid,uuid[])
  TO service_role;
