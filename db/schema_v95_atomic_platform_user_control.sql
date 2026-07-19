-- v95: atomic, replay-safe platform control of organization users.

CREATE TABLE IF NOT EXISTS public.platform_user_commands (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  target_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('suspend','activate','update_role')),
  input_hash text NOT NULL CHECK (length(input_hash)=64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_platform_user_commands_org_created
  ON public.platform_user_commands(target_org_id,created_at DESC);
ALTER TABLE public.platform_user_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_user_commands_service_only ON public.platform_user_commands;
CREATE POLICY platform_user_commands_service_only ON public.platform_user_commands FOR ALL
  USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');

CREATE OR REPLACE FUNCTION public.execute_platform_user_command(
  p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,p_target_org_id uuid,p_target_user_id uuid,
  p_action text,p_next_role text DEFAULT NULL,p_expected_employee_version integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  command_record public.platform_user_commands%ROWTYPE;
  membership_record public.org_members%ROWTYPE;
  employee_record public.employees%ROWTYPE;
  profile_email text;
  profile_name text;
  profile_status text;
  next_status text;
  title_value text;
  input_value jsonb;
  input_hash_value text;
  old_snapshot jsonb;
  new_snapshot jsonb;
  event_payload jsonb;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL OR p_target_org_id IS NULL
     OR p_target_user_id IS NULL OR p_action NOT IN('suspend','activate','update_role') THEN
    RAISE EXCEPTION 'Platform user command input is invalid.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.platform_admins
    WHERE user_id=p_actor_user_id AND role='superadmin' AND status='active') THEN
    RAISE EXCEPTION 'Active superadmin permission is required.' USING ERRCODE='42501'; END IF;
  IF p_action='update_role' AND COALESCE(p_next_role,'') NOT IN(
    'admin','hr_admin','hr_recruitment','training_manager','onground_agent_manager','promoter',
    'finance_manager','accountant','finance_viewer','sales','sales_manager','field_agent','merchant','employee'
  ) THEN RAISE EXCEPTION 'Unsupported organization role.' USING ERRCODE='23514'; END IF;
  input_value:=jsonb_build_object('target_org_id',p_target_org_id,'target_user_id',p_target_user_id,
    'action',p_action,'next_role',p_next_role,'expected_employee_version',p_expected_employee_version);
  input_hash_value:=encode(digest(input_value::text,'sha256'),'hex');
  INSERT INTO public.platform_user_commands(id,actor_user_id,request_id,target_org_id,target_user_id,action,input_hash)
  VALUES(p_command_id,p_actor_user_id,p_request_id,p_target_org_id,p_target_user_id,p_action,input_hash_value)
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.platform_user_commands WHERE id=p_command_id FOR UPDATE;
  IF command_record.actor_user_id IS DISTINCT FROM p_actor_user_id OR command_record.target_org_id IS DISTINCT FROM p_target_org_id
     OR command_record.target_user_id IS DISTINCT FROM p_target_user_id OR command_record.action<>p_action
     OR command_record.input_hash<>input_hash_value THEN
    RAISE EXCEPTION 'Platform user command id was reused with different input.' USING ERRCODE='23505'; END IF;
  IF command_record.status='completed' THEN RETURN command_record.result; END IF;
  SELECT * INTO membership_record FROM public.org_members
  WHERE org_id=p_target_org_id AND user_id=p_target_user_id FOR UPDATE;
  IF membership_record.user_id IS NULL OR membership_record.role::text='super_admin' THEN
    RAISE EXCEPTION 'Managed organization user was not found.' USING ERRCODE='P0002'; END IF;
  SELECT email,full_name,account_status INTO profile_email,profile_name,profile_status FROM public.profiles
  WHERE org_id=p_target_org_id AND user_id=p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Managed organization profile was not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO employee_record FROM public.employees
  WHERE org_id=p_target_org_id AND user_id=p_target_user_id FOR UPDATE;
  IF employee_record.id IS NOT NULL AND p_action='update_role' THEN
    IF p_expected_employee_version IS NULL OR employee_record.lifecycle_version<>p_expected_employee_version THEN
      RAISE EXCEPTION 'Employee changed; reload and retry.' USING ERRCODE='40001'; END IF;
  END IF;
  title_value:=CASE p_next_role
    WHEN 'admin' THEN 'Organization Admin' WHEN 'hr_admin' THEN 'HR Admin'
    WHEN 'hr_recruitment' THEN 'HR Recruiter' WHEN 'training_manager' THEN 'Training Manager'
    WHEN 'onground_agent_manager' THEN 'On-ground Agent Manager' WHEN 'promoter' THEN 'Promoter'
    WHEN 'finance_manager' THEN 'Finance Manager' WHEN 'accountant' THEN 'Accountant'
    WHEN 'finance_viewer' THEN 'Finance Viewer' WHEN 'sales_manager' THEN 'Sales Manager'
    WHEN 'sales' THEN 'Sales' WHEN 'field_agent' THEN 'Field Agent'
    WHEN 'merchant' THEN 'Merchant' ELSE 'Employee' END;
  next_status:=CASE WHEN p_action='suspend' THEN 'suspended' WHEN p_action='activate' THEN 'active' ELSE profile_status END;
  old_snapshot:=jsonb_build_object('role',membership_record.role::text,'account_status',profile_status,
    'job_title',employee_record.job_title,'employee_version',employee_record.lifecycle_version);
  IF p_action='update_role' THEN
    UPDATE public.org_members SET role=p_next_role::public.org_role
    WHERE org_id=p_target_org_id AND user_id=p_target_user_id;
    UPDATE public.profiles SET title=title_value,updated_at=now()
    WHERE org_id=p_target_org_id AND user_id=p_target_user_id;
    IF employee_record.id IS NOT NULL THEN
      UPDATE public.employees SET job_title=title_value WHERE id=employee_record.id RETURNING * INTO employee_record;
      PERFORM set_config('app.hr_structure_command','trusted',true);
      INSERT INTO public.employee_career_events(employee_id,event_type,previous_value,new_value,effective_date,notes,created_by)
      VALUES(employee_record.id,'role_change',old_snapshot,
        jsonb_build_object('role',p_next_role,'job_title',title_value,'employee_version',employee_record.lifecycle_version),
        public.organization_business_date(p_target_org_id,now()),'Platform organization-user role command',p_actor_user_id);
    END IF;
  ELSE
    UPDATE public.profiles SET account_status=next_status,updated_at=now()
    WHERE org_id=p_target_org_id AND user_id=p_target_user_id;
  END IF;
  new_snapshot:=jsonb_build_object('role',CASE WHEN p_action='update_role' THEN p_next_role ELSE membership_record.role::text END,
    'account_status',next_status,'job_title',CASE WHEN p_action='update_role' AND employee_record.id IS NOT NULL THEN title_value ELSE employee_record.job_title END,
    'employee_version',employee_record.lifecycle_version);
  event_payload:=jsonb_build_object('event_type','platform.organization_user_controlled','action',p_action,
    'target_org_id',p_target_org_id,'target_user_id',p_target_user_id,'old',old_snapshot,'new',new_snapshot);
  INSERT INTO public.business_events(org_id,source_type,business_key,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at)
  VALUES(p_target_org_id,'platform_user','controlled:'||p_command_id::text,event_payload,
    encode(digest(event_payload::text,'sha256'),'hex'),'completed',p_request_id,p_actor_user_id,now(),now())
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_target_org_id,event_id_value,'platform.organization_user_controlled',event_payload,
    encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.platform_audit_logs(actor_user_id,actor_role,action,target_org_id,target_user_id,target_type,target_id,metadata)
  VALUES(p_actor_user_id,'superadmin','organization_user.'||CASE p_action
    WHEN 'update_role' THEN 'role_updated' WHEN 'suspend' THEN 'suspended' ELSE 'activated' END,
    p_target_org_id,p_target_user_id,'org_member',p_target_user_id::text,
    jsonb_build_object('email',profile_email,'full_name',profile_name,'old',old_snapshot,'new',new_snapshot,'command_id',p_command_id));
  result_value:=jsonb_build_object('id',p_target_user_id,'org_id',p_target_org_id,
    'role',CASE WHEN p_action='update_role' THEN p_next_role ELSE membership_record.role::text END,
    'account_status',next_status,'employee_version',employee_record.lifecycle_version);
  UPDATE public.platform_user_commands SET status='completed',result=result_value,completed_at=now() WHERE id=p_command_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_platform_user_command(uuid,uuid,uuid,uuid,uuid,text,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_platform_user_command(uuid,uuid,uuid,uuid,uuid,text,text,integer)
  TO service_role;
