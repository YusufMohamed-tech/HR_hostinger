CREATE TABLE IF NOT EXISTS public.job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  requirements text,
  form_schema jsonb DEFAULT '[]'::jsonb,
  employment_type text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  company_name text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_templates_org ON public.job_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_job_templates_created_by ON public.job_templates(created_by);

ALTER TABLE public.job_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_templates_select ON public.job_templates;
CREATE POLICY job_templates_select ON public.job_templates
FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin() OR created_by = auth.uid()));

DROP POLICY IF EXISTS job_templates_insert ON public.job_templates;
CREATE POLICY job_templates_insert ON public.job_templates
FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND public.is_admin());
