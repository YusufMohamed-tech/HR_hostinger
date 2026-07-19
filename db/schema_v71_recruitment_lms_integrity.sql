-- Guard recruitment state changes and make learner progress commands atomic.

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS offer_status text,
  ADD COLUMN IF NOT EXISTS offered_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_responded_at timestamptz;

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_version_check,
  ADD CONSTRAINT job_applications_version_check CHECK (version > 0),
  DROP CONSTRAINT IF EXISTS job_applications_offer_status_check,
  ADD CONSTRAINT job_applications_offer_status_check
    CHECK (offer_status IS NULL OR offer_status IN ('pending', 'accepted', 'declined', 'withdrawn'));

CREATE TABLE IF NOT EXISTS public.recruitment_workflow_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  command_type text NOT NULL CHECK (command_type IN ('transition', 'offer_response', 'schedule_interview')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, id)
);
CREATE INDEX IF NOT EXISTS recruitment_commands_application_idx
  ON public.recruitment_workflow_commands(org_id, application_id, created_at DESC);
ALTER TABLE public.recruitment_workflow_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY recruitment_workflow_commands_service_only
  ON public.recruitment_workflow_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_recruitment_application_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.offer_status IS DISTINCT FROM OLD.offer_status)
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Recruitment workflow fields may only be changed through trusted commands.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status IN ('new', 'submitted') AND NEW.status IN ('submitted', 'screening', 'shortlisted', 'interview', 'technical_test', 'rejected')) OR
      (OLD.status = 'screening' AND NEW.status IN ('shortlisted', 'interview', 'technical_test', 'rejected')) OR
      (OLD.status = 'shortlisted' AND NEW.status IN ('interview', 'technical_test', 'offer', 'rejected')) OR
      (OLD.status = 'interview' AND NEW.status IN ('shortlisted', 'technical_test', 'offer', 'rejected')) OR
      (OLD.status = 'technical_test' AND NEW.status IN ('interview', 'offer', 'rejected')) OR
      (OLD.status = 'offer' AND NEW.status IN ('hired', 'rejected'))
    ) THEN
      RAISE EXCEPTION 'Illegal recruitment transition from % to %.', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'hired' AND OLD.offer_status IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'The candidate must accept the offer before hiring.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_recruitment_application_state ON public.job_applications;
CREATE TRIGGER trg_guard_recruitment_application_state
  BEFORE UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_recruitment_application_state();

