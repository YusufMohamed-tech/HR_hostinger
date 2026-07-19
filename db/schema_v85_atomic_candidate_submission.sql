-- Make public candidate submission exact, retry-safe, private-file aware, and auditable.

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS cv_original_name text,
  ADD COLUMN IF NOT EXISTS cv_mime text,
  ADD COLUMN IF NOT EXISTS cv_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS cv_sha256 text,
  ADD COLUMN IF NOT EXISTS cv_scan_status text,
  ADD COLUMN IF NOT EXISTS cv_scan_engine text,
  ADD COLUMN IF NOT EXISTS cv_scanned_at timestamptz;
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_cv_scan_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_cv_scan_check CHECK (
  (cv_url IS NULL AND cv_scan_status IS NULL AND cv_sha256 IS NULL)
  OR (cv_url IS NOT NULL AND cv_scan_status = 'clean' AND length(cv_sha256) = 64
    AND cv_size_bytes > 0 AND cv_scanned_at IS NOT NULL)
) NOT VALID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.job_applications
    GROUP BY job_posting_id, lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate candidate emails per posting must be resolved before applying submission integrity controls.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS job_applications_posting_normalized_email_unique
  ON public.job_applications(job_posting_id, lower(btrim(email)));

CREATE TABLE IF NOT EXISTS public.recruitment_application_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  posting_id uuid NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  candidate_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recruitment_application_commands_org_created
  ON public.recruitment_application_commands(org_id, created_at DESC);
ALTER TABLE public.recruitment_application_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY recruitment_application_commands_service_only ON public.recruitment_application_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_recruitment_application_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Application creation requires a trusted command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.offer_status IS DISTINCT FROM OLD.offer_status)
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Recruitment workflow fields may only be changed through trusted commands.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
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
  BEFORE INSERT OR UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_recruitment_application_state();

