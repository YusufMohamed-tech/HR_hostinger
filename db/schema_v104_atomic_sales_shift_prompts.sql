-- Make shift-monitor prompt creation/response concurrency-safe and keep every
-- notification-worthy transition in the same transaction as its outbox event.

ALTER TABLE public.sales_shift_prompts
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.sales_shift_prompts'::regclass
      AND conname='sales_shift_prompts_version_check'
  ) THEN
    ALTER TABLE public.sales_shift_prompts
      ADD CONSTRAINT sales_shift_prompts_version_check CHECK(version>0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sales_shift_prompt_commands(
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  prompt_id uuid NOT NULL REFERENCES public.sales_shift_prompts(id) ON DELETE CASCADE,
  action text NOT NULL CHECK(action IN('respond')),
  input_hash text NOT NULL CHECK(length(input_hash)=64),
  status text NOT NULL DEFAULT 'processing' CHECK(status IN('processing','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sales_shift_prompt_commands_org_created
  ON public.sales_shift_prompt_commands(organization_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_sales_shift_prompt_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
BEGIN
  IF OLD.action='submitted_reason' AND NEW.action IS DISTINCT FROM OLD.action THEN
    RAISE EXCEPTION 'A submitted shift reason is final.' USING ERRCODE='55000';
  END IF;
  IF NEW.action='submitted_reason' AND (
    NEW.prompt_type<>'end_shift' OR length(btrim(COALESCE(NEW.reason,'')))<5
  ) THEN
    RAISE EXCEPTION 'A valid end-shift reason is required.' USING ERRCODE='23514';
  END IF;
  IF NEW.version<=OLD.version THEN NEW.version:=OLD.version+1; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_shift_prompt_guard ON public.sales_shift_prompts;
CREATE TRIGGER trg_sales_shift_prompt_guard
  BEFORE UPDATE ON public.sales_shift_prompts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_shift_prompt_update();

CREATE OR REPLACE FUNCTION public.ensure_sales_shift_prompt_atomic(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_company_id uuid,
  p_employee_id uuid,p_shift_id uuid,p_prompt_date date,p_prompt_type text,p_prompt_key text,
  p_target_amount numeric,p_achieved_amount numeric,p_required_percent numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  prompt_record public.sales_shift_prompts%ROWTYPE;
  actor_role_value text;
  actor_name_value text;
  company_name_value text;
  inserted_value boolean:=false;
  event_topic_value text;
  event_payload jsonb;
  payload_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_company_id IS NULL
     OR p_prompt_date IS NULL OR p_prompt_type NOT IN('hourly','mid_shift','end_shift')
     OR length(btrim(COALESCE(p_prompt_key,'')))<1
     OR COALESCE(p_target_amount,-1)<0 OR COALESCE(p_achieved_amount,-1)<0
     OR COALESCE(p_required_percent,-1)<0 THEN
    RAISE EXCEPTION 'Shift prompt input is invalid.' USING ERRCODE='22023';
  END IF;
  IF p_prompt_date<>public.organization_business_date(p_org_id,now()) THEN
    RAISE EXCEPTION 'Shift prompt date must be the organization business date.' USING ERRCODE='22023';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id=p_org_id AND member.user_id=p_actor_user_id;
  IF actor_role_value NOT IN('sales','sales_manager') THEN
    RAISE EXCEPTION 'Sales role is required.' USING ERRCODE='42501';
  END IF;
  SELECT company.name INTO company_name_value
  FROM public.sales_companies company
  WHERE company.organization_id=p_org_id AND company.id=p_company_id AND company.is_active;
  IF company_name_value IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.sales_company_assignments assignment
    WHERE assignment.organization_id=p_org_id AND assignment.company_id=p_company_id
      AND assignment.user_id=p_actor_user_id AND assignment.is_active
      AND assignment.start_date<=p_prompt_date
      AND (assignment.end_date IS NULL OR assignment.end_date>=p_prompt_date)
  ) THEN
    RAISE EXCEPTION 'Active sales company assignment is required.' USING ERRCODE='42501';
  END IF;
  IF p_employee_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.employees employee
    WHERE employee.org_id=p_org_id AND employee.id=p_employee_id AND employee.user_id=p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Shift prompt employee is outside the actor scope.' USING ERRCODE='23503';
  END IF;
  IF p_shift_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.shifts shift WHERE shift.org_id=p_org_id AND shift.id=p_shift_id
  ) THEN
    RAISE EXCEPTION 'Shift prompt shift is outside the organization.' USING ERRCODE='23503';
  END IF;

  INSERT INTO public.sales_shift_prompts(
    organization_id,company_id,sales_agent_id,employee_id,shift_id,prompt_date,
    prompt_type,prompt_key,target_amount,achieved_amount,required_percent,action
  ) VALUES(
    p_org_id,p_company_id,p_actor_user_id,p_employee_id,p_shift_id,p_prompt_date,
    p_prompt_type,btrim(p_prompt_key),p_target_amount,p_achieved_amount,p_required_percent,'shown'
  )
  ON CONFLICT(organization_id,sales_agent_id,company_id,prompt_date,prompt_type,prompt_key) DO NOTHING
  RETURNING * INTO prompt_record;
  inserted_value:=prompt_record.id IS NOT NULL;

  IF NOT inserted_value THEN
    SELECT * INTO prompt_record FROM public.sales_shift_prompts
    WHERE organization_id=p_org_id AND sales_agent_id=p_actor_user_id AND company_id=p_company_id
      AND prompt_date=p_prompt_date AND prompt_type=p_prompt_type AND prompt_key=btrim(p_prompt_key)
    FOR UPDATE;
    IF prompt_record.id IS NULL THEN
      RAISE EXCEPTION 'Shift prompt could not be resolved.' USING ERRCODE='P0002';
    END IF;
    IF prompt_record.target_amount IS DISTINCT FROM p_target_amount
       OR prompt_record.achieved_amount IS DISTINCT FROM p_achieved_amount
       OR prompt_record.required_percent IS DISTINCT FROM p_required_percent
       OR prompt_record.employee_id IS DISTINCT FROM p_employee_id
       OR prompt_record.shift_id IS DISTINCT FROM p_shift_id THEN
      UPDATE public.sales_shift_prompts SET
        target_amount=p_target_amount,achieved_amount=p_achieved_amount,
        required_percent=p_required_percent,employee_id=p_employee_id,shift_id=p_shift_id,
        version=version+1
      WHERE id=prompt_record.id RETURNING * INTO prompt_record;
    END IF;
  END IF;

  IF inserted_value THEN
    SELECT COALESCE(employee.full_name,profile.full_name,profile.email,'Sales')
      INTO actor_name_value
    FROM public.profiles profile
    LEFT JOIN public.employees employee ON employee.org_id=p_org_id AND employee.user_id=profile.user_id
    WHERE profile.user_id=p_actor_user_id;
    INSERT INTO public.operational_audit_logs(
      org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata
    ) VALUES(
      p_org_id,p_request_id,p_actor_user_id,actor_role_value,'sales.shift_prompt_created',
      'sales_shift_prompts',prompt_record.id::text,'success',201,
      jsonb_build_object('prompt_type',p_prompt_type,'company_id',p_company_id,'prompt_date',p_prompt_date)
    );
    IF p_prompt_type IN('mid_shift','end_shift') THEN
      event_topic_value:='sales.shift_prompt_created';
      event_payload:=jsonb_build_object(
        'event_type',event_topic_value,'prompt_id',prompt_record.id,'prompt_type',p_prompt_type,
        'company_id',p_company_id,'company_name',company_name_value,
        'sales_agent_id',p_actor_user_id,'agent_name',COALESCE(actor_name_value,'Sales'),
        'prompt_date',p_prompt_date,'target_amount',p_target_amount,
        'achieved_amount',p_achieved_amount,'version',prompt_record.version
      );
      payload_hash_value:=encode(digest(event_payload::text,'sha256'),'hex');
      INSERT INTO public.business_events(
        org_id,source_type,business_key,event_version,payload,payload_hash,status,
        request_id,actor_user_id,occurred_at,processed_at
      ) VALUES(
        p_org_id,'sales_shift_monitor','prompt-created:'||prompt_record.id::text,prompt_record.version,
        event_payload,payload_hash_value,'completed',p_request_id,p_actor_user_id,now(),now()
      ) RETURNING id INTO event_id_value;
      INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
      VALUES(p_org_id,event_id_value,event_topic_value,event_payload,payload_hash_value);
    END IF;
  END IF;
  RETURN to_jsonb(prompt_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_sales_shift_prompt_atomic(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,p_prompt_id uuid,
  p_expected_version integer,p_action text,p_reason text DEFAULT NULL,p_snooze_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  command_record public.sales_shift_prompt_commands%ROWTYPE;
  prompt_record public.sales_shift_prompts%ROWTYPE;
  actor_role_value text;
  input_value jsonb;
  input_hash_value text;
  event_payload jsonb;
  payload_hash_value text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL
     OR p_prompt_id IS NULL OR COALESCE(p_expected_version,0)<1
     OR p_action NOT IN('snooze','acknowledge','open_sales','submit_reason')
     OR COALESCE(p_snooze_minutes,0) NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Shift prompt response input is invalid.' USING ERRCODE='22023';
  END IF;
  input_value:=jsonb_build_object('prompt_id',p_prompt_id,'expected_version',p_expected_version,
    'action',p_action,'reason',NULLIF(btrim(COALESCE(p_reason,'')),''),'snooze_minutes',p_snooze_minutes);
  input_hash_value:=encode(digest(input_value::text,'sha256'),'hex');
  INSERT INTO public.sales_shift_prompt_commands(
    id,organization_id,actor_user_id,request_id,prompt_id,action,input_hash
  ) VALUES(p_command_id,p_org_id,p_actor_user_id,p_request_id,p_prompt_id,'respond',input_hash_value)
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.sales_shift_prompt_commands WHERE id=p_command_id FOR UPDATE;
  IF command_record.organization_id IS DISTINCT FROM p_org_id
     OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.prompt_id IS DISTINCT FROM p_prompt_id
     OR command_record.action<>'respond' OR command_record.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Shift prompt command id was reused with different input.' USING ERRCODE='23505';
  END IF;
  IF command_record.status='completed' THEN RETURN command_record.result; END IF;
  SELECT member.role::text INTO actor_role_value FROM public.org_members member
  WHERE member.org_id=p_org_id AND member.user_id=p_actor_user_id;
  IF actor_role_value NOT IN('sales','sales_manager') THEN
    RAISE EXCEPTION 'Sales role is required.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO prompt_record FROM public.sales_shift_prompts
  WHERE organization_id=p_org_id AND id=p_prompt_id AND sales_agent_id=p_actor_user_id FOR UPDATE;
  IF prompt_record.id IS NULL THEN RAISE EXCEPTION 'Shift prompt was not found.' USING ERRCODE='P0002'; END IF;
  IF prompt_record.version<>p_expected_version THEN
    RAISE EXCEPTION 'Shift prompt changed; refresh before responding.' USING ERRCODE='40001';
  END IF;
  IF prompt_record.action='submitted_reason' THEN
    RAISE EXCEPTION 'Shift reason was already submitted.' USING ERRCODE='55000';
  END IF;

  IF p_action='snooze' THEN
    UPDATE public.sales_shift_prompts SET action='snoozed',
      snoozed_until=now()+make_interval(mins=>p_snooze_minutes),version=version+1
    WHERE id=p_prompt_id RETURNING * INTO prompt_record;
  ELSIF p_action IN('acknowledge','open_sales') THEN
    UPDATE public.sales_shift_prompts SET action='acknowledged',snoozed_until=NULL,version=version+1
    WHERE id=p_prompt_id RETURNING * INTO prompt_record;
  ELSE
    IF prompt_record.prompt_type<>'end_shift' OR length(btrim(COALESCE(p_reason,'')))<5 THEN
      RAISE EXCEPTION 'A clear end-shift reason is required.' USING ERRCODE='23514';
    END IF;
    UPDATE public.sales_shift_prompts SET action='submitted_reason',reason=btrim(p_reason),
      reason_submitted_at=now(),snoozed_until=NULL,version=version+1
    WHERE id=p_prompt_id RETURNING * INTO prompt_record;
    event_payload:=jsonb_build_object(
      'event_type','sales.shift_reason_submitted','prompt_id',prompt_record.id,
      'company_id',prompt_record.company_id,'sales_agent_id',prompt_record.sales_agent_id,
      'prompt_date',prompt_record.prompt_date,'reason',prompt_record.reason,
      'target_amount',prompt_record.target_amount,'achieved_amount',prompt_record.achieved_amount,
      'version',prompt_record.version
    );
    payload_hash_value:=encode(digest(event_payload::text,'sha256'),'hex');
    INSERT INTO public.business_events(
      org_id,source_type,business_key,event_version,payload,payload_hash,status,
      request_id,actor_user_id,occurred_at,processed_at
    ) VALUES(
      p_org_id,'sales_shift_monitor','reason-submitted:'||prompt_record.id::text,prompt_record.version,
      event_payload,payload_hash_value,'completed',p_request_id,p_actor_user_id,now(),now()
    ) RETURNING id INTO event_id_value;
    INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
    VALUES(p_org_id,event_id_value,'sales.shift_reason_submitted',event_payload,payload_hash_value);
  END IF;

  result_value:=to_jsonb(prompt_record);
  INSERT INTO public.operational_audit_logs(
    org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata
  ) VALUES(
    p_org_id,p_request_id,p_actor_user_id,actor_role_value,'sales.shift_prompt_'||p_action,
    'sales_shift_prompts',p_prompt_id::text,'success',200,
    jsonb_build_object('prompt_type',prompt_record.prompt_type,'version',prompt_record.version)
  );
  UPDATE public.sales_shift_prompt_commands SET status='completed',result=result_value,completed_at=now()
  WHERE id=p_command_id;
  RETURN result_value;
END;
$$;

ALTER TABLE public.sales_shift_prompt_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_shift_prompt_commands_service ON public.sales_shift_prompt_commands;
CREATE POLICY sales_shift_prompt_commands_service ON public.sales_shift_prompt_commands
  FOR ALL USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');

DROP POLICY IF EXISTS sales_shift_prompts_insert ON public.sales_shift_prompts;
CREATE POLICY sales_shift_prompts_insert ON public.sales_shift_prompts
  FOR INSERT WITH CHECK(auth.role()='service_role');
DROP POLICY IF EXISTS sales_shift_prompts_update ON public.sales_shift_prompts;
CREATE POLICY sales_shift_prompts_update ON public.sales_shift_prompts
  FOR UPDATE USING(auth.role()='service_role') WITH CHECK(auth.role()='service_role');

REVOKE ALL ON FUNCTION public.guard_sales_shift_prompt_update() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ensure_sales_shift_prompt_atomic(uuid,uuid,uuid,uuid,uuid,uuid,date,text,text,numeric,numeric,numeric)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.respond_sales_shift_prompt_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_sales_shift_prompt_atomic(uuid,uuid,uuid,uuid,uuid,uuid,date,text,text,numeric,numeric,numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_sales_shift_prompt_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,integer)
  TO service_role;
