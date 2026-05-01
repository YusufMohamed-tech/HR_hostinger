-- Tatwir Talent HRMS schema (Supabase Postgres)

create extension if not exists "pgcrypto";

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE public.org_role AS ENUM ('super_admin', 'admin', 'team_leader', 'employee');
  END IF;
END$$;

-- Utility functions
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Core tables
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  plan text DEFAULT 'Starter',
  status text DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'employee',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text AS $$
  SELECT role::text FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
  SELECT COALESCE((SELECT role = 'super_admin' FROM public.org_members WHERE user_id = auth.uid() LIMIT 1), false);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.is_org_admin(org uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid()
      AND org_id = org
      AND role IN ('admin', 'super_admin')
  );
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  full_name text,
  email text,
  phone text,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  head_employee_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  city text,
  geofence jsonb,
  geofence_status text DEFAULT 'Draft',
  latitude numeric,
  longitude numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_code text,
  full_name text NOT NULL,
  email text,
  phone text,
  role text,
  status text DEFAULT 'Active',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  hire_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, employee_code)
);

CREATE TABLE IF NOT EXISTS public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  base_salary numeric,
  currency text DEFAULT 'SAR',
  status text DEFAULT 'Active',
  terms jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_hierarchy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Scheduling
CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  shift_date date,
  start_time timestamptz,
  end_time timestamptz,
  required_headcount integer DEFAULT 0,
  status text DEFAULT 'Planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status text DEFAULT 'Assigned',
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  weekday integer,
  start_time time,
  end_time time,
  notes text
);

CREATE TABLE IF NOT EXISTS public.shift_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  conflict_type text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Events
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- KPI & Analytics
CREATE TABLE IF NOT EXISTS public.kpi_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  unit text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kpi_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  target_value numeric,
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kpi_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  value numeric,
  measured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  metrics jsonb,
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Payroll
CREATE TABLE IF NOT EXISTS public.payroll_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text,
  period_start date,
  period_end date,
  status text DEFAULT 'Draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_cycle_id uuid NOT NULL REFERENCES public.payroll_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  base_salary numeric DEFAULT 0,
  bonuses numeric DEFAULT 0,
  deductions numeric DEFAULT 0,
  total numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_item_id uuid NOT NULL REFERENCES public.payroll_items(id) ON DELETE CASCADE,
  earning_type text,
  amount numeric DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS public.deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_item_id uuid NOT NULL REFERENCES public.payroll_items(id) ON DELETE CASCADE,
  deduction_type text,
  amount numeric DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS public.kpi_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_item_id uuid NOT NULL REFERENCES public.payroll_items(id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  amount numeric DEFAULT 0
);

-- Learning
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.course_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status text DEFAULT 'Assigned',
  progress integer DEFAULT 0,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text DEFAULT 'Pending',
  completed_at timestamptz
);

-- Tracking
CREATE TABLE IF NOT EXISTS public.tracking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  source text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.tracking_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.tracking_sessions(id) ON DELETE CASCADE,
  latitude numeric,
  longitude numeric,
  accuracy numeric,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- AI Insights
CREATE TABLE IF NOT EXISTS public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  impact text,
  summary text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_org ON public.profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_departments_org ON public.departments(org_id);