CREATE OR REPLACE FUNCTION public.submit_public_application(
  p_posting_id uuid, p_application_id uuid, p_command_id uuid, p_request_id uuid,
  p_candidate_user_id uuid, p_candidate_name text, p_email text, p_phone text,
  p_answers jsonb, p_cv_metadata jsonb DEFAULT NULL
)
RETURNS SETOF public.job_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  posting_row public.job_postings%ROWTYPE;
  application_row public.job_applications%ROWTYPE;
  command_row public.recruitment_application_commands%ROWTYPE;
  normalized_email text := lower(btrim(COALESCE(p_email, '')));
  candidate_email text;
  input_value jsonb;
  input_hash_value text;
  event_payload jsonb;
  event_id uuid;
  recipient_ids jsonb := '[]'::jsonb;
  cv_path text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_candidate_name, ''))) NOT BETWEEN 2 AND 200
     OR length(normalized_email) NOT BETWEEN 3 AND 320 OR position('@' in normalized_email) < 2
     OR length(COALESCE(p_phone, '')) > 40 OR jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(p_answers, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION 'Candidate application details are invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO posting_row FROM public.job_postings WHERE id = p_posting_id FOR SHARE;
  IF posting_row.id IS NULL THEN RAISE EXCEPTION 'Job posting was not found.' USING ERRCODE = 'P0002'; END IF;
  IF lower(COALESCE(posting_row.status, '')) NOT IN ('active', 'published', 'open')
     OR (posting_row.deadline IS NOT NULL
       AND posting_row.deadline < public.organization_business_date(posting_row.org_id, now())) THEN
    RAISE EXCEPTION 'This job posting is not accepting applications.' USING ERRCODE = '23514';
  END IF;
  IF p_candidate_user_id IS NOT NULL THEN
    SELECT lower(btrim(email)) INTO candidate_email FROM auth.users WHERE id = p_candidate_user_id;
    IF candidate_email IS DISTINCT FROM normalized_email THEN
      RAISE EXCEPTION 'Candidate identity does not match the application email.' USING ERRCODE = '42501';
    END IF;
  END IF;

  cv_path := NULLIF(p_cv_metadata->>'path', '');
  IF p_cv_metadata IS NOT NULL AND (
    jsonb_typeof(p_cv_metadata) <> 'object' OR p_cv_metadata->>'scan_status' <> 'clean'
    OR length(COALESCE(p_cv_metadata->>'sha256', '')) <> 64
    OR COALESCE((p_cv_metadata->>'size_bytes')::bigint, 0) <= 0
    OR NULLIF(p_cv_metadata->>'scanned_at', '') IS NULL
    OR cv_path NOT LIKE posting_row.org_id::text || '/cv/' || posting_row.id::text || '/'
      || p_application_id::text || '/' || p_command_id::text || '/%'
  ) THEN
    RAISE EXCEPTION 'Candidate CV metadata is not clean or command scoped.' USING ERRCODE = '23514';
  END IF;

  input_value := jsonb_build_object('posting_id', p_posting_id, 'application_id', p_application_id,
    'candidate_user_id', p_candidate_user_id, 'candidate_name', btrim(p_candidate_name),
    'email', normalized_email, 'phone', NULLIF(btrim(p_phone), ''),
    'answers', COALESCE(p_answers, '{}'::jsonb), 'cv', CASE WHEN p_cv_metadata IS NULL THEN NULL ELSE
      jsonb_build_object('path', cv_path, 'filename', p_cv_metadata->>'filename',
        'mime', p_cv_metadata->>'mime', 'size_bytes', p_cv_metadata->>'size_bytes',
        'sha256', p_cv_metadata->>'sha256', 'scan_status', p_cv_metadata->>'scan_status') END);
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  SELECT * INTO command_row FROM public.recruitment_application_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.id IS NOT NULL THEN
    IF command_row.posting_id IS DISTINCT FROM p_posting_id
       OR command_row.application_id IS DISTINCT FROM p_application_id
       OR command_row.candidate_user_id IS DISTINCT FROM p_candidate_user_id
       OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
      RAISE EXCEPTION 'Application command id was reused with different input.' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO application_row FROM public.job_applications
    WHERE org_id = command_row.org_id AND id = command_row.application_id;
    RETURN NEXT application_row;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_applications WHERE id = p_application_id) THEN
    RAISE EXCEPTION 'Application id already exists without this command.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.job_applications (
    id, org_id, job_posting_id, candidate_id, candidate_user_id, candidate_name,
    email, phone, status, answers, application_answers, cv_url, resume_url,
    cv_original_name, cv_mime, cv_size_bytes, cv_sha256, cv_scan_status,
    cv_scan_engine, cv_scanned_at, stage_history, version
  ) VALUES (
    p_application_id, posting_row.org_id, posting_row.id, p_candidate_user_id,
    p_candidate_user_id, btrim(p_candidate_name), normalized_email, NULLIF(btrim(p_phone), ''),
    'submitted', COALESCE(p_answers, '{}'::jsonb), COALESCE(p_answers, '{}'::jsonb),
    cv_path, cv_path, p_cv_metadata->>'filename', p_cv_metadata->>'mime',
    NULLIF(p_cv_metadata->>'size_bytes', '')::bigint, p_cv_metadata->>'sha256',
    p_cv_metadata->>'scan_status', p_cv_metadata->>'scan_engine',
    NULLIF(p_cv_metadata->>'scanned_at', '')::timestamptz,
    jsonb_build_array(jsonb_build_object('stage', 'submitted', 'changed_by', p_candidate_user_id,
      'changed_at', now(), 'note', 'Submitted through public application command')), 1
  ) RETURNING * INTO application_row;

  SELECT COALESCE(jsonb_agg(DISTINCT recipient.user_id), '[]'::jsonb) INTO recipient_ids
  FROM (
    SELECT posting_row.created_by AS user_id
    UNION ALL
    SELECT member.user_id FROM public.org_members member
    WHERE member.org_id = posting_row.org_id AND member.role::text IN ('admin', 'hr_admin', 'hr_recruitment')
  ) recipient WHERE recipient.user_id IS NOT NULL;
  event_payload := jsonb_build_object('event_type', 'recruitment.application_submitted',
    'application_id', application_row.id, 'job_posting_id', posting_row.id,
    'candidate_user_id', p_candidate_user_id, 'candidate_name', application_row.candidate_name,
    'posting_title', posting_row.title, 'recipient_user_ids', recipient_ids,
    'version', application_row.version);
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    posting_row.org_id, 'recruitment', 'application-submitted:' || p_command_id::text, 1,
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_candidate_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (posting_row.org_id, event_id, 'recruitment.application_submitted', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type, target_id,
    outcome, status_code, metadata
  ) VALUES (
    posting_row.org_id, p_request_id, p_candidate_user_id,
    CASE WHEN p_candidate_user_id IS NULL THEN 'public_candidate' ELSE 'candidate' END,
    'recruitment.application_submitted', 'job_applications', application_row.id::text,
    'success', 201, jsonb_build_object('posting_id', posting_row.id, 'has_cv', cv_path IS NOT NULL)
  );
  INSERT INTO public.recruitment_application_commands (
    id, org_id, application_id, posting_id, candidate_user_id, request_id, input_hash, result
  ) VALUES (
    p_command_id, posting_row.org_id, application_row.id, posting_row.id,
    p_candidate_user_id, p_request_id, input_hash_value,
    jsonb_build_object('application_id', application_row.id, 'version', application_row.version)
  );
  RETURN NEXT application_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_public_application(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_application(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb)
  TO service_role;
