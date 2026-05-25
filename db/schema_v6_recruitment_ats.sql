-- Recruitment ATS enhancements: deadlines and candidate messages.

ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS application_deadline date;

CREATE TABLE IF NOT EXISTS public.recruitment_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  candidate_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_key text,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recruitment_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recruitment_messages_select ON public.recruitment_messages;
DROP POLICY IF EXISTS recruitment_messages_insert ON public.recruitment_messages;
DROP POLICY IF EXISTS recruitment_messages_update ON public.recruitment_messages;
DROP POLICY IF EXISTS recruitment_messages_delete ON public.recruitment_messages;

CREATE POLICY recruitment_messages_select ON public.recruitment_messages
  FOR SELECT USING (
    (public.can_manage_recruitment() AND org_id = public.current_org_id())
    OR candidate_user_id = auth.uid()
  );

CREATE POLICY recruitment_messages_insert ON public.recruitment_messages
  FOR INSERT WITH CHECK (public.can_manage_recruitment() AND org_id = public.current_org_id());

CREATE POLICY recruitment_messages_update ON public.recruitment_messages
  FOR UPDATE USING (public.can_manage_recruitment() AND org_id = public.current_org_id())
  WITH CHECK (public.can_manage_recruitment() AND org_id = public.current_org_id());

CREATE POLICY recruitment_messages_delete ON public.recruitment_messages
  FOR DELETE USING (public.can_manage_recruitment() AND org_id = public.current_org_id());

CREATE INDEX IF NOT EXISTS idx_recruitment_messages_application
  ON public.recruitment_messages(job_application_id);
