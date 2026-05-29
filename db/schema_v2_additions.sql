-- Part 2 Enhancements: Payroll, Assets, Recruitment, Financial Balances

-- 1. Recruitment Module
CREATE TABLE IF NOT EXISTS public.job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  description text,
  requirements text,
  status text DEFAULT 'open',
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
  status text DEFAULT 'new',
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

-- 2. Payroll Module
CREATE TABLE IF NOT EXISTS public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  month date NOT NULL, -- e.g., 2026-05-01 for May 2026
  base_salary numeric DEFAULT 0,
  total_allowances numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  net_salary numeric DEFAULT 0,
  attendance_days integer DEFAULT 0,
  status text DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Asset Handover
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

-- 4. Financial Balances / Deficit
CREATE TABLE IF NOT EXISTS public.financial_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  balance_type text NOT NULL, -- 'deficit', 'loan', 'advance_payment'
  amount numeric DEFAULT 0,
  status text DEFAULT 'unpaid',
  description text,
  acknowledgment_signature_url text, -- For e-signature
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Note: Device locking for attendance can use a new column on employees.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS registered_device_id text;

-- Note: Multi-level leave approval
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS manager_approval_status text DEFAULT 'pending';
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS hr_approval_status text DEFAULT 'pending';

-- RLS & Security for new tables
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_balances ENABLE ROW LEVEL SECURITY;

-- We can create basic policies similar to others:
CREATE POLICY org_select_job_postings ON public.job_postings FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY org_insert_job_postings ON public.job_postings FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY org_update_job_postings ON public.job_postings FOR UPDATE USING (public.is_admin());
CREATE POLICY org_delete_job_postings ON public.job_postings FOR DELETE USING (public.is_admin());

CREATE POLICY org_select_job_applications ON public.job_applications FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY org_insert_job_applications ON public.job_applications FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY org_update_job_applications ON public.job_applications FOR UPDATE USING (public.is_admin());
CREATE POLICY org_delete_job_applications ON public.job_applications FOR DELETE USING (public.is_admin());

CREATE POLICY org_select_interviews ON public.interviews FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY org_insert_interviews ON public.interviews FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY org_update_interviews ON public.interviews FOR UPDATE USING (public.is_admin());
CREATE POLICY org_delete_interviews ON public.interviews FOR DELETE USING (public.is_admin());

CREATE POLICY org_select_payslips ON public.payslips FOR SELECT USING (org_id = public.current_org_id() AND (public.is_admin() OR employee_id = public.current_employee_id()));
CREATE POLICY org_insert_payslips ON public.payslips FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY org_update_payslips ON public.payslips FOR UPDATE USING (public.is_admin());
CREATE POLICY org_delete_payslips ON public.payslips FOR DELETE USING (public.is_admin());

CREATE POLICY org_select_employee_assets ON public.employee_assets FOR SELECT USING (org_id = public.current_org_id() AND (public.is_admin() OR employee_id = public.current_employee_id()));
CREATE POLICY org_insert_employee_assets ON public.employee_assets FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY org_update_employee_assets ON public.employee_assets FOR UPDATE USING (public.is_admin());
CREATE POLICY org_delete_employee_assets ON public.employee_assets FOR DELETE USING (public.is_admin());

CREATE POLICY org_select_fin_balances ON public.financial_balances FOR SELECT USING (org_id = public.current_org_id() AND (public.is_admin() OR employee_id = public.current_employee_id()));
CREATE POLICY org_insert_fin_balances ON public.financial_balances FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY org_update_fin_balances ON public.financial_balances FOR UPDATE USING (public.is_admin());
CREATE POLICY org_delete_fin_balances ON public.financial_balances FOR DELETE USING (public.is_admin());

