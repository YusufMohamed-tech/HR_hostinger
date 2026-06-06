CREATE TABLE IF NOT EXISTS public.advance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_amount numeric NOT NULL,
  approved_amount numeric,
  status text DEFAULT 'pending',
  reason text,
  employee_signature_data text,
  employee_signed_at timestamptz,
  hr_notes text,
  reviewed_by uuid REFERENCES public.profiles(user_id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advance_requests_org ON public.advance_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_advance_requests_employee ON public.advance_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_advance_requests_status ON public.advance_requests(status);

ALTER TABLE public.advance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advance_requests_select ON public.advance_requests;
DROP POLICY IF EXISTS advance_requests_insert ON public.advance_requests;
DROP POLICY IF EXISTS advance_requests_update ON public.advance_requests;

CREATE POLICY advance_requests_select ON public.advance_requests
  FOR SELECT USING (
    organization_id = public.current_org_id()
    AND (public.is_admin() OR employee_id = public.current_employee_id())
  );

CREATE POLICY advance_requests_insert ON public.advance_requests
  FOR INSERT WITH CHECK (
    organization_id = public.current_org_id()
    AND employee_id = public.current_employee_id()
  );

CREATE POLICY advance_requests_update ON public.advance_requests
  FOR UPDATE USING (organization_id = public.current_org_id() AND public.is_admin());
