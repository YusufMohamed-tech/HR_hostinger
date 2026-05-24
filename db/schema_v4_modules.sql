-- Production module additions: payroll, personnel, recruitment, balances, assets, and attendance device lock.

CREATE TABLE IF NOT EXISTS public.job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  description text,
  requirements text,
  status text DEFAULT 'open',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_posting_id uuid NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  candidate_name text NOT NULL,
  email text NOT NULL,
  phone text,
  resume_url text,
  cover_letter text,
  status text DEFAULT 'new',
  rating integer CHECK (rating BETWEEN 1 AND 5),
  notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  interviewer_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  interview_date timestamptz NOT NULL,
  notes text,
  result text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  month date NOT NULL,
  base_salary numeric DEFAULT 0,
  total_allowances numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  net_salary numeric DEFAULT 0,
  attendance_days integer DEFAULT 0,
  status text DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, employee_id, month)
);

CREATE TABLE IF NOT EXISTS public.personnel_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other',
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  expiry_date date,
  is_verified boolean DEFAULT false,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  gosi_number text,
  registration_date date,
  contribution_rate numeric DEFAULT 9.75,
  employer_share numeric DEFAULT 0,
  employee_share numeric DEFAULT 0,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  contract_type text DEFAULT 'permanent',
  start_date date NOT NULL,
  end_date date,
  probation_end_date date,
  salary_at_signing numeric,
  file_path text,
  status text DEFAULT 'active',
  signed_at timestamptz,
  terminated_at timestamptz,
  termination_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  asset_name text NOT NULL,
  asset_type text NOT NULL,
  serial_number text,
  assigned_date date NOT NULL DEFAULT CURRENT_DATE,
  returned_date date,
  status text DEFAULT 'assigned',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  balance_type text NOT NULL,
  amount numeric DEFAULT 0,
  status text DEFAULT 'unpaid',
  description text,
  attachment_url text,
  acknowledgment_signature_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS registered_device_id text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS registered_device_name text;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS device_fingerprint text;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS is_registered_device boolean DEFAULT false;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS manager_approval_status text DEFAULT 'pending';
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS hr_approval_status text DEFAULT 'pending';
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS total_steps integer DEFAULT 1;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS current_step integer DEFAULT 1;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'job_postings','job_applications','interviews','payslips','personnel_files',
    'social_insurance','employee_contracts','employee_assets','financial_balances'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'interviews','personnel_files','social_insurance','employee_contracts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_select_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_insert_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_update_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_delete_%I ON public.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY org_select_%I ON public.%I FOR SELECT USING (org_id = public.current_org_id())', tbl, tbl);
    EXECUTE format('CREATE POLICY org_insert_%I ON public.%I FOR INSERT WITH CHECK (public.is_admin())', tbl, tbl);
    EXECUTE format('CREATE POLICY org_update_%I ON public.%I FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin())', tbl, tbl);
    EXECUTE format('CREATE POLICY org_delete_%I ON public.%I FOR DELETE USING (public.is_admin())', tbl, tbl);
  END LOOP;
END$$;

DROP POLICY IF EXISTS job_postings_select ON public.job_postings;
DROP POLICY IF EXISTS job_postings_insert ON public.job_postings;
DROP POLICY IF EXISTS job_postings_update ON public.job_postings;
DROP POLICY IF EXISTS job_postings_delete ON public.job_postings;
CREATE POLICY job_postings_select ON public.job_postings
  FOR SELECT USING (status IN ('open','published') OR org_id = public.current_org_id());
CREATE POLICY job_postings_insert ON public.job_postings FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY job_postings_update ON public.job_postings FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY job_postings_delete ON public.job_postings FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS job_applications_select ON public.job_applications;
DROP POLICY IF EXISTS job_applications_insert ON public.job_applications;
DROP POLICY IF EXISTS job_applications_update ON public.job_applications;
DROP POLICY IF EXISTS job_applications_delete ON public.job_applications;
CREATE POLICY job_applications_select ON public.job_applications
  FOR SELECT USING (public.is_admin() AND org_id = public.current_org_id());
CREATE POLICY job_applications_insert ON public.job_applications
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_postings jp
      WHERE jp.id = job_posting_id
        AND jp.org_id = job_applications.org_id
        AND jp.status IN ('open','published')
    )
  );
CREATE POLICY job_applications_update ON public.job_applications FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY job_applications_delete ON public.job_applications FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS payslips_select ON public.payslips;
DROP POLICY IF EXISTS payslips_insert ON public.payslips;
DROP POLICY IF EXISTS payslips_update ON public.payslips;
DROP POLICY IF EXISTS payslips_delete ON public.payslips;
CREATE POLICY payslips_select ON public.payslips
  FOR SELECT USING (org_id = public.current_org_id() AND (public.is_admin() OR employee_id = public.current_employee_id()));
CREATE POLICY payslips_insert ON public.payslips FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY payslips_update ON public.payslips FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY payslips_delete ON public.payslips FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS employee_assets_select ON public.employee_assets;
DROP POLICY IF EXISTS employee_assets_insert ON public.employee_assets;
DROP POLICY IF EXISTS employee_assets_update ON public.employee_assets;
DROP POLICY IF EXISTS employee_assets_delete ON public.employee_assets;
CREATE POLICY employee_assets_select ON public.employee_assets
  FOR SELECT USING (org_id = public.current_org_id() AND (public.is_admin() OR employee_id = public.current_employee_id()));
CREATE POLICY employee_assets_insert ON public.employee_assets FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY employee_assets_update ON public.employee_assets FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY employee_assets_delete ON public.employee_assets FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS financial_balances_select ON public.financial_balances;
DROP POLICY IF EXISTS financial_balances_insert ON public.financial_balances;
DROP POLICY IF EXISTS financial_balances_update ON public.financial_balances;
DROP POLICY IF EXISTS financial_balances_delete ON public.financial_balances;
CREATE POLICY financial_balances_select ON public.financial_balances
  FOR SELECT USING (org_id = public.current_org_id() AND (public.is_admin() OR employee_id = public.current_employee_id()));
CREATE POLICY financial_balances_insert ON public.financial_balances FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY financial_balances_update ON public.financial_balances
  FOR UPDATE USING (public.is_admin() OR employee_id = public.current_employee_id())
  WITH CHECK (public.is_admin() OR employee_id = public.current_employee_id());
CREATE POLICY financial_balances_delete ON public.financial_balances FOR DELETE USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_job_postings_org ON public.job_postings(org_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_posting ON public.job_applications(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_payslips_org_month ON public.payslips(org_id, month);
CREATE INDEX IF NOT EXISTS idx_personnel_files_employee ON public.personnel_files(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_assets_employee ON public.employee_assets(employee_id);
CREATE INDEX IF NOT EXISTS idx_financial_balances_employee ON public.financial_balances(employee_id);
