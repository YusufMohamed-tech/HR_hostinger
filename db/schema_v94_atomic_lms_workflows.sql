-- v94: atomic LMS assignment, rubric, and submission-review workflows.

ALTER TABLE public.lms_project_rubric_items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.lms_project_review_items
  DROP CONSTRAINT IF EXISTS lms_project_review_items_rubric_item_id_fkey;
ALTER TABLE public.lms_project_review_items
  ADD CONSTRAINT lms_project_review_items_rubric_item_id_fkey
  FOREIGN KEY(rubric_item_id) REFERENCES public.lms_project_rubric_items(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.lms_workflow_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('assign_learning', 'save_rubric', 'review_submission')),
  target_id uuid,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lms_workflow_commands_org_created
  ON public.lms_workflow_commands(org_id, created_at DESC);
ALTER TABLE public.lms_workflow_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_workflow_commands_service_only ON public.lms_workflow_commands;
CREATE POLICY lms_workflow_commands_service_only ON public.lms_workflow_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.lms_actor_can_manage_course(
  p_org_id uuid, p_actor_user_id uuid, p_course_id uuid, p_permission text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.org_members member
      WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
        AND member.role::text IN ('admin', 'hr_admin', 'super_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.platform_admins platform
      WHERE platform.user_id = p_actor_user_id AND platform.role = 'superadmin' AND platform.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.lms_course_instructors instructor
      JOIN public.employees actor_employee
        ON actor_employee.org_id = instructor.org_id AND actor_employee.id = instructor.employee_id
      WHERE instructor.org_id = p_org_id AND instructor.course_id = p_course_id
        AND actor_employee.user_id = p_actor_user_id
        AND CASE p_permission
          WHEN 'can_review_tasks' THEN instructor.can_review_tasks
          WHEN 'can_moderate_community' THEN instructor.can_moderate_community
          WHEN 'any' THEN true
          ELSE instructor.can_edit_content END
    )
    OR EXISTS (
      SELECT 1 FROM public.org_members member
      JOIN public.lms_courses course ON course.org_id = member.org_id AND course.id = p_course_id
      WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
        AND member.role::text = 'training_manager' AND course.created_by = p_actor_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.assign_lms_learning_atomic(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_course_id uuid, p_learning_path_id uuid, p_assignment_type text, p_target_id text,
  p_due_date date, p_course_ids uuid[], p_employee_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_record public.lms_workflow_commands%ROWTYPE;
  actor_role_value text;
  actor_employee_id uuid;
  target_value uuid;
  input_value jsonb;
  input_hash_value text;
  course_ids_value uuid[];
  employee_ids_value uuid[];
  rule_record public.lms_assignment_rules%ROWTYPE;
  enrollment_rows jsonb;
  recipient_user_ids jsonb;
  event_payload jsonb;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL
     OR p_assignment_type NOT IN ('employee','department','team','location','role','all') THEN
    RAISE EXCEPTION 'LMS assignment command input is invalid.' USING ERRCODE = '22023';
  END IF;
  course_ids_value := ARRAY(SELECT DISTINCT unnest(COALESCE(p_course_ids, ARRAY[]::uuid[])));
  employee_ids_value := ARRAY(SELECT DISTINCT unnest(COALESCE(p_employee_ids, ARRAY[]::uuid[])));
  IF cardinality(course_ids_value) = 0 OR cardinality(employee_ids_value) = 0 THEN
    RAISE EXCEPTION 'At least one course and employee are required.' USING ERRCODE = '23514';
  END IF;
  target_value := COALESCE(p_course_id, p_learning_path_id, p_command_id);
  input_value := jsonb_build_object('course_id',p_course_id,'learning_path_id',p_learning_path_id,
    'assignment_type',p_assignment_type,'target_id',p_target_id,'due_date',p_due_date,
    'course_ids',to_jsonb(course_ids_value),'employee_ids',to_jsonb(employee_ids_value));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.lms_workflow_commands(id,org_id,actor_user_id,request_id,action,target_id,input_hash)
  VALUES(p_command_id,p_org_id,p_actor_user_id,p_request_id,'assign_learning',target_value,input_hash_value)
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.lms_workflow_commands WHERE id=p_command_id FOR UPDATE;
  IF command_record.org_id IS DISTINCT FROM p_org_id OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.action <> 'assign_learning' OR command_record.target_id IS DISTINCT FROM target_value
     OR command_record.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'LMS workflow command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_record.status='completed' THEN RETURN command_record.result; END IF;

  SELECT role::text INTO actor_role_value FROM public.org_members
  WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  SELECT id INTO actor_employee_id FROM public.employees
  WHERE org_id=p_org_id AND user_id=p_actor_user_id AND lifecycle_status IN ('onboarding','active');
  IF actor_role_value NOT IN ('admin','hr_admin','training_manager','super_admin')
     AND NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=p_actor_user_id AND role='superadmin' AND status='active') THEN
    RAISE EXCEPTION 'Elevated LMS permission is required.' USING ERRCODE = '42501';
  END IF;
  IF p_course_id IS NULL AND p_learning_path_id IS NULL THEN
    RAISE EXCEPTION 'A course or learning path is required.' USING ERRCODE = '23514';
  END IF;
  IF p_course_id IS NOT NULL AND (cardinality(course_ids_value)<>1 OR course_ids_value[1]<>p_course_id) THEN
    RAISE EXCEPTION 'Course assignment scope is inconsistent.' USING ERRCODE = '23514';
  END IF;
  IF p_learning_path_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.lms_learning_paths
      WHERE org_id=p_org_id AND id=p_learning_path_id AND status='published') THEN
      RAISE EXCEPTION 'Published learning path was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS(
      (SELECT unnest(course_ids_value) EXCEPT SELECT course_id FROM public.lms_learning_path_courses
        WHERE org_id=p_org_id AND learning_path_id=p_learning_path_id)
      UNION ALL
      (SELECT course_id FROM public.lms_learning_path_courses
        WHERE org_id=p_org_id AND learning_path_id=p_learning_path_id EXCEPT SELECT unnest(course_ids_value))
    ) THEN RAISE EXCEPTION 'Learning-path course scope is inconsistent.' USING ERRCODE = '23514'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(course_ids_value) course_id_value WHERE NOT EXISTS(
    SELECT 1 FROM public.lms_courses WHERE org_id=p_org_id AND id=course_id_value AND status='published'
  )) THEN RAISE EXCEPTION 'Every assigned course must be published in this organization.' USING ERRCODE = '23503'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(employee_ids_value) employee_id_value WHERE NOT EXISTS(
    SELECT 1 FROM public.employees WHERE org_id=p_org_id AND id=employee_id_value
      AND lifecycle_status='active' AND lower(status)='active'
  )) THEN RAISE EXCEPTION 'Every assignment target must be an active employee in this organization.' USING ERRCODE = '23503'; END IF;
  IF actor_role_value='training_manager' AND EXISTS(
    SELECT 1 FROM unnest(employee_ids_value) employee_id_value
    JOIN public.employees target_employee ON target_employee.org_id=p_org_id AND target_employee.id=employee_id_value
    LEFT JOIN public.departments department ON department.org_id=p_org_id AND department.id=target_employee.department_id
    LEFT JOIN public.locations location ON location.org_id=p_org_id AND location.id=target_employee.location_id
    WHERE actor_employee_id IS NULL OR (
      target_employee.manager_id IS DISTINCT FROM actor_employee_id
      AND department.manager_employee_id IS DISTINCT FROM actor_employee_id
      AND location.manager_employee_id IS DISTINCT FROM actor_employee_id
    )
  ) THEN RAISE EXCEPTION 'Training manager assignment exceeds employee scope.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.lms_assignment_rules(org_id,course_id,learning_path_id,assignment_type,target_id,due_date,assigned_by,is_active)
  VALUES(p_org_id,p_course_id,p_learning_path_id,p_assignment_type,NULLIF(btrim(COALESCE(p_target_id,'')),''),p_due_date,p_actor_user_id,true)
  RETURNING * INTO rule_record;
  WITH inserted AS (
    INSERT INTO public.lms_enrollments(org_id,course_id,employee_id,assigned_by,due_date,status)
    SELECT p_org_id,course_id_value,employee_id_value,p_actor_user_id,p_due_date,'assigned'
    FROM unnest(course_ids_value) course_id_value CROSS JOIN unnest(employee_ids_value) employee_id_value
    ON CONFLICT (org_id,course_id,employee_id) WHERE status<>'cancelled' DO NOTHING
    RETURNING *
  ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted) ORDER BY inserted.id),'[]'::jsonb) INTO enrollment_rows FROM inserted;
  SELECT COALESCE(jsonb_agg(user_id ORDER BY user_id),'[]'::jsonb) INTO recipient_user_ids
  FROM public.employees WHERE org_id=p_org_id AND id=ANY(employee_ids_value) AND user_id IS NOT NULL;
  event_payload:=jsonb_build_object('event_type','lms.learning_assigned','rule_id',rule_record.id,
    'course_ids',to_jsonb(course_ids_value),'employee_ids',to_jsonb(employee_ids_value),
    'recipient_user_ids',recipient_user_ids,'enrollment_count',jsonb_array_length(enrollment_rows));
  INSERT INTO public.business_events(org_id,source_type,business_key,payload,payload_hash,status,request_id,
    actor_user_id,occurred_at,processed_at) VALUES(p_org_id,'lms','learning-assigned:'||p_command_id::text,
    event_payload,encode(digest(event_payload::text,'sha256'),'hex'),'completed',p_request_id,p_actor_user_id,now(),now())
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id_value,'lms.learning_assigned',event_payload,encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,
    outcome,status_code,metadata) VALUES(p_org_id,p_request_id,p_actor_user_id,COALESCE(actor_role_value,'superadmin'),
    'lms.learning_assigned','lms_assignment_rules',rule_record.id::text,'success',201,event_payload);
  result_value:=jsonb_build_object('rule',to_jsonb(rule_record),'enrollments',enrollment_rows);
  UPDATE public.lms_workflow_commands SET status='completed',result=result_value,completed_at=now() WHERE id=p_command_id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_lms_project_rubric_atomic(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,p_task_id uuid,p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_record public.lms_workflow_commands%ROWTYPE;
  task_record public.lms_tasks%ROWTYPE;
  rubric_record public.lms_project_rubrics%ROWTYPE;
  actor_role_value text;
  input_hash_value text;
  items_value jsonb;
  item_value jsonb;
  item_id_value uuid;
  total_points_value numeric:=0;
  pass_points_value numeric;
  result_value jsonb;
  event_payload jsonb;
  event_id_value uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL OR p_task_id IS NULL
     OR jsonb_typeof(COALESCE(p_payload,'{}'::jsonb))<>'object' THEN
    RAISE EXCEPTION 'LMS rubric command input is invalid.' USING ERRCODE='22023'; END IF;
  input_hash_value:=encode(digest(jsonb_build_object('task_id',p_task_id,'payload',p_payload)::text,'sha256'),'hex');
  INSERT INTO public.lms_workflow_commands(id,org_id,actor_user_id,request_id,action,target_id,input_hash)
  VALUES(p_command_id,p_org_id,p_actor_user_id,p_request_id,'save_rubric',p_task_id,input_hash_value) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.lms_workflow_commands WHERE id=p_command_id FOR UPDATE;
  IF command_record.org_id IS DISTINCT FROM p_org_id OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.action<>'save_rubric' OR command_record.target_id IS DISTINCT FROM p_task_id
     OR command_record.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'LMS workflow command id was reused with different input.' USING ERRCODE='23505'; END IF;
  IF command_record.status='completed' THEN RETURN command_record.result; END IF;
  SELECT * INTO task_record FROM public.lms_tasks WHERE org_id=p_org_id AND id=p_task_id FOR UPDATE;
  IF task_record.id IS NULL THEN RAISE EXCEPTION 'LMS project was not found.' USING ERRCODE='P0002'; END IF;
  IF NOT public.lms_actor_can_manage_course(p_org_id,p_actor_user_id,task_record.course_id,'can_edit_content') THEN
    RAISE EXCEPTION 'Course content permission is required.' USING ERRCODE='42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  items_value:=COALESCE(p_payload->'items','[]'::jsonb);
  IF jsonb_typeof(items_value)<>'array' OR jsonb_array_length(items_value)=0 THEN
    RAISE EXCEPTION 'At least one rubric item is required.' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(items_value) WHERE NULLIF(value->>'id','') IS NOT NULL)
     <>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(items_value)
        WHERE NULLIF(value->>'id','') IS NOT NULL) THEN
    RAISE EXCEPTION 'Rubric item ids must be unique.' USING ERRCODE='23514'; END IF;
  FOR item_value IN SELECT value FROM jsonb_array_elements(items_value) LOOP
    IF length(btrim(COALESCE(item_value->>'title','')))<1 OR COALESCE((item_value->>'points')::numeric,1)<0 THEN
      RAISE EXCEPTION 'Rubric item title and points are invalid.' USING ERRCODE='23514'; END IF;
    total_points_value:=total_points_value+COALESCE((item_value->>'points')::numeric,1);
  END LOOP;
  pass_points_value:=COALESCE((p_payload->>'pass_points')::numeric,round(total_points_value*0.7,2));
  IF pass_points_value<0 OR pass_points_value>total_points_value THEN
    RAISE EXCEPTION 'Rubric passing points must be within total points.' USING ERRCODE='23514'; END IF;
  INSERT INTO public.lms_project_rubrics(org_id,task_id,course_id,title,description,total_points,pass_points,created_by,updated_at)
  VALUES(p_org_id,p_task_id,task_record.course_id,COALESCE(NULLIF(btrim(p_payload->>'title'),''),'معايير تقييم المشروع'),
    NULLIF(btrim(COALESCE(p_payload->>'description','')),''),total_points_value,pass_points_value,p_actor_user_id,now())
  ON CONFLICT(org_id,task_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
    total_points=EXCLUDED.total_points,pass_points=EXCLUDED.pass_points,updated_at=now()
  RETURNING * INTO rubric_record;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(items_value) item WHERE NULLIF(item->>'id','') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.lms_project_rubric_items existing
      WHERE existing.org_id=p_org_id AND existing.rubric_id=rubric_record.id AND existing.id=(item->>'id')::uuid)) THEN
    RAISE EXCEPTION 'Rubric item is outside this rubric.' USING ERRCODE='23503'; END IF;
  UPDATE public.lms_project_rubric_items existing SET is_active=false,updated_at=now()
  WHERE existing.org_id=p_org_id AND existing.rubric_id=rubric_record.id AND existing.is_active
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items_value) item WHERE NULLIF(item->>'id','')::uuid=existing.id);
  FOR item_value IN SELECT value FROM jsonb_array_elements(items_value) LOOP
    item_id_value:=NULLIF(item_value->>'id','')::uuid;
    IF item_id_value IS NULL THEN
      INSERT INTO public.lms_project_rubric_items(org_id,rubric_id,task_id,course_id,title,description,passing_criteria,points,sort_order)
      VALUES(p_org_id,rubric_record.id,p_task_id,task_record.course_id,btrim(item_value->>'title'),
        NULLIF(btrim(COALESCE(item_value->>'description','')),''),NULLIF(btrim(COALESCE(item_value->>'passing_criteria','')),''),
        COALESCE((item_value->>'points')::numeric,1),COALESCE((item_value->>'sort_order')::integer,0));
    ELSE
      UPDATE public.lms_project_rubric_items SET title=btrim(item_value->>'title'),
        description=NULLIF(btrim(COALESCE(item_value->>'description','')),''),
        passing_criteria=NULLIF(btrim(COALESCE(item_value->>'passing_criteria','')),''),
        points=COALESCE((item_value->>'points')::numeric,1),sort_order=COALESCE((item_value->>'sort_order')::integer,0),
        is_active=true,updated_at=now()
      WHERE org_id=p_org_id AND rubric_id=rubric_record.id AND id=item_id_value;
    END IF;
  END LOOP;
  SELECT jsonb_build_object('rubric',to_jsonb(rubric_record),'items',COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.sort_order,item.id),'[]'::jsonb))
  INTO result_value FROM public.lms_project_rubric_items item
  WHERE item.org_id=p_org_id AND item.rubric_id=rubric_record.id AND item.is_active;
  event_payload:=jsonb_build_object('event_type','lms.rubric_saved','task_id',p_task_id,'course_id',task_record.course_id,
    'rubric_id',rubric_record.id,'item_count',jsonb_array_length(result_value->'items'));
  INSERT INTO public.business_events(org_id,source_type,business_key,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at)
  VALUES(p_org_id,'lms','rubric-saved:'||p_command_id::text,event_payload,encode(digest(event_payload::text,'sha256'),'hex'),
    'completed',p_request_id,p_actor_user_id,now(),now()) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id_value,'lms.rubric_saved',event_payload,encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata)
  VALUES(p_org_id,p_request_id,p_actor_user_id,COALESCE(actor_role_value,'instructor'),'lms.rubric_saved','lms_project_rubrics',
    rubric_record.id::text,'success',200,event_payload);
  UPDATE public.lms_workflow_commands SET status='completed',result=result_value,completed_at=now() WHERE id=p_command_id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_lms_submission_atomic(
  p_org_id uuid,p_actor_user_id uuid,p_request_id uuid,p_command_id uuid,p_submission_id uuid,
  p_score numeric,p_feedback text,p_review_status text,p_rubric_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_record public.lms_workflow_commands%ROWTYPE;
  submission_record public.lms_task_submissions%ROWTYPE;
  task_record public.lms_tasks%ROWTYPE;
  review_record public.lms_task_reviews%ROWTYPE;
  reviewer_employee_id_value uuid;
  actor_role_value text;
  actor_allowed boolean:=false;
  input_value jsonb;
  input_hash_value text;
  rubric_items_value jsonb;
  item_value jsonb;
  rubric_points numeric;
  learner_user_id uuid;
  completion_value jsonb;
  event_payload jsonb;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE='42501'; END IF;
  rubric_items_value:=COALESCE(p_rubric_items,'[]'::jsonb);
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL OR p_submission_id IS NULL
     OR p_score IS NULL OR p_score<0 OR p_review_status NOT IN('accepted','rejected','needs_revision')
     OR jsonb_typeof(rubric_items_value)<>'array' THEN
    RAISE EXCEPTION 'LMS review command input is invalid.' USING ERRCODE='22023'; END IF;
  input_value:=jsonb_build_object('submission_id',p_submission_id,'score',p_score,'feedback',p_feedback,
    'review_status',p_review_status,'rubric_items',rubric_items_value);
  input_hash_value:=encode(digest(input_value::text,'sha256'),'hex');
  INSERT INTO public.lms_workflow_commands(id,org_id,actor_user_id,request_id,action,target_id,input_hash)
  VALUES(p_command_id,p_org_id,p_actor_user_id,p_request_id,'review_submission',p_submission_id,input_hash_value)
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO command_record FROM public.lms_workflow_commands WHERE id=p_command_id FOR UPDATE;
  IF command_record.org_id IS DISTINCT FROM p_org_id OR command_record.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_record.action<>'review_submission' OR command_record.target_id IS DISTINCT FROM p_submission_id
     OR command_record.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'LMS workflow command id was reused with different input.' USING ERRCODE='23505'; END IF;
  IF command_record.status='completed' THEN RETURN command_record.result; END IF;
  SELECT * INTO submission_record FROM public.lms_task_submissions
  WHERE org_id=p_org_id AND id=p_submission_id FOR UPDATE;
  IF submission_record.id IS NULL THEN RAISE EXCEPTION 'LMS submission was not found.' USING ERRCODE='P0002'; END IF;
  IF submission_record.status NOT IN('submitted','late','needs_revision') THEN
    RAISE EXCEPTION 'Submission is not awaiting review.' USING ERRCODE='23514'; END IF;
  SELECT * INTO task_record FROM public.lms_tasks
  WHERE org_id=p_org_id AND id=submission_record.task_id AND course_id=submission_record.course_id;
  IF task_record.id IS NULL THEN RAISE EXCEPTION 'Submission task is inconsistent.' USING ERRCODE='23503'; END IF;
  IF p_score>task_record.max_score THEN RAISE EXCEPTION 'Review score exceeds task maximum.' USING ERRCODE='23514'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id=p_org_id AND user_id=p_actor_user_id;
  SELECT id INTO reviewer_employee_id_value FROM public.employees
  WHERE org_id=p_org_id AND user_id=p_actor_user_id AND lifecycle_status IN('onboarding','active');
  actor_allowed:=public.lms_actor_can_manage_course(p_org_id,p_actor_user_id,submission_record.course_id,'can_review_tasks');
  IF NOT actor_allowed AND actor_role_value='training_manager' AND reviewer_employee_id_value IS NOT NULL THEN
    actor_allowed:=EXISTS(SELECT 1 FROM public.employees target
      LEFT JOIN public.departments department ON department.org_id=p_org_id AND department.id=target.department_id
      LEFT JOIN public.locations location ON location.org_id=p_org_id AND location.id=target.location_id
      WHERE target.org_id=p_org_id AND target.id=submission_record.employee_id
        AND (target.manager_id=reviewer_employee_id_value OR department.manager_employee_id=reviewer_employee_id_value
          OR location.manager_employee_id=reviewer_employee_id_value));
  END IF;
  IF NOT actor_allowed THEN RAISE EXCEPTION 'Task review permission is required.' USING ERRCODE='42501'; END IF;
  IF reviewer_employee_id_value=submission_record.employee_id THEN
    RAISE EXCEPTION 'Learners cannot review their own submissions.' USING ERRCODE='42501'; END IF;
  IF jsonb_array_length(rubric_items_value)>0 THEN
    IF (SELECT count(*) FROM jsonb_array_elements(rubric_items_value))<>
       (SELECT count(DISTINCT value->>'rubric_item_id') FROM jsonb_array_elements(rubric_items_value)) THEN
      RAISE EXCEPTION 'Rubric review items must be unique.' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(rubric_items_value) item WHERE NOT EXISTS(
      SELECT 1 FROM public.lms_project_rubric_items rubric_item
      WHERE rubric_item.org_id=p_org_id AND rubric_item.id=(item->>'rubric_item_id')::uuid
        AND rubric_item.task_id=submission_record.task_id AND rubric_item.course_id=submission_record.course_id AND rubric_item.is_active
        AND COALESCE((item->>'score')::numeric,0) BETWEEN 0 AND rubric_item.points
    )) THEN RAISE EXCEPTION 'Rubric score is outside the task rubric.' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(sum(COALESCE((value->>'score')::numeric,0)),0) INTO rubric_points
    FROM jsonb_array_elements(rubric_items_value);
    IF rubric_points<>p_score THEN RAISE EXCEPTION 'Rubric scores must equal the review score.' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO public.lms_task_reviews(org_id,submission_id,task_id,course_id,reviewer_employee_id,score,passed,feedback,review_status)
  VALUES(p_org_id,p_submission_id,submission_record.task_id,submission_record.course_id,reviewer_employee_id_value,p_score,
    p_review_status='accepted',NULLIF(btrim(COALESCE(p_feedback,'')),''),p_review_status) RETURNING * INTO review_record;
  FOR item_value IN SELECT value FROM jsonb_array_elements(rubric_items_value) LOOP
    INSERT INTO public.lms_project_review_items(org_id,review_id,submission_id,rubric_item_id,task_id,course_id,score,passed,feedback)
    VALUES(p_org_id,review_record.id,p_submission_id,(item_value->>'rubric_item_id')::uuid,submission_record.task_id,
      submission_record.course_id,COALESCE((item_value->>'score')::numeric,0),COALESCE((item_value->>'passed')::boolean,false),
      NULLIF(btrim(COALESCE(item_value->>'feedback','')),''));
  END LOOP;
  UPDATE public.lms_task_submissions SET status=p_review_status,updated_at=now()
  WHERE id=p_submission_id RETURNING * INTO submission_record;
  completion_value:=public.refresh_lms_enrollment(p_org_id,p_actor_user_id,p_request_id,submission_record.enrollment_id);
  SELECT user_id INTO learner_user_id FROM public.employees WHERE org_id=p_org_id AND id=submission_record.employee_id;
  event_payload:=jsonb_build_object('event_type','lms.submission_reviewed','submission_id',p_submission_id,
    'review_id',review_record.id,'course_id',submission_record.course_id,'enrollment_id',submission_record.enrollment_id,
    'employee_id',submission_record.employee_id,'learner_user_id',learner_user_id,'review_status',p_review_status,
    'feedback',NULLIF(btrim(COALESCE(p_feedback,'')),''));
  INSERT INTO public.business_events(org_id,source_type,business_key,payload,payload_hash,status,request_id,actor_user_id,occurred_at,processed_at)
  VALUES(p_org_id,'lms','submission-reviewed:'||p_command_id::text,event_payload,encode(digest(event_payload::text,'sha256'),'hex'),
    'completed',p_request_id,p_actor_user_id,now(),now()) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox(org_id,business_event_id,topic,payload,payload_hash)
  VALUES(p_org_id,event_id_value,'lms.submission_reviewed',event_payload,encode(digest(event_payload::text,'sha256'),'hex'));
  INSERT INTO public.operational_audit_logs(org_id,request_id,actor_user_id,actor_role,action,target_type,target_id,outcome,status_code,metadata)
  VALUES(p_org_id,p_request_id,p_actor_user_id,COALESCE(actor_role_value,'instructor'),'lms.submission_reviewed','lms_task_submissions',
    p_submission_id::text,'success',200,event_payload);
  result_value:=jsonb_build_object('review',to_jsonb(review_record),'submission',to_jsonb(submission_record),'completion',completion_value);
  UPDATE public.lms_workflow_commands SET status='completed',result=result_value,completed_at=now() WHERE id=p_command_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.lms_actor_can_manage_course(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assign_lms_learning_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,date,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_lms_project_rubric_atomic(uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_lms_submission_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lms_learning_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,date,uuid[],uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_lms_project_rubric_atomic(uuid,uuid,uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_lms_submission_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,text,jsonb) TO service_role;
