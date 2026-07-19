-- v90: versioned, atomic payroll deduction policy configuration.

ALTER TABLE public.deduction_rule_groups
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE UNIQUE INDEX IF NOT EXISTS deduction_rule_groups_org_normalized_name_key
  ON public.deduction_rule_groups(org_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.deduction_policy_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('save', 'delete')),
  target_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  result_snapshot jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(org_id,command_id)
);
ALTER TABLE public.deduction_policy_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deduction_policy_commands_service_only ON public.deduction_policy_commands;
CREATE POLICY deduction_policy_commands_service_only ON public.deduction_policy_commands
  FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.deduction_policy_commands FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.deduction_policy_commands TO service_role;

DROP POLICY IF EXISTS drg_insert ON public.deduction_rule_groups;
DROP POLICY IF EXISTS drg_update ON public.deduction_rule_groups;
DROP POLICY IF EXISTS drg_delete ON public.deduction_rule_groups;
CREATE POLICY drg_service_write ON public.deduction_rule_groups
  FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE OR REPLACE FUNCTION public.guard_deduction_policy_write()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF auth.role()<>'service_role' OR current_setting('app.deduction_policy_command',true)<>'trusted' THEN
    RAISE EXCEPTION 'Deduction policies must be changed through the policy command.' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS guard_deduction_policy_write_trigger ON public.deduction_rule_groups;
CREATE TRIGGER guard_deduction_policy_write_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.deduction_rule_groups
  FOR EACH ROW EXECUTE FUNCTION public.guard_deduction_policy_write();

