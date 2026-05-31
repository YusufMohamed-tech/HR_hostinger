-- Phase 1 Core Workforce OS schema (Supabase Postgres) - Production Clean Version
-- This version excludes auth table manipulations and removes duplicates

create extension if not exists "pgcrypto";

-- Drop existing triggers first (only if they exist)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop all existing tables in reverse dependency order
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.leave_requests CASCADE;
DROP TABLE IF EXISTS public.leave_balances CASCADE;
DROP TABLE IF EXISTS public.task_attachments CASCADE;
DROP TABLE IF EXISTS public.task_updates CASCADE;
DROP TABLE IF EXISTS public.task_assignments CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.attendance_records CASCADE;
DROP TABLE IF EXISTS public.employee_shifts CASCADE;
DROP TABLE IF EXISTS public.shifts CASCADE;
DROP TABLE IF EXISTS public.employee_actions CASCADE;
DROP TABLE IF EXISTS public.employee_reviews CASCADE;
DROP TABLE IF EXISTS public.employee_kpis CASCADE;
DROP TABLE IF EXISTS public.salary_history CASCADE;
DROP TABLE IF EXISTS public.employee_documents CASCADE;
DROP TABLE IF EXISTS public.employees CASCADE;
DROP TABLE IF EXISTS public.locations CASCADE;
DROP TABLE IF EXISTS public.departments CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.org_members CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;

-- Drop existing functions
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.touch_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.current_org_id() CASCADE;
DROP FUNCTION IF EXISTS public.current_role() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.current_employee_id() CASCADE;

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE public.org_role AS ENUM ('admin', 'employee');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
    CREATE TYPE public.employment_type AS ENUM ('full_time', 'part_time', 'intern', 'contract');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE public.attendance_status AS ENUM ('present', 'late', 'absent', 'on_leave', 'half_day');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE public.task_status AS ENUM ('pending', 'in_progress', 'completed', 'rejected', 'delayed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_type') THEN
    CREATE TYPE public.leave_type AS ENUM ('sick', 'vacation', 'emergency');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_status') THEN
    CREATE TYPE public.leave_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_type') THEN
    CREATE TYPE public.shift_type AS ENUM ('morning', 'night', 'flexible');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE public.notification_type AS ENUM ('attendance', 'task', 'leave', 'system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type') THEN
    CREATE TYPE public.document_type AS ENUM ('cv', 'contract', 'national_id', 'certificate', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_type') THEN
    CREATE TYPE public.location_type AS ENUM ('branch', 'booth', 'office', 'area');
  END IF;
END$$;

-- Core tables
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
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

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  full_name text,
  email text,
  phone text,
  title text,
  username text,
  account_status text DEFAULT 'Active',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  manager_employee_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.location_type NOT NULL DEFAULT 'branch',
  latitude numeric,
  longitude numeric,
  radius_meters integer DEFAULT 100,
  manager_employee_id uuid,
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
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  national_id text,
  date_of_birth date,
  gender text,
  hiring_date date,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  job_title text,
  manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  employment_type public.employment_type DEFAULT 'full_time',
  status text DEFAULT 'Active',
  base_salary numeric DEFAULT 0,
  bonus numeric DEFAULT 0,
  deductions numeric DEFAULT 0,
  payment_method text,
  bank_account text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, employee_code)
);