CREATE INDEX IF NOT EXISTS idx_locations_org ON public.locations(org_id);
CREATE INDEX IF NOT EXISTS idx_employees_org ON public.employees(org_id);
CREATE INDEX IF NOT EXISTS idx_employees_user ON public.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org ON public.contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_shifts_org ON public.shifts(org_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_org ON public.shift_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_events_org ON public.events(org_id);
CREATE INDEX IF NOT EXISTS idx_kpi_targets_org ON public.kpi_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_kpi_results_org ON public.kpi_results(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_cycles_org ON public.payroll_cycles(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_org ON public.payroll_items(org_id);
CREATE INDEX IF NOT EXISTS idx_courses_org ON public.courses(org_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_org ON public.enrollments(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON public.audit_logs(org_id);

-- Updated_at triggers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_organizations_updated_at') THEN
    CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_updated_at') THEN
    CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_departments_updated_at') THEN
    CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_locations_updated_at') THEN
    CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employees_updated_at') THEN
    CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_contracts_updated_at') THEN
    CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON public.contracts
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_shifts_updated_at') THEN
    CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payroll_cycles_updated_at') THEN
    CREATE TRIGGER trg_payroll_cycles_updated_at BEFORE UPDATE ON public.payroll_cycles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_courses_updated_at') THEN
    CREATE TRIGGER trg_courses_updated_at BEFORE UPDATE ON public.courses
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_course_modules_updated_at') THEN
    CREATE TRIGGER trg_course_modules_updated_at BEFORE UPDATE ON public.course_modules
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enrollments_updated_at') THEN
    CREATE TRIGGER trg_enrollments_updated_at BEFORE UPDATE ON public.enrollments
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;

-- RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_hierarchy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Organizations policies
DROP POLICY IF EXISTS org_select ON public.organizations;
DROP POLICY IF EXISTS org_insert ON public.organizations;
DROP POLICY IF EXISTS org_update ON public.organizations;
DROP POLICY IF EXISTS org_delete ON public.organizations;

CREATE POLICY org_select ON public.organizations
  FOR SELECT USING (public.is_super_admin() OR id = public.current_org_id());
CREATE POLICY org_insert ON public.organizations
  FOR INSERT WITH CHECK (public.is_super_admin());
CREATE POLICY org_update ON public.organizations
  FOR UPDATE USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY org_delete ON public.organizations
  FOR DELETE USING (public.is_super_admin());

-- Org members policies
DROP POLICY IF EXISTS org_members_select ON public.org_members;
DROP POLICY IF EXISTS org_members_insert ON public.org_members;
DROP POLICY IF EXISTS org_members_update ON public.org_members;
DROP POLICY IF EXISTS org_members_delete ON public.org_members;

CREATE POLICY org_members_select ON public.org_members
  FOR SELECT USING (public.is_super_admin() OR org_id = public.current_org_id());
CREATE POLICY org_members_insert ON public.org_members
  FOR INSERT WITH CHECK (public.is_super_admin() OR (org_id = public.current_org_id() AND public.current_role() IN ('admin','super_admin')));
CREATE POLICY org_members_update ON public.org_members
  FOR UPDATE USING (public.is_super_admin() OR (org_id = public.current_org_id() AND public.current_role() IN ('admin','super_admin')))
  WITH CHECK (public.is_super_admin() OR (org_id = public.current_org_id() AND public.current_role() IN ('admin','super_admin')));
CREATE POLICY org_members_delete ON public.org_members
  FOR DELETE USING (public.is_super_admin() OR (org_id = public.current_org_id() AND public.current_role() IN ('admin','super_admin')));

-- Profiles policies
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (public.is_super_admin() OR org_id = public.current_org_id() OR user_id = auth.uid());
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (public.is_super_admin() OR org_id = public.current_org_id() OR user_id = auth.uid());
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE USING (public.is_super_admin() OR org_id = public.current_org_id() OR user_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR org_id = public.current_org_id() OR user_id = auth.uid());
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE USING (public.is_super_admin() OR org_id = public.current_org_id());

-- Generic org-scoped policies
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'departments','locations','employees','contracts','org_hierarchy','shifts','shift_assignments',
    'availability','shift_conflicts','events','kpi_definitions','kpi_targets','kpi_results','team_metrics',
    'payroll_cycles','payroll_items','earnings','deductions','kpi_payouts','courses','course_modules',
    'enrollments','milestones','tracking_sessions','tracking_points','ai_insights','audit_logs'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_select_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_insert_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_update_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_delete_%I ON public.%I', tbl, tbl);

    EXECUTE format(
      'CREATE POLICY org_select_%I ON public.%I FOR SELECT USING (public.is_super_admin() OR org_id = public.current_org_id())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY org_insert_%I ON public.%I FOR INSERT WITH CHECK (public.is_super_admin() OR org_id = public.current_org_id())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY org_update_%I ON public.%I FOR UPDATE USING (public.is_super_admin() OR org_id = public.current_org_id()) WITH CHECK (public.is_super_admin() OR org_id = public.current_org_id())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY org_delete_%I ON public.%I FOR DELETE USING (public.is_super_admin() OR org_id = public.current_org_id())',
      tbl, tbl
    );
  END LOOP;
END$$;

-- Employee self-access policy
DROP POLICY IF EXISTS employees_self ON public.employees;
CREATE POLICY employees_self ON public.employees
  FOR SELECT USING (user_id = auth.uid());

-- Shift assignment self-access
DROP POLICY IF EXISTS shift_assignments_self ON public.shift_assignments;
CREATE POLICY shift_assignments_self ON public.shift_assignments
  FOR SELECT USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