CREATE OR REPLACE FUNCTION public.execute_deduction_policy_command(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,
  p_action text,p_target_id uuid,p_expected_version integer,p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE command_record public.deduction_policy_commands%ROWTYPE; policy_record public.deduction_rule_groups%ROWTYPE;
  actor_role text; normalized_payload jsonb; hash_value text; result_value jsonb;
  event_payload jsonb; event_id_value uuid; assigned_count integer;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN('save','delete') OR p_target_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Valid policy action, target, and command are required.' USING ERRCODE='22023'; END IF;
  SELECT role::text INTO actor_role FROM public.org_members WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  IF actor_role NOT IN('admin','hr_admin') THEN RAISE EXCEPTION 'Actor cannot manage deduction policies.' USING ERRCODE='42501'; END IF;
  normalized_payload:=jsonb_strip_nulls(COALESCE(p_payload,'{}'::jsonb));
  hash_value:=encode(digest(jsonb_build_object('action',p_action,'target_id',p_target_id,
    'expected_version',p_expected_version,'payload',normalized_payload)::text,'sha256'),'hex');
  SELECT * INTO command_record FROM public.deduction_policy_commands
  WHERE org_id=p_org_id AND command_id=p_command_id FOR UPDATE;
  IF command_record.id IS NOT NULL THEN
    IF command_record.action<>p_action OR command_record.target_id<>p_target_id
       OR command_record.actor_user_id<>p_actor_user_id OR command_record.payload_hash<>hash_value THEN
      RAISE EXCEPTION 'Command id was already used with different policy input.' USING ERRCODE='23505'; END IF;
    IF command_record.status='completed' AND command_record.result_snapshot IS NOT NULL THEN RETURN command_record.result_snapshot; END IF;
    RAISE EXCEPTION 'Deduction policy command is already processing.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.deduction_policy_commands(org_id,command_id,action,target_id,actor_user_id,payload_hash)
  VALUES(p_org_id,p_command_id,p_action,p_target_id,p_actor_user_id,hash_value);
  PERFORM set_config('app.deduction_policy_command','trusted',true);
  IF p_action='save' THEN
    IF length(btrim(COALESCE(normalized_payload->>'name','')))<2
       OR COALESCE((normalized_payload->>'late_grace_minutes')::integer,-1)<0
       OR COALESCE((normalized_payload->>'allowed_absent_days')::integer,-1)<0
       OR COALESCE((normalized_payload->>'deduction_per_late_hour')::numeric,-1)<0
       OR COALESCE((normalized_payload->>'deduction_per_absent_day')::numeric,-1)<0
       OR COALESCE((normalized_payload->>'deduction_per_excess_approved_day')::numeric,-1)<0 THEN
      RAISE EXCEPTION 'Policy name and non-negative rule values are required.' USING ERRCODE='23514'; END IF;
    IF p_expected_version IS NULL THEN
      INSERT INTO public.deduction_rule_groups(id,org_id,name,late_grace_minutes,deduction_per_late_hour,
        allowed_absent_days,deduction_per_absent_day,deduction_per_excess_approved_day)
      VALUES(p_target_id,p_org_id,btrim(normalized_payload->>'name'),
        (normalized_payload->>'late_grace_minutes')::integer,(normalized_payload->>'deduction_per_late_hour')::numeric,
        (normalized_payload->>'allowed_absent_days')::integer,(normalized_payload->>'deduction_per_absent_day')::numeric,
        (normalized_payload->>'deduction_per_excess_approved_day')::numeric) RETURNING * INTO policy_record;
    ELSE
      UPDATE public.deduction_rule_groups SET name=btrim(normalized_payload->>'name'),
        late_grace_minutes=(normalized_payload->>'late_grace_minutes')::integer,
        deduction_per_late_hour=(normalized_payload->>'deduction_per_late_hour')::numeric,
        allowed_absent_days=(normalized_payload->>'allowed_absent_days')::integer,
        deduction_per_absent_day=(normalized_payload->>'deduction_per_absent_day')::numeric,
        deduction_per_excess_approved_day=(normalized_payload->>'deduction_per_excess_approved_day')::numeric,
        version=version+1,updated_at=clock_timestamp()
      WHERE org_id=p_org_id AND id=p_target_id AND version=p_expected_version RETURNING * INTO policy_record;
      IF policy_record.id IS NULL THEN RAISE EXCEPTION 'Policy changed; reload and retry.' USING ERRCODE='40001'; END IF;
    END IF;
    result_value:=jsonb_build_object('policy',to_jsonb(policy_record));
  ELSE
    IF p_expected_version IS NULL THEN RAISE EXCEPTION 'Expected version is required for deletion.' USING ERRCODE='22023'; END IF;
    SELECT * INTO policy_record FROM public.deduction_rule_groups
    WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
    IF policy_record.id IS NULL THEN RAISE EXCEPTION 'Deduction policy was not found.' USING ERRCODE='P0002'; END IF;
    IF policy_record.version<>p_expected_version THEN RAISE EXCEPTION 'Policy changed; reload and retry.' USING ERRCODE='40001'; END IF;
    SELECT count(*) INTO assigned_count FROM public.employees
    WHERE org_id=p_org_id AND deduction_rule_group_id=p_target_id;
    IF assigned_count>0 THEN RAISE EXCEPTION 'Policy is assigned to % employees.',assigned_count USING ERRCODE='23503'; END IF;
    DELETE FROM public.deduction_rule_groups WHERE id=p_target_id;
    result_value:=jsonb_build_object('policy_id',p_target_id,'assigned_count',assigned_count);
  END IF;
  event_payload:=jsonb_build_object('policy_id',p_target_id,'action',p_action,
    'version',COALESCE(policy_record.version,p_expected_version),'actor_user_id',p_actor_user_id);
  INSERT INTO public.business_events(org_id,source_type,business_key,payload,payload_hash,status,request_id,
    actor_user_id,occurred_at,processed_at) VALUES(p_org_id,'payroll.deduction_policy',
    p_target_id::text||':'||p_action||':'||COALESCE(policy_record.version,p_expected_version,1)::text,
    event_payload,encode(digest(event_payload::text,'sha256'),'hex'),'completed',p_request_id,p_actor_user_id,
    clock_timestamp(),clock_timestamp()) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id_value,'payroll.deduction_policy_'||CASE p_action WHEN 'delete' THEN 'deleted' ELSE 'saved' END,
    event_payload,encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,
    outcome,status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role,
    'payroll.deduction_policy_'||p_action,'deduction_rule_group',p_target_id::text,'success',200,event_payload);
  UPDATE public.deduction_policy_commands SET status='completed',result_snapshot=result_value,completed_at=clock_timestamp()
  WHERE org_id=p_org_id AND command_id=p_command_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_deduction_policy_command(uuid,uuid,uuid,uuid,text,uuid,integer,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_deduction_policy_command(uuid,uuid,uuid,uuid,text,uuid,integer,jsonb)
  TO service_role;