-- Add cross-reference foreign keys (resolves circular dependency)
ALTER TABLE public.departments ADD CONSTRAINT fk_departments_manager
  FOREIGN KEY (manager_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.locations ADD CONSTRAINT fk_locations_manager
  FOREIGN KEY (manager_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;

-- Additional tables (same as original)
CREATE TABLE IF NOT EXISTS public.employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  doc_type public.document_type NOT NULL DEFAULT 'other',
  file_path text NOT NULL,
  file_name text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.salary_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  base_salary numeric DEFAULT 0,
  bonus numeric DEFAULT 0,
  deductions numeric DEFAULT 0,
  payment_method text,
  bank_account text,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kpi_name text NOT NULL,
  value numeric,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  review_month date,
  rating numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  reason text,
  points numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Shifts
CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  shift_type public.shift_type NOT NULL DEFAULT 'morning',
  start_time time,
  end_time time,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Attendance
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  check_in_at timestamptz,
  check_out_at timestamptz,
  check_in_lat numeric,
  check_in_lng numeric,
  check_out_lat numeric,
  check_out_lng numeric,
  check_in_device text,
  check_out_device text,
  check_in_photo_path text,
  status public.attendance_status DEFAULT 'present',
  total_minutes integer DEFAULT 0,
  late_minutes integer DEFAULT 0,
  within_geofence boolean DEFAULT true,
  distance_meters integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tasks
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority text DEFAULT 'medium',
  status public.task_status NOT NULL DEFAULT 'pending',
  due_date date,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status public.task_status NOT NULL DEFAULT 'pending',
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  status public.task_status,
  progress integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_path text NOT NULL,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Leave
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  sick_remaining integer DEFAULT 0,
  vacation_remaining integer DEFAULT 0,
  emergency_remaining integer DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type public.leave_type NOT NULL,
  status public.leave_status NOT NULL DEFAULT 'pending',
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note text
);

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type public.notification_type NOT NULL DEFAULT 'system',
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity, entity_id);

-- Utility functions
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text AS $$
  SELECT role::text FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT COALESCE((SELECT role = 'admin' FROM public.org_members WHERE user_id = auth.uid() LIMIT 1), false);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid AS $$
  SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only create trigger if auth.users is accessible
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'auth') THEN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_org ON public.profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_departments_org ON public.departments(org_id);
CREATE INDEX IF NOT EXISTS idx_locations_org ON public.locations(org_id);
CREATE INDEX IF NOT EXISTS idx_employees_org ON public.employees(org_id);
CREATE INDEX IF NOT EXISTS idx_employees_user ON public.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_docs_org ON public.employee_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_employee_docs_emp ON public.employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_org ON public.attendance_records(org_id);
CREATE INDEX IF NOT EXISTS idx_attendance_emp ON public.attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_emp ON public.task_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);

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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_shifts_updated_at') THEN
    CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tasks_updated_at') THEN
    CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_updated_at') THEN
    CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON public.attendance_records
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
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Organizations policies
DROP POLICY IF EXISTS org_select ON public.organizations;
DROP POLICY IF EXISTS org_insert ON public.organizations;
DROP POLICY IF EXISTS org_update ON public.organizations;
DROP POLICY IF EXISTS org_delete ON public.organizations;

CREATE POLICY org_select ON public.organizations
  FOR SELECT USING (id = public.current_org_id());
CREATE POLICY org_insert ON public.organizations
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY org_update ON public.organizations
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY org_delete ON public.organizations
  FOR DELETE USING (auth.role() = 'service_role');

-- Org members policies
DROP POLICY IF EXISTS org_members_select ON public.org_members;
DROP POLICY IF EXISTS org_members_insert ON public.org_members;
DROP POLICY IF EXISTS org_members_update ON public.org_members;
DROP POLICY IF EXISTS org_members_delete ON public.org_members;

CREATE POLICY org_members_select ON public.org_members
  FOR SELECT USING (user_id = auth.uid() OR org_id = public.current_org_id());
CREATE POLICY org_members_insert ON public.org_members
  FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
CREATE POLICY org_members_update ON public.org_members
  FOR UPDATE USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
CREATE POLICY org_members_delete ON public.org_members
  FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

-- Profiles policies
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (user_id = auth.uid() OR auth.role() = 'service_role');
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE USING (auth.role() = 'service_role');

