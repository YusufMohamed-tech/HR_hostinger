-- Recruitment portal: custom application forms and candidate-owned tracking.

ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS experience_level text,
  ADD COLUMN IF NOT EXISTS salary_range text,
  ADD COLUMN IF NOT EXISTS form_schema jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'hr_admin';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'hr_recruitment';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'training_manager';

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS candidate_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS application_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'public_link';

CREATE INDEX IF NOT EXISTS idx_job_applications_candidate_user
  ON public.job_applications(candidate_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_applications_unique_candidate_posting
  ON public.job_applications(job_posting_id, candidate_user_id)
  WHERE candidate_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_manage_recruitment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role::text IN ('admin', 'hr_admin', 'hr_recruitment')
      FROM public.org_members
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

DROP POLICY IF EXISTS job_postings_select ON public.job_postings;
DROP POLICY IF EXISTS job_postings_insert ON public.job_postings;
DROP POLICY IF EXISTS job_postings_update ON public.job_postings;
DROP POLICY IF EXISTS job_postings_delete ON public.job_postings;

CREATE POLICY job_postings_select ON public.job_postings
  FOR SELECT USING (
    status IN ('open','published')
    OR org_id = public.current_org_id()
  );

CREATE POLICY job_postings_insert ON public.job_postings
  FOR INSERT WITH CHECK (public.can_manage_recruitment() AND org_id = public.current_org_id());

CREATE POLICY job_postings_update ON public.job_postings
  FOR UPDATE USING (public.can_manage_recruitment() AND org_id = public.current_org_id())
  WITH CHECK (public.can_manage_recruitment() AND org_id = public.current_org_id());

CREATE POLICY job_postings_delete ON public.job_postings
  FOR DELETE USING (public.can_manage_recruitment() AND org_id = public.current_org_id());

DROP POLICY IF EXISTS job_applications_select ON public.job_applications;
DROP POLICY IF EXISTS job_applications_insert ON public.job_applications;
DROP POLICY IF EXISTS job_applications_update ON public.job_applications;
DROP POLICY IF EXISTS job_applications_delete ON public.job_applications;

CREATE POLICY job_applications_select ON public.job_applications
  FOR SELECT USING (
    (public.can_manage_recruitment() AND org_id = public.current_org_id())
    OR candidate_user_id = auth.uid()
  );

CREATE POLICY job_applications_insert ON public.job_applications
  FOR INSERT WITH CHECK (
    candidate_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.job_postings jp
      WHERE jp.id = job_posting_id
        AND jp.org_id = job_applications.org_id
        AND jp.status IN ('open','published')
    )
  );

CREATE POLICY job_applications_update ON public.job_applications
  FOR UPDATE USING (public.can_manage_recruitment() AND org_id = public.current_org_id())
  WITH CHECK (public.can_manage_recruitment() AND org_id = public.current_org_id());

CREATE POLICY job_applications_delete ON public.job_applications
  FOR DELETE USING (public.can_manage_recruitment() AND org_id = public.current_org_id());