CREATE OR REPLACE FUNCTION public.publish_recruitment_hire_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_payload jsonb; event_id uuid;
BEGIN
  IF NEW.status = 'hired' AND OLD.status IS DISTINCT FROM 'hired' THEN
    event_payload := jsonb_build_object('event_type', 'recruitment.candidate_hired',
      'application_id', NEW.id, 'job_posting_id', NEW.job_posting_id,
      'candidate_user_id', COALESCE(NEW.candidate_id, NEW.candidate_user_id));
    INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
      actor_user_id, occurred_at, processed_at)
    VALUES (NEW.org_id, 'recruitment', 'candidate-hired:' || NEW.id::text, event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', NULL, now(), now())
    ON CONFLICT (org_id, source_type, business_key) DO NOTHING RETURNING id INTO event_id;
    IF event_id IS NOT NULL THEN
      INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
      VALUES (NEW.org_id, event_id, 'recruitment.candidate_hired', event_payload,
        encode(digest(event_payload::text, 'sha256'), 'hex')) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_publish_recruitment_hire_event ON public.job_applications;
CREATE TRIGGER trg_publish_recruitment_hire_event
  AFTER UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.publish_recruitment_hire_event();

CREATE OR REPLACE FUNCTION public.transition_recruitment_application(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_application_id uuid, p_expected_version integer, p_target_stage text, p_note text DEFAULT NULL
)
RETURNS SETOF public.job_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  application_row public.job_applications%ROWTYPE;
  posting_owner uuid;
  actor_role_value text;
  input_value jsonb;
  input_hash_value text;
  command_row public.recruitment_workflow_commands%ROWTYPE;
  event_payload jsonb;
  event_id uuid;
  previous_stage_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'super_admin', 'hr_admin', 'hr_recruitment');
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Recruitment management access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_target_stage NOT IN ('screening', 'shortlisted', 'interview', 'technical_test', 'offer', 'rejected') THEN
    RAISE EXCEPTION 'The requested recruitment stage is invalid.' USING ERRCODE = '22023';
  END IF;

  input_value := jsonb_build_object('application_id', p_application_id, 'expected_version', p_expected_version,
    'target_stage', p_target_stage, 'note', NULLIF(btrim(p_note), ''));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.recruitment_workflow_commands (
    id, org_id, application_id, command_type, actor_user_id, request_id, input_hash
  ) VALUES (p_command_id, p_org_id, p_application_id, 'transition', p_actor_user_id, p_request_id, input_hash_value)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.recruitment_workflow_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.application_id IS DISTINCT FROM p_application_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Recruitment command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    SELECT * INTO application_row FROM public.job_applications
    WHERE org_id = p_org_id AND id = p_application_id;
    RETURN NEXT application_row;
    RETURN;
  END IF;

  SELECT * INTO application_row FROM public.job_applications application
  WHERE application.org_id = p_org_id AND application.id = p_application_id
  FOR UPDATE;
  IF application_row.id IS NULL THEN
    RAISE EXCEPTION 'Recruitment application was not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT posting.created_by INTO posting_owner FROM public.job_postings posting
  WHERE posting.org_id = p_org_id AND posting.id = application_row.job_posting_id;
  IF actor_role_value = 'hr_recruitment' AND posting_owner IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'The application is outside the recruiter scope.' USING ERRCODE = '42501';
  END IF;
  IF application_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Recruitment application version conflict.' USING ERRCODE = '40001';
  END IF;
  previous_stage_value := application_row.status;

  UPDATE public.job_applications SET
    status = p_target_stage,
    version = version + 1,
    offer_status = CASE WHEN p_target_stage = 'offer' THEN 'pending'
      WHEN status = 'offer' AND p_target_stage = 'rejected' THEN 'withdrawn' ELSE offer_status END,
    offered_at = CASE WHEN p_target_stage = 'offer' THEN now() ELSE offered_at END,
    offer_responded_at = CASE WHEN p_target_stage = 'offer' THEN NULL ELSE offer_responded_at END,
    stage_history = COALESCE(stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'stage', p_target_stage, 'changed_by', p_actor_user_id, 'changed_at', now(),
      'note', NULLIF(left(btrim(p_note), 2000), '')
    )),
    updated_at = now()
  WHERE org_id = p_org_id AND id = p_application_id
  RETURNING * INTO application_row;

  event_payload := jsonb_build_object('event_type', 'recruitment.application_transitioned',
    'application_id', application_row.id, 'job_posting_id', application_row.job_posting_id,
    'candidate_user_id', COALESCE(application_row.candidate_id, application_row.candidate_user_id),
    'previous_stage', previous_stage_value, 'stage', application_row.status,
    'offer_status', application_row.offer_status, 'version', application_row.version);
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (p_org_id, 'recruitment', 'transition:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'recruitment.application_transitioned', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'recruitment.application_transitioned',
    'job_applications', application_row.id::text, 'success', 200,
    jsonb_build_object('stage', application_row.status, 'version', application_row.version));
  UPDATE public.recruitment_workflow_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('application_id', application_row.id, 'stage', application_row.status,
      'version', application_row.version)
  WHERE id = p_command_id;
  RETURN NEXT application_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_recruitment_offer(
  p_candidate_user_id uuid, p_request_id uuid, p_command_id uuid, p_application_id uuid, p_response text
)
RETURNS SETOF public.job_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  application_row public.job_applications%ROWTYPE;
  candidate_email text;
  input_value jsonb;
  input_hash_value text;
  command_row public.recruitment_workflow_commands%ROWTYPE;
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Offer response must be accepted or declined.' USING ERRCODE = '22023';
  END IF;
  SELECT lower(email) INTO candidate_email FROM auth.users WHERE id = p_candidate_user_id;
  IF candidate_email IS NULL THEN RAISE EXCEPTION 'Candidate identity was not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO application_row FROM public.job_applications
  WHERE id = p_application_id AND (candidate_id = p_candidate_user_id OR lower(email) = candidate_email)
  FOR UPDATE;
  IF application_row.id IS NULL THEN RAISE EXCEPTION 'Offer was not found for this candidate.' USING ERRCODE = 'P0002'; END IF;
  input_value := jsonb_build_object('application_id', p_application_id, 'response', p_response);
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.recruitment_workflow_commands (
    id, org_id, application_id, command_type, actor_user_id, request_id, input_hash
  ) VALUES (p_command_id, application_row.org_id, application_row.id, 'offer_response',
    p_candidate_user_id, p_request_id, input_hash_value) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.recruitment_workflow_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.application_id IS DISTINCT FROM p_application_id OR command_row.actor_user_id IS DISTINCT FROM p_candidate_user_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Offer-response command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN NEXT application_row; RETURN; END IF;
  IF application_row.status <> 'offer' OR application_row.offer_status <> 'pending' THEN
    RAISE EXCEPTION 'This offer is no longer awaiting a response.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.job_applications SET candidate_id = COALESCE(candidate_id, p_candidate_user_id),
    offer_status = p_response, offer_responded_at = now(), version = version + 1,
    stage_history = COALESCE(stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'stage', 'offer_' || p_response, 'changed_by', p_candidate_user_id, 'changed_at', now(), 'note', NULL
    )), updated_at = now()
  WHERE id = application_row.id RETURNING * INTO application_row;
  event_payload := jsonb_build_object('event_type', 'recruitment.offer_' || p_response,
    'application_id', application_row.id, 'job_posting_id', application_row.job_posting_id,
    'candidate_user_id', p_candidate_user_id, 'offer_status', p_response, 'version', application_row.version);
  INSERT INTO public.business_events (
    org_id, source_type, business_key, payload, payload_hash, status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (application_row.org_id, 'recruitment', 'offer-response:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_candidate_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (application_row.org_id, event_id, 'recruitment.offer_' || p_response, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (application_row.org_id, p_request_id, p_candidate_user_id, 'candidate', 'recruitment.offer_' || p_response,
    'job_applications', application_row.id::text, 'success', 200, jsonb_build_object('version', application_row.version));
  UPDATE public.recruitment_workflow_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('application_id', application_row.id, 'offer_status', p_response, 'version', application_row.version)
  WHERE id = p_command_id;
  RETURN NEXT application_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_recruitment_interview(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_application_id uuid, p_expected_version integer, p_payload jsonb
)
RETURNS SETOF public.interviews
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  application_row public.job_applications%ROWTYPE;
  interview_row public.interviews%ROWTYPE;
  actor_role_value text;
  posting_owner uuid;
  input_hash_value text;
  command_row public.recruitment_workflow_commands%ROWTYPE;
  scheduled_value timestamptz;
  interview_type_value text;
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT member.role::text INTO actor_role_value FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'super_admin', 'hr_admin', 'hr_recruitment');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Recruitment management access is required.' USING ERRCODE = '42501'; END IF;
  scheduled_value := NULLIF(p_payload->>'scheduled_at', '')::timestamptz;
  interview_type_value := COALESCE(NULLIF(p_payload->>'type', ''), 'in_person');
  IF scheduled_value IS NULL OR scheduled_value <= now() OR interview_type_value NOT IN ('in_person', 'video', 'phone') THEN
    RAISE EXCEPTION 'Interview schedule or type is invalid.' USING ERRCODE = '22023';
  END IF;
  input_hash_value := encode(digest(jsonb_build_object('application_id', p_application_id,
    'expected_version', p_expected_version, 'payload', p_payload)::text, 'sha256'), 'hex');
  INSERT INTO public.recruitment_workflow_commands (id, org_id, application_id, command_type,
    actor_user_id, request_id, input_hash)
  VALUES (p_command_id, p_org_id, p_application_id, 'schedule_interview', p_actor_user_id, p_request_id, input_hash_value)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.recruitment_workflow_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.application_id IS DISTINCT FROM p_application_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Interview command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    SELECT * INTO interview_row FROM public.interviews WHERE org_id = p_org_id AND id = (command_row.result->>'interview_id')::uuid;
    RETURN NEXT interview_row; RETURN;
  END IF;
  SELECT * INTO application_row FROM public.job_applications WHERE org_id = p_org_id AND id = p_application_id FOR UPDATE;
  IF application_row.id IS NULL THEN RAISE EXCEPTION 'Recruitment application was not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT created_by INTO posting_owner FROM public.job_postings WHERE org_id = p_org_id AND id = application_row.job_posting_id;
  IF actor_role_value = 'hr_recruitment' AND posting_owner IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'The application is outside the recruiter scope.' USING ERRCODE = '42501';
  END IF;
  IF application_row.version <> p_expected_version THEN RAISE EXCEPTION 'Recruitment application version conflict.' USING ERRCODE = '40001'; END IF;
  IF application_row.status IN ('offer', 'hired', 'rejected') THEN
    RAISE EXCEPTION 'An interview cannot be scheduled from the current application stage.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.interviews (org_id, job_application_id, interview_date, scheduled_at, type,
    location, notes, created_by, result)
  VALUES (p_org_id, application_row.id, scheduled_value, scheduled_value, interview_type_value,
    NULLIF(left(btrim(p_payload->>'location'), 1000), ''), NULLIF(left(btrim(p_payload->>'notes'), 2000), ''),
    p_actor_user_id, 'pending') RETURNING * INTO interview_row;
  UPDATE public.job_applications SET status = 'interview', version = version + 1,
    stage_history = COALESCE(stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'stage', 'interview', 'changed_by', p_actor_user_id, 'changed_at', now(), 'note', 'Interview scheduled'
    )), updated_at = now()
  WHERE id = application_row.id RETURNING * INTO application_row;
  event_payload := jsonb_build_object('event_type', 'recruitment.interview_scheduled',
    'application_id', application_row.id, 'job_posting_id', application_row.job_posting_id,
    'candidate_user_id', COALESCE(application_row.candidate_id, application_row.candidate_user_id),
    'interview_id', interview_row.id, 'scheduled_at', interview_row.scheduled_at,
    'type', interview_row.type, 'location', interview_row.location);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'recruitment', 'interview:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'recruitment.interview_scheduled', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'recruitment.interview_scheduled',
    'interviews', interview_row.id::text, 'success', 201,
    jsonb_build_object('application_id', application_row.id, 'scheduled_at', interview_row.scheduled_at));
  UPDATE public.recruitment_workflow_commands SET status = 'completed', completed_at = now(),
    result = jsonb_build_object('interview_id', interview_row.id, 'application_version', application_row.version)
  WHERE id = p_command_id;
  RETURN NEXT interview_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_lms_enrollment(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_enrollment_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  enrollment_row public.lms_enrollments%ROWTYPE;
  course_row public.lms_courses%ROWTYPE;
  actor_employee_id uuid;
  actor_role_value text;
  required_count integer;
  completed_count integer;
  progress_value numeric(5,2);
  was_completed boolean;
  certificate_row public.lms_certificates%ROWTYPE;
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT id INTO actor_employee_id FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT * INTO enrollment_row FROM public.lms_enrollments WHERE org_id = p_org_id AND id = p_enrollment_id FOR UPDATE;
  IF enrollment_row.id IS NULL THEN RAISE EXCEPTION 'LMS enrollment was not found.' USING ERRCODE = 'P0002'; END IF;
  IF actor_employee_id IS DISTINCT FROM enrollment_row.employee_id
     AND actor_role_value NOT IN ('admin', 'super_admin', 'hr_admin', 'training_manager')
     AND NOT EXISTS (SELECT 1 FROM public.lms_course_instructors instructor
       WHERE instructor.org_id = p_org_id AND instructor.course_id = enrollment_row.course_id
         AND instructor.employee_id = actor_employee_id) THEN
    RAISE EXCEPTION 'The LMS enrollment is outside the actor scope.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO course_row FROM public.lms_courses WHERE org_id = p_org_id AND id = enrollment_row.course_id;
  was_completed := enrollment_row.status = 'completed';
  SELECT count(*)::integer INTO required_count FROM public.lms_lessons lesson
    WHERE lesson.org_id = p_org_id AND lesson.course_id = course_row.id AND lesson.is_active AND lesson.is_required;
  SELECT count(*)::integer INTO completed_count FROM public.lms_lesson_progress progress
    JOIN public.lms_lessons lesson ON lesson.id = progress.lesson_id AND lesson.org_id = p_org_id
    WHERE progress.org_id = p_org_id AND progress.enrollment_id = enrollment_row.id
      AND progress.status = 'completed' AND lesson.course_id = course_row.id AND lesson.is_active AND lesson.is_required;
  IF course_row.requires_quiz_pass THEN
    required_count := required_count + (SELECT count(*) FROM public.lms_quizzes quiz
      WHERE quiz.org_id = p_org_id AND quiz.course_id = course_row.id AND quiz.is_active AND quiz.is_required);
    completed_count := completed_count + (SELECT count(DISTINCT attempt.quiz_id) FROM public.lms_quiz_attempts attempt
      JOIN public.lms_quizzes quiz ON quiz.id = attempt.quiz_id AND quiz.org_id = p_org_id
      WHERE attempt.org_id = p_org_id AND attempt.enrollment_id = enrollment_row.id AND attempt.passed
        AND quiz.course_id = course_row.id AND quiz.is_active AND quiz.is_required);
  END IF;
  IF course_row.requires_task_pass THEN
    required_count := required_count + (SELECT count(*) FROM public.lms_tasks task
      WHERE task.org_id = p_org_id AND task.course_id = course_row.id AND task.status = 'published' AND task.is_required);
    completed_count := completed_count + (SELECT count(DISTINCT submission.task_id) FROM public.lms_task_submissions submission
      JOIN public.lms_tasks task ON task.id = submission.task_id AND task.org_id = p_org_id
      WHERE submission.org_id = p_org_id AND submission.enrollment_id = enrollment_row.id AND submission.status = 'accepted'
        AND task.course_id = course_row.id AND task.status = 'published' AND task.is_required);
  END IF;
  progress_value := CASE WHEN required_count = 0 THEN 100 ELSE round(LEAST(completed_count, required_count)::numeric / required_count * 100, 2) END;
  UPDATE public.lms_enrollments SET progress_percent = progress_value,
    status = CASE WHEN progress_value = 100 THEN 'completed' WHEN progress_value > 0 THEN 'in_progress' ELSE 'assigned' END,
    started_at = CASE WHEN progress_value > 0 THEN COALESCE(started_at, now()) ELSE started_at END,
    completed_at = CASE WHEN progress_value = 100 THEN COALESCE(completed_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = enrollment_row.id RETURNING * INTO enrollment_row;
  IF enrollment_row.status = 'completed' THEN
    INSERT INTO public.lms_certificates (org_id, enrollment_id, course_id, employee_id, certificate_number, issued_by)
    VALUES (p_org_id, enrollment_row.id, enrollment_row.course_id, enrollment_row.employee_id,
      'LMS-' || extract(year FROM now())::integer || '-' || upper(left(enrollment_row.id::text, 8)), p_actor_user_id)
    ON CONFLICT (org_id, enrollment_id) DO UPDATE SET enrollment_id = EXCLUDED.enrollment_id
    RETURNING * INTO certificate_row;
    IF NOT was_completed THEN
      event_payload := jsonb_build_object('event_type', 'lms.enrollment_completed', 'enrollment_id', enrollment_row.id,
        'course_id', enrollment_row.course_id, 'employee_id', enrollment_row.employee_id,
        'certificate_id', certificate_row.id);
      INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
        request_id, actor_user_id, occurred_at, processed_at)
      VALUES (p_org_id, 'lms', 'enrollment-completed:' || enrollment_row.id::text, event_payload,
        encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
      ON CONFLICT (org_id, source_type, business_key) DO NOTHING RETURNING id INTO event_id;
      IF event_id IS NOT NULL THEN
        INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
        VALUES (p_org_id, event_id, 'lms.enrollment_completed', event_payload,
          encode(digest(event_payload::text, 'sha256'), 'hex')) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('enrollment', to_jsonb(enrollment_row), 'certificate',
    CASE WHEN certificate_row.id IS NULL THEN NULL ELSE to_jsonb(certificate_row) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_lms_lesson(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_enrollment_id uuid, p_lesson_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE enrollment_row public.lms_enrollments%ROWTYPE; actor_employee_id uuid; progress_row public.lms_lesson_progress%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO actor_employee_id FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT * INTO enrollment_row FROM public.lms_enrollments WHERE org_id = p_org_id AND id = p_enrollment_id FOR UPDATE;
  IF enrollment_row.id IS NULL OR actor_employee_id IS DISTINCT FROM enrollment_row.employee_id THEN
    RAISE EXCEPTION 'LMS enrollment was not found for learner.' USING ERRCODE = '42501';
  END IF;
  IF enrollment_row.status = 'cancelled' OR NOT EXISTS (SELECT 1 FROM public.lms_lessons lesson
    WHERE lesson.org_id = p_org_id AND lesson.id = p_lesson_id AND lesson.course_id = enrollment_row.course_id AND lesson.is_active) THEN
    RAISE EXCEPTION 'Lesson does not belong to the active enrollment course.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.lms_lesson_progress (org_id, enrollment_id, lesson_id, employee_id, status, completed_at)
  VALUES (p_org_id, enrollment_row.id, p_lesson_id, enrollment_row.employee_id, 'completed', now())
  ON CONFLICT (org_id, enrollment_id, lesson_id) DO UPDATE SET status = 'completed',
    completed_at = COALESCE(lms_lesson_progress.completed_at, now()), updated_at = now()
  RETURNING * INTO progress_row;
  RETURN jsonb_build_object('progress', to_jsonb(progress_row), 'completion',
    public.refresh_lms_enrollment(p_org_id, p_actor_user_id, p_request_id, p_enrollment_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_lms_quiz_attempt(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_enrollment_id uuid, p_quiz_id uuid, p_answers jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  enrollment_row public.lms_enrollments%ROWTYPE;
  quiz_row public.lms_quizzes%ROWTYPE;
  actor_employee_id uuid;
  attempt_number_value integer;
  total_points numeric;
  earned_points numeric;
  score_value numeric(5,2);
  attempt_row public.lms_quiz_attempts%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO actor_employee_id FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT * INTO enrollment_row FROM public.lms_enrollments WHERE org_id = p_org_id AND id = p_enrollment_id FOR UPDATE;
  IF enrollment_row.id IS NULL OR actor_employee_id IS DISTINCT FROM enrollment_row.employee_id THEN
    RAISE EXCEPTION 'LMS enrollment was not found for learner.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO quiz_row FROM public.lms_quizzes WHERE org_id = p_org_id AND id = p_quiz_id
    AND course_id = enrollment_row.course_id AND is_active FOR UPDATE;
  IF quiz_row.id IS NULL THEN RAISE EXCEPTION 'Quiz does not belong to the active enrollment course.' USING ERRCODE = '23514'; END IF;
  SELECT count(*) + 1 INTO attempt_number_value FROM public.lms_quiz_attempts
    WHERE org_id = p_org_id AND enrollment_id = p_enrollment_id AND quiz_id = p_quiz_id;
  IF attempt_number_value > quiz_row.max_attempts THEN
    RAISE EXCEPTION 'Maximum quiz attempts reached.' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(sum(question.points), 0), COALESCE(sum(CASE
    WHEN question.question_type = 'multiple_choice'
      AND COALESCE(p_answers->question.id::text, 'null'::jsonb) @> question.correct_answer_json
      AND question.correct_answer_json @> COALESCE(p_answers->question.id::text, 'null'::jsonb) THEN question.points
    WHEN question.question_type <> 'multiple_choice'
      AND lower(btrim(COALESCE(p_answers->question.id::text #>> '{}', ''))) =
          lower(btrim(COALESCE(question.correct_answer_json #>> '{}', ''))) THEN question.points
    ELSE 0 END), 0)
  INTO total_points, earned_points
  FROM public.lms_quiz_questions question WHERE question.org_id = p_org_id AND question.quiz_id = p_quiz_id;
  score_value := CASE WHEN total_points > 0 THEN round(earned_points / total_points * 100, 2) ELSE 0 END;
  INSERT INTO public.lms_quiz_attempts (org_id, enrollment_id, quiz_id, employee_id, attempt_number,
    answers_json, score, passed, submitted_at)
  VALUES (p_org_id, enrollment_row.id, quiz_row.id, enrollment_row.employee_id, attempt_number_value,
    COALESCE(p_answers, '{}'::jsonb), score_value, score_value >= quiz_row.passing_score, now())
  RETURNING * INTO attempt_row;
  RETURN jsonb_build_object('attempt', to_jsonb(attempt_row), 'completion',
    public.refresh_lms_enrollment(p_org_id, p_actor_user_id, p_request_id, p_enrollment_id));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_recruitment_application(uuid, uuid, uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_to_recruitment_offer(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_recruitment_interview(uuid, uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_lms_enrollment(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_lms_lesson(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_lms_quiz_attempt(uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_recruitment_application(uuid, uuid, uuid, uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_recruitment_offer(uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_recruitment_interview(uuid, uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_lms_enrollment(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_lms_lesson(uuid, uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_lms_quiz_attempt(uuid, uuid, uuid, uuid, uuid, jsonb) TO service_role;