-- Generic org-scoped policies (admin full, employees read)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'departments','locations','employees','employee_documents','salary_history',
    'employee_kpis','employee_reviews','employee_actions','shifts','employee_shifts',
    'attendance_records','tasks','task_assignments','task_updates','task_attachments',
    'leave_balances','leave_requests'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_select_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_insert_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_update_%I ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_delete_%I ON public.%I', tbl, tbl);

    EXECUTE format(
      'CREATE POLICY org_select_%I ON public.%I FOR SELECT USING (org_id = public.current_org_id())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY org_insert_%I ON public.%I FOR INSERT WITH CHECK (public.is_admin())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY org_update_%I ON public.%I FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY org_delete_%I ON public.%I FOR DELETE USING (public.is_admin())',
      tbl, tbl
    );
  END LOOP;
END$$;

-- Employee self access (employees table)
DROP POLICY IF EXISTS employees_self ON public.employees;
CREATE POLICY employees_self ON public.employees
  FOR SELECT USING (user_id = auth.uid());

-- Attendance: employees can insert/update their own records
DROP POLICY IF EXISTS attendance_self_insert ON public.attendance_records;
DROP POLICY IF EXISTS attendance_self_update ON public.attendance_records;

CREATE POLICY attendance_self_insert ON public.attendance_records
  FOR INSERT WITH CHECK (employee_id = public.current_employee_id() AND org_id = public.current_org_id());
CREATE POLICY attendance_self_update ON public.attendance_records
  FOR UPDATE USING (employee_id = public.current_employee_id() AND org_id = public.current_org_id())
  WITH CHECK (employee_id = public.current_employee_id() AND org_id = public.current_org_id());

-- Tasks: employees can view assigned tasks and update their own assignments
DROP POLICY IF EXISTS tasks_employee_select ON public.tasks;
CREATE POLICY tasks_employee_select ON public.tasks
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = id AND ta.employee_id = public.current_employee_id()
    )
  );

DROP POLICY IF EXISTS task_assignments_employee_select ON public.task_assignments;
CREATE POLICY task_assignments_employee_select ON public.task_assignments
  FOR SELECT USING (public.is_admin() OR employee_id = public.current_employee_id());

DROP POLICY IF EXISTS task_updates_employee_insert ON public.task_updates;
CREATE POLICY task_updates_employee_insert ON public.task_updates
  FOR INSERT WITH CHECK (public.is_admin() OR employee_id = public.current_employee_id());

-- Leave: employees can create and view their own requests
DROP POLICY IF EXISTS leave_requests_self_select ON public.leave_requests;
DROP POLICY IF EXISTS leave_requests_self_insert ON public.leave_requests;

CREATE POLICY leave_requests_self_select ON public.leave_requests
  FOR SELECT USING (public.is_admin() OR employee_id = public.current_employee_id());
CREATE POLICY leave_requests_self_insert ON public.leave_requests
  FOR INSERT WITH CHECK (employee_id = public.current_employee_id() AND org_id = public.current_org_id());


-- Audit logs: admins can read org logs; writes are server/admin only.
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;

CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT USING (public.is_admin() AND org_id = public.current_org_id());
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
-- Notifications: employee sees own notifications; admin sees all
DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;

CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (public.is_admin() OR user_id = auth.uid());
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

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

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'hr_admin';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'hr_recruitment';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'training_manager';

-- Enable RLS logic for training managers so they only see employees in their location
-- Drop old employee select policy and replace
DROP POLICY IF EXISTS org_select_employees ON public.employees;
CREATE POLICY org_select_employees ON public.employees FOR SELECT USING (
  org_id = public.current_org_id() AND (
    public.is_admin() OR 
    (public.current_role() = 'hr_admin') OR 
    (public.current_role() = 'hr_recruitment') OR
    (public.current_role() = 'training_manager' AND (
      manager_id = public.current_employee_id() OR
      location_id = (SELECT location_id FROM public.employees WHERE id = public.current_employee_id())
    )) OR
    user_id = auth.uid()
  )
);
