-- Make published application forms authoritative and register every candidate upload for retention.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recruitment', 'recruitment', false, 10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]::text[])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.managed_files DROP CONSTRAINT IF EXISTS managed_files_owner_type_check;
ALTER TABLE public.managed_files ADD CONSTRAINT managed_files_owner_type_check CHECK (
  owner_type IN (
    'personnel_file', 'employee_contract', 'employee_document',
    'candidate_application_cv', 'candidate_application_attachment'
  )
);

CREATE TABLE IF NOT EXISTS public.recruitment_application_files (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  question_id text NOT NULL CHECK (question_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  managed_file_id uuid NOT NULL UNIQUE REFERENCES public.managed_files(id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  detected_mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_application_files_org_application
  ON public.recruitment_application_files(org_id, application_id);
ALTER TABLE public.recruitment_application_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recruitment_application_files_service_only ON public.recruitment_application_files;
CREATE POLICY recruitment_application_files_service_only ON public.recruitment_application_files FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.assert_valid_recruitment_form_schema(p_schema jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  question jsonb;
  question_id text;
  question_type text;
  seen_ids text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(COALESCE(p_schema, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_schema, '[]'::jsonb)) > 50 THEN
    RAISE EXCEPTION 'Recruitment form schema must be an array with at most 50 questions.' USING ERRCODE = '22023';
  END IF;

  FOR question IN SELECT value FROM jsonb_array_elements(COALESCE(p_schema, '[]'::jsonb)) LOOP
    question_id := btrim(COALESCE(question->>'id', ''));
    question_type := lower(btrim(COALESCE(question->>'type', '')));
    IF jsonb_typeof(question) <> 'object'
       OR question_id !~ '^[A-Za-z0-9_-]{1,80}$'
       OR question_id = ANY(seen_ids)
       OR question_type NOT IN ('text', 'textarea', 'select', 'file', 'date', 'yesno', 'number')
       OR length(btrim(COALESCE(question->>'label', ''))) NOT BETWEEN 1 AND 500
       OR COALESCE(question->>'required', 'false') NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Recruitment form contains an invalid or duplicate question.' USING ERRCODE = '22023';
    END IF;
    IF question_type = 'select' AND (
      jsonb_typeof(question->'options') <> 'array'
      OR jsonb_array_length(question->'options') = 0
      OR jsonb_array_length(question->'options') > 100
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(question->'options') option
        WHERE jsonb_typeof(option) <> 'string' OR length(btrim(option #>> '{}')) NOT BETWEEN 1 AND 300
      )
      OR (
        SELECT count(*) FROM jsonb_array_elements_text(question->'options') option
      ) <> (
        SELECT count(DISTINCT option) FROM jsonb_array_elements_text(question->'options') option
      )
    ) THEN
      RAISE EXCEPTION 'Select questions require unique non-empty options.' USING ERRCODE = '22023';
    END IF;
    seen_ids := array_append(seen_ids, question_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_recruitment_form_schema()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.assert_valid_recruitment_form_schema(NEW.form_schema);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_job_posting_form_schema ON public.job_postings;
CREATE TRIGGER trg_guard_job_posting_form_schema
  BEFORE INSERT OR UPDATE OF form_schema ON public.job_postings
  FOR EACH ROW EXECUTE FUNCTION public.guard_recruitment_form_schema();
DROP TRIGGER IF EXISTS trg_guard_job_template_form_schema ON public.job_templates;
CREATE TRIGGER trg_guard_job_template_form_schema
  BEFORE INSERT OR UPDATE OF form_schema ON public.job_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_recruitment_form_schema();

CREATE OR REPLACE FUNCTION public.guard_public_application_answers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  form_value jsonb;
  question jsonb;
  answer_value jsonb;
  answer_text text;
  answer_key text;
  question_id text;
  question_type text;
  required_value boolean;
  expected_prefix text;
BEGIN
  SELECT form_schema INTO form_value FROM public.job_postings WHERE id = NEW.job_posting_id;
  IF form_value IS NULL THEN
    RAISE EXCEPTION 'Job posting was not found for application validation.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_valid_recruitment_form_schema(form_value);
  IF jsonb_typeof(COALESCE(NEW.answers, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(NEW.answers, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION 'Application answers must be a bounded object.' USING ERRCODE = '22023';
  END IF;

  FOR answer_key IN SELECT jsonb_object_keys(COALESCE(NEW.answers, '{}'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(form_value) candidate
      WHERE candidate->>'id' = answer_key
    ) THEN
      RAISE EXCEPTION 'Application contains an answer for an unknown question.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR question IN SELECT value FROM jsonb_array_elements(form_value) LOOP
    question_id := question->>'id';
    question_type := question->>'type';
    required_value := COALESCE((question->>'required')::boolean, false);
    answer_value := NEW.answers->question_id;

    IF answer_value IS NULL OR answer_value = 'null'::jsonb THEN
      IF required_value THEN
        RAISE EXCEPTION 'A required application answer is missing.' USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;

    IF question_type = 'file' THEN
      expected_prefix := NEW.org_id::text || '/application-files/' || NEW.job_posting_id::text || '/'
        || NEW.id::text || '/' || question_id || '/';
      IF jsonb_typeof(answer_value) <> 'object'
         OR answer_value->>'scan_status' <> 'clean'
         OR length(COALESCE(answer_value->>'sha256', '')) <> 64
         OR COALESCE((answer_value->>'size_bytes')::bigint, 0) NOT BETWEEN 1 AND 10485760
         OR answer_value->>'mime' NOT IN (
           'application/pdf',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'image/jpeg', 'image/png'
         )
         OR length(btrim(COALESCE(answer_value->>'filename', ''))) NOT BETWEEN 1 AND 160
         OR NULLIF(answer_value->>'scanned_at', '') IS NULL
         OR answer_value->>'path' NOT LIKE expected_prefix || '%' THEN
        RAISE EXCEPTION 'Application file answer is not clean or command scoped.' USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;

    IF jsonb_typeof(answer_value) <> 'string' THEN
      RAISE EXCEPTION 'Application text answers must be strings.' USING ERRCODE = '22023';
    END IF;
    answer_text := btrim(answer_value #>> '{}');
    IF length(answer_text) = 0 THEN
      IF required_value THEN RAISE EXCEPTION 'A required application answer is empty.' USING ERRCODE = '23514'; END IF;
      CONTINUE;
    END IF;
    IF length(answer_text) > 20000 THEN
      RAISE EXCEPTION 'Application answer is too long.' USING ERRCODE = '22023';
    END IF;
    IF question_type = 'select' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(question->'options') option WHERE option = answer_text
    ) THEN
      RAISE EXCEPTION 'Application select answer is not an allowed option.' USING ERRCODE = '23514';
    ELSIF question_type = 'yesno' AND lower(answer_text) NOT IN ('yes', 'no', 'نعم', 'لا') THEN
      RAISE EXCEPTION 'Application yes/no answer is invalid.' USING ERRCODE = '23514';
    ELSIF question_type = 'number' AND answer_text !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN
      RAISE EXCEPTION 'Application number answer is invalid.' USING ERRCODE = '23514';
    ELSIF question_type = 'date' AND (
      answer_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR to_char(to_date(answer_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> answer_text
    ) THEN
      RAISE EXCEPTION 'Application date answer is invalid.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_public_application_answers ON public.job_applications;
CREATE TRIGGER trg_guard_public_application_answers
  BEFORE INSERT ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_public_application_answers();

CREATE OR REPLACE FUNCTION public.register_candidate_managed_files()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  form_value jsonb;
  question jsonb;
  metadata jsonb;
  question_id text;
  file_row_id uuid;
  managed_id uuid;
BEGIN
  IF NEW.cv_url IS NOT NULL THEN
    managed_id := gen_random_uuid();
    INSERT INTO public.managed_files (
      id, org_id, bucket_id, storage_path, owner_type, owner_id, original_name,
      detected_mime, size_bytes, sha256, scan_status, scan_engine, scanned_at,
      retention_until, uploaded_by
    ) VALUES (
      managed_id, NEW.org_id, 'recruitment', NEW.cv_url, 'candidate_application_cv', NEW.id,
      NEW.cv_original_name, NEW.cv_mime, NEW.cv_size_bytes, NEW.cv_sha256, 'clean',
      NEW.cv_scan_engine, NEW.cv_scanned_at, NULL, NEW.candidate_user_id
    );
  END IF;

  SELECT form_schema INTO form_value FROM public.job_postings WHERE id = NEW.job_posting_id;
  FOR question IN SELECT value FROM jsonb_array_elements(COALESCE(form_value, '[]'::jsonb)) LOOP
    IF question->>'type' <> 'file' THEN CONTINUE; END IF;
    question_id := question->>'id';
    metadata := NEW.answers->question_id;
    IF metadata IS NULL OR metadata = 'null'::jsonb THEN CONTINUE; END IF;
    file_row_id := gen_random_uuid();
    managed_id := gen_random_uuid();
    INSERT INTO public.managed_files (
      id, org_id, bucket_id, storage_path, owner_type, owner_id, original_name,
      detected_mime, size_bytes, sha256, scan_status, scan_engine, scanned_at,
      retention_until, uploaded_by
    ) VALUES (
      managed_id, NEW.org_id, 'recruitment', metadata->>'path',
      'candidate_application_attachment', file_row_id, metadata->>'filename', metadata->>'mime',
      (metadata->>'size_bytes')::bigint, metadata->>'sha256', 'clean', metadata->>'scan_engine',
      (metadata->>'scanned_at')::timestamptz, NULL, NEW.candidate_user_id
    );
    INSERT INTO public.recruitment_application_files (
      id, org_id, application_id, question_id, managed_file_id, original_name,
      storage_path, detected_mime, size_bytes, sha256
    ) VALUES (
      file_row_id, NEW.org_id, NEW.id, question_id, managed_id, metadata->>'filename',
      metadata->>'path', metadata->>'mime', (metadata->>'size_bytes')::bigint, metadata->>'sha256'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_register_candidate_managed_files ON public.job_applications;
CREATE TRIGGER trg_register_candidate_managed_files
  AFTER INSERT ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.register_candidate_managed_files();

ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_cv_scan_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_cv_scan_check CHECK (
  (cv_url IS NULL AND cv_scan_status IS NULL AND cv_sha256 IS NULL)
  OR (
    cv_url IS NOT NULL AND cv_scan_status = 'clean' AND length(cv_sha256) = 64
    AND cv_size_bytes > 0 AND cv_size_bytes <= 10485760 AND cv_scanned_at IS NOT NULL
    AND length(btrim(cv_original_name)) BETWEEN 1 AND 160
    AND cv_mime IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    AND length(btrim(cv_scan_engine)) > 0
  )
) NOT VALID;
ALTER TABLE public.job_applications VALIDATE CONSTRAINT job_applications_cv_scan_check;

INSERT INTO public.managed_files (
  id, org_id, bucket_id, storage_path, owner_type, owner_id, original_name,
  detected_mime, size_bytes, sha256, scan_status, scan_engine, scanned_at,
  retention_until, uploaded_by
)
SELECT
  gen_random_uuid(), application.org_id, 'recruitment', application.cv_url,
  'candidate_application_cv', application.id, application.cv_original_name,
  application.cv_mime, application.cv_size_bytes, application.cv_sha256, 'clean',
  application.cv_scan_engine, application.cv_scanned_at, NULL, application.candidate_user_id
FROM public.job_applications application
WHERE application.cv_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.managed_files file
    WHERE file.owner_type = 'candidate_application_cv' AND file.owner_id = application.id
  );

REVOKE ALL ON FUNCTION public.assert_valid_recruitment_form_schema(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_recruitment_form_schema() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_public_application_answers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_candidate_managed_files() FROM PUBLIC, anon, authenticated;
