-- Atomic organization-structure commands for departments, locations, membership, and promotions.

ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.departments DROP CONSTRAINT IF EXISTS departments_version_check;
ALTER TABLE public.departments ADD CONSTRAINT departments_version_check CHECK (version > 0);
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_version_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_version_check CHECK (version > 0);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.departments GROUP BY org_id, lower(btrim(name)) HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM public.locations GROUP BY org_id, lower(btrim(name)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized department/location names must be resolved before structure controls.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS departments_org_normalized_name_unique ON public.departments(org_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS locations_org_normalized_name_unique ON public.locations(org_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.hr_structure_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  command_type text NOT NULL CHECK (command_type IN (
    'save_department','delete_department','set_department_members','save_location','delete_location','promote_employee'
  )),
  target_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_structure_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_structure_commands_service_only ON public.hr_structure_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS idx_hr_structure_commands_org_created ON public.hr_structure_commands(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_trusted_structure_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Organization structure writes require a trusted command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_trusted_department_write ON public.departments;
CREATE TRIGGER trg_guard_trusted_department_write BEFORE INSERT OR UPDATE OR DELETE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_structure_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_location_write ON public.locations;
CREATE TRIGGER trg_guard_trusted_location_write BEFORE INSERT OR UPDATE OR DELETE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_structure_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_career_event_write ON public.employee_career_events;
CREATE TRIGGER trg_guard_trusted_career_event_write BEFORE INSERT OR UPDATE OR DELETE ON public.employee_career_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_structure_write();

CREATE OR REPLACE FUNCTION public.execute_hr_structure_command(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_command_type text, p_target_id uuid, p_expected_version integer, p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.hr_structure_commands%ROWTYPE;
  department_row public.departments%ROWTYPE;
  location_row public.locations%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  affected_employee public.employees%ROWTYPE;
  actor_role_value text;
  input_hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_topic text;
  event_id uuid;
  target_version integer := 1;
  manager_id_value uuid;
  project_id_value uuid;
  desired_ids uuid[] := ARRAY[]::uuid[];
  affected_count integer := 0;
  previous_value jsonb;
  new_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_command_type NOT IN ('save_department','delete_department','set_department_members','save_location','delete_location','promote_employee')
     OR p_target_id IS NULL OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Structure command input is invalid.' USING ERRCODE = '22023';
  END IF;
  input_hash_value := encode(digest(jsonb_build_object('type', p_command_type, 'target', p_target_id,
    'expected', p_expected_version, 'payload', COALESCE(p_payload, '{}'::jsonb))::text, 'sha256'), 'hex');
  SELECT * INTO command_row FROM public.hr_structure_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.id IS NOT NULL THEN
    IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR command_row.command_type IS DISTINCT FROM p_command_type OR command_row.target_id IS DISTINCT FROM p_target_id
       OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
      RAISE EXCEPTION 'Structure command id was reused with different input.' USING ERRCODE = '23505';
    END IF;
    RETURN command_row.result;
  END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Organization membership is required.' USING ERRCODE = '42501'; END IF;
  IF p_command_type IN ('save_department','delete_department','set_department_members','promote_employee')
     AND actor_role_value NOT IN ('admin','super_admin','hr_admin') THEN
    RAISE EXCEPTION 'People management permission is required.' USING ERRCODE = '42501';
  END IF;
  IF p_command_type IN ('save_location','delete_location')
     AND actor_role_value NOT IN ('admin','super_admin','hr_admin','training_manager','sales_manager') THEN
    RAISE EXCEPTION 'Location management permission is required.' USING ERRCODE = '42501';
  END IF;

  IF p_command_type = 'save_department' THEN
    IF length(btrim(COALESCE(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'Department name is invalid.' USING ERRCODE = '22023';
    END IF;
    manager_id_value := NULLIF(p_payload->>'manager_employee_id','')::uuid;
    IF manager_id_value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees
      WHERE org_id = p_org_id AND id = manager_id_value AND lifecycle_status = 'active' AND lower(status::text) = 'active') THEN
      RAISE EXCEPTION 'Department manager must be an active organization employee.' USING ERRCODE = '23514';
    END IF;
    IF p_expected_version IS NULL THEN
      INSERT INTO public.departments(id,org_id,name,manager_employee_id,version)
      VALUES(p_target_id,p_org_id,btrim(p_payload->>'name'),manager_id_value,1) RETURNING * INTO department_row;
      event_topic := 'organization.department_created';
    ELSE
      SELECT * INTO department_row FROM public.departments WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
      IF department_row.id IS NULL THEN RAISE EXCEPTION 'Department was not found.' USING ERRCODE='P0002'; END IF;
      IF department_row.version <> p_expected_version THEN RAISE EXCEPTION 'Department version conflict.' USING ERRCODE='40001'; END IF;
      UPDATE public.departments SET name=btrim(p_payload->>'name'),manager_employee_id=manager_id_value,
        version=version+1,updated_at=now() WHERE id=p_target_id RETURNING * INTO department_row;
      event_topic := 'organization.department_updated';
    END IF;
    target_version := department_row.version;
    result_value := jsonb_build_object('department',to_jsonb(department_row));
    event_payload := jsonb_build_object('department_id',department_row.id,'name',department_row.name,
      'manager_employee_id',department_row.manager_employee_id,'version',target_version,'actor_user_id',p_actor_user_id);

  ELSIF p_command_type = 'delete_department' THEN
    SELECT * INTO department_row FROM public.departments WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
    IF department_row.id IS NULL THEN RAISE EXCEPTION 'Department was not found.' USING ERRCODE='P0002'; END IF;
    IF department_row.version <> p_expected_version THEN RAISE EXCEPTION 'Department version conflict.' USING ERRCODE='40001'; END IF;
    SELECT count(*)::integer INTO affected_count FROM public.employees WHERE org_id=p_org_id AND department_id=p_target_id;
    DELETE FROM public.departments WHERE id=p_target_id;
    target_version := department_row.version; event_topic := 'organization.department_deleted';
    result_value := jsonb_build_object('department_id',p_target_id,'affected_employees',affected_count);
    event_payload := result_value || jsonb_build_object('name',department_row.name,'version',target_version,'actor_user_id',p_actor_user_id);

  ELSIF p_command_type = 'set_department_members' THEN
    SELECT * INTO department_row FROM public.departments WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
    IF department_row.id IS NULL THEN RAISE EXCEPTION 'Department was not found.' USING ERRCODE='P0002'; END IF;
    IF department_row.version <> p_expected_version THEN RAISE EXCEPTION 'Department version conflict.' USING ERRCODE='40001'; END IF;
    IF jsonb_typeof(COALESCE(p_payload->'employee_ids','[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(p_payload->'employee_ids','[]'::jsonb)) > 1000 THEN
      RAISE EXCEPTION 'Department member list is invalid.' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT value::uuid),ARRAY[]::uuid[]) INTO desired_ids
      FROM jsonb_array_elements_text(COALESCE(p_payload->'employee_ids','[]'::jsonb));
    manager_id_value := NULLIF(p_payload->>'manager_employee_id','')::uuid;
    IF manager_id_value IS NOT NULL AND NOT manager_id_value = ANY(desired_ids) THEN desired_ids := array_append(desired_ids,manager_id_value); END IF;
    IF (SELECT count(*) FROM public.employees WHERE org_id=p_org_id AND id=ANY(desired_ids)
      AND lifecycle_status='active' AND lower(status::text)='active') <> cardinality(desired_ids) THEN
      RAISE EXCEPTION 'Every department member must be an active organization employee.' USING ERRCODE='23514';
    END IF;
    FOR affected_employee IN SELECT * FROM public.employees WHERE org_id=p_org_id
      AND (department_id=p_target_id OR id=ANY(desired_ids)) FOR UPDATE LOOP
      previous_value := jsonb_build_object('department_id',affected_employee.department_id,'manager_id',affected_employee.manager_id);
      UPDATE public.employees SET department_id=CASE WHEN affected_employee.id=ANY(desired_ids) THEN p_target_id ELSE NULL END,
        manager_id=CASE WHEN affected_employee.id=ANY(desired_ids) AND affected_employee.id IS DISTINCT FROM manager_id_value
          THEN manager_id_value WHEN affected_employee.id=manager_id_value THEN NULL
          WHEN affected_employee.manager_id=manager_id_value THEN NULL ELSE affected_employee.manager_id END,
        updated_at=now() WHERE id=affected_employee.id RETURNING * INTO employee_row;
      new_value := jsonb_build_object('department_id',employee_row.department_id,'manager_id',employee_row.manager_id);
      IF previous_value IS DISTINCT FROM new_value THEN
        INSERT INTO public.employee_career_events(employee_id,event_type,previous_value,new_value,effective_date,notes,created_by)
        VALUES(employee_row.id,'department_assignment',previous_value,new_value,
          public.organization_business_date(p_org_id,now()),'Department membership command',p_actor_user_id);
        affected_count := affected_count + 1;
      END IF;
    END LOOP;
    UPDATE public.departments SET manager_employee_id=manager_id_value,version=version+1,updated_at=now()
      WHERE id=p_target_id RETURNING * INTO department_row;
    target_version:=department_row.version; event_topic:='organization.department_members_changed';
    result_value:=jsonb_build_object('department',to_jsonb(department_row),'affected_employees',affected_count);
    event_payload:=jsonb_build_object('department_id',p_target_id,'manager_employee_id',manager_id_value,
      'affected_employees',affected_count,'version',target_version,'actor_user_id',p_actor_user_id);

  ELSIF p_command_type = 'save_location' THEN
    IF length(btrim(COALESCE(p_payload->>'name',''))) NOT BETWEEN 1 AND 160
       OR p_payload->>'type' NOT IN ('branch','booth','office','area')
       OR COALESCE((p_payload->>'radius_meters')::integer,100) NOT BETWEEN 1 AND 100000 THEN
      RAISE EXCEPTION 'Location details are invalid.' USING ERRCODE='22023';
    END IF;
    manager_id_value:=NULLIF(p_payload->>'manager_employee_id','')::uuid;
    project_id_value:=NULLIF(p_payload->>'project_id','')::uuid;
    IF manager_id_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employees WHERE org_id=p_org_id AND id=manager_id_value) THEN
      RAISE EXCEPTION 'Location manager is outside the organization.' USING ERRCODE='23514'; END IF;
    IF project_id_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_companies WHERE organization_id=p_org_id AND id=project_id_value) THEN
      RAISE EXCEPTION 'Location project is outside the organization.' USING ERRCODE='23514'; END IF;
    IF p_expected_version IS NULL THEN
      INSERT INTO public.locations(id,org_id,name,type,city,project_id,project_name,address_details,latitude,longitude,radius_meters,manager_employee_id,version)
      VALUES(p_target_id,p_org_id,btrim(p_payload->>'name'),(p_payload->>'type')::public.location_type,
        NULLIF(btrim(p_payload->>'city'),''),project_id_value,NULLIF(btrim(p_payload->>'project_name'),''),
        NULLIF(btrim(p_payload->>'address_details'),''),NULLIF(p_payload->>'latitude','')::numeric,
        NULLIF(p_payload->>'longitude','')::numeric,COALESCE((p_payload->>'radius_meters')::integer,100),manager_id_value,1)
      RETURNING * INTO location_row; event_topic:='organization.location_created';
    ELSE
      SELECT * INTO location_row FROM public.locations WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
      IF location_row.id IS NULL THEN RAISE EXCEPTION 'Location was not found.' USING ERRCODE='P0002'; END IF;
      IF location_row.version<>p_expected_version THEN RAISE EXCEPTION 'Location version conflict.' USING ERRCODE='40001'; END IF;
      UPDATE public.locations SET name=btrim(p_payload->>'name'),type=(p_payload->>'type')::public.location_type,
        city=NULLIF(btrim(p_payload->>'city'),''),project_id=project_id_value,project_name=NULLIF(btrim(p_payload->>'project_name'),''),
        address_details=NULLIF(btrim(p_payload->>'address_details'),''),latitude=NULLIF(p_payload->>'latitude','')::numeric,
        longitude=NULLIF(p_payload->>'longitude','')::numeric,radius_meters=COALESCE((p_payload->>'radius_meters')::integer,100),
        manager_employee_id=manager_id_value,version=version+1,updated_at=now() WHERE id=p_target_id RETURNING * INTO location_row;
      event_topic:='organization.location_updated';
    END IF;
    target_version:=location_row.version; result_value:=jsonb_build_object('location',to_jsonb(location_row));
    event_payload:=jsonb_build_object('location_id',location_row.id,'name',location_row.name,'version',target_version,'actor_user_id',p_actor_user_id);

  ELSIF p_command_type = 'delete_location' THEN
    SELECT * INTO location_row FROM public.locations WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
    IF location_row.id IS NULL THEN RAISE EXCEPTION 'Location was not found.' USING ERRCODE='P0002'; END IF;
    IF location_row.version<>p_expected_version THEN RAISE EXCEPTION 'Location version conflict.' USING ERRCODE='40001'; END IF;
    SELECT count(*)::integer INTO affected_count FROM public.employees WHERE org_id=p_org_id AND location_id=p_target_id;
    DELETE FROM public.locations WHERE id=p_target_id; target_version:=location_row.version; event_topic:='organization.location_deleted';
    result_value:=jsonb_build_object('location_id',p_target_id,'affected_employees',affected_count);
    event_payload:=result_value||jsonb_build_object('name',location_row.name,'version',target_version,'actor_user_id',p_actor_user_id);

  ELSE
    SELECT * INTO employee_row FROM public.employees WHERE org_id=p_org_id AND id=p_target_id FOR UPDATE;
    IF employee_row.id IS NULL THEN RAISE EXCEPTION 'Employee was not found.' USING ERRCODE='P0002'; END IF;
    IF employee_row.lifecycle_version<>p_expected_version THEN RAISE EXCEPTION 'Employee version conflict.' USING ERRCODE='40001'; END IF;
    IF length(btrim(COALESCE(p_payload->>'job_title',''))) NOT BETWEEN 1 AND 160
       OR NULLIF(p_payload->>'effective_date','') IS NULL THEN RAISE EXCEPTION 'Promotion details are invalid.' USING ERRCODE='22023'; END IF;
    manager_id_value:=NULLIF(p_payload->>'manager_id','')::uuid;
    IF manager_id_value=p_target_id THEN RAISE EXCEPTION 'Employee cannot manage themselves.' USING ERRCODE='23514'; END IF;
    IF manager_id_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employees WHERE org_id=p_org_id AND id=manager_id_value) THEN
      RAISE EXCEPTION 'Promotion manager is outside the organization.' USING ERRCODE='23514'; END IF;
    IF NULLIF(p_payload->>'department_id','') IS NOT NULL THEN
      SELECT * INTO department_row FROM public.departments WHERE org_id=p_org_id AND id=(p_payload->>'department_id')::uuid FOR UPDATE;
      IF department_row.id IS NULL THEN RAISE EXCEPTION 'Promotion department was not found.' USING ERRCODE='P0002'; END IF;
    END IF;
    previous_value:=jsonb_build_object('job_title',employee_row.job_title,'department_id',employee_row.department_id,'manager_id',employee_row.manager_id);
    UPDATE public.employees SET job_title=btrim(p_payload->>'job_title'),department_id=NULLIF(p_payload->>'department_id','')::uuid,
      manager_id=manager_id_value,updated_at=now() WHERE id=p_target_id RETURNING * INTO employee_row;
    IF COALESCE((p_payload->>'assign_department_manager')::boolean,false) AND department_row.id IS NOT NULL THEN
      UPDATE public.departments SET manager_employee_id=employee_row.id,version=version+1,updated_at=now()
        WHERE id=department_row.id RETURNING * INTO department_row;
    END IF;
    new_value:=jsonb_build_object('job_title',employee_row.job_title,'department_id',employee_row.department_id,
      'manager_id',employee_row.manager_id,'assigned_as_department_manager',COALESCE((p_payload->>'assign_department_manager')::boolean,false));
    INSERT INTO public.employee_career_events(employee_id,event_type,previous_value,new_value,effective_date,notes,created_by)
    VALUES(employee_row.id,'promoted',previous_value,new_value,(p_payload->>'effective_date')::date,
      NULLIF(left(btrim(p_payload->>'notes'),2000),''),p_actor_user_id);
    target_version:=employee_row.lifecycle_version; event_topic:='employee.updated';
    result_value:=jsonb_build_object('employee',to_jsonb(employee_row),'department',CASE WHEN department_row.id IS NULL THEN NULL ELSE to_jsonb(department_row) END);
    event_payload:=jsonb_build_object('event_type','employee.promoted','employee_id',employee_row.id,
      'changed_fields',jsonb_build_array('job_title','department_id','manager_id'),'effective_date',p_payload->>'effective_date',
      'version',target_version,'actor_user_id',p_actor_user_id);
  END IF;

  INSERT INTO public.business_events(org_id,source_type,business_key,event_version,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at)
  VALUES(p_org_id,'organization_structure',p_command_type||':'||p_command_id::text,target_version,event_payload,
    encode(digest(event_payload::text,'sha256'),'hex'),'completed',p_request_id,p_actor_user_id,now(),now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id,event_topic,event_payload,encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata)
  VALUES(p_org_id,p_request_id,p_actor_user_id,actor_role_value,p_command_type,'organization_structure',p_target_id::text,'success',
    CASE WHEN p_expected_version IS NULL THEN 201 ELSE 200 END,jsonb_build_object('command_id',p_command_id,'version',target_version));
  INSERT INTO public.hr_structure_commands(id,org_id,actor_user_id,request_id,command_type,target_id,input_hash,result)
  VALUES(p_command_id,p_org_id,p_actor_user_id,p_request_id,p_command_type,p_target_id,input_hash_value,result_value);
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_hr_structure_command(uuid,uuid,uuid,uuid,text,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_hr_structure_command(uuid,uuid,uuid,uuid,text,uuid,integer,jsonb) TO service_role;
