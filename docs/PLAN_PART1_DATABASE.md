# Implementation Plan — Part 1: Database Schema

## New Enums
```sql
CREATE TYPE hire_status AS ENUM ('new','screening','interview','offer','hired','rejected');
CREATE TYPE contract_type AS ENUM ('permanent','temporary','probation');
CREATE TYPE balance_type AS ENUM ('advance','loan','penalty','reimbursement','bonus_owed');
CREATE TYPE asset_status AS ENUM ('available','assigned','maintenance','retired');
CREATE TYPE payroll_status AS ENUM ('draft','processing','finalized','paid');
CREATE TYPE approval_step_status AS ENUM ('pending','approved','rejected','skipped');
CREATE TYPE file_category AS ENUM ('social_insurance','contract','national_id','work_permit','medical','certificate','other');
```

## RBAC Tables (replaces simple admin/employee)
```sql
CREATE TABLE roles (
  id uuid PK DEFAULT gen_random_uuid(),
  org_id uuid FK→organizations,
  name text NOT NULL,           -- 'super_admin','hr_admin','hr_recruitment','training_manager','employee'
  description text,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PK DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,    -- 'payroll.view','payroll.manage','recruitment.manage','personnel.view' etc.
  module text NOT NULL,         -- 'payroll','personnel','recruitment','attendance','leave','balance','assets','employees','settings'
  description text
);

CREATE TABLE role_permissions (
  role_id uuid FK→roles ON DELETE CASCADE,
  permission_id uuid FK→permissions ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Alter existing org_members
ALTER TABLE org_members ADD COLUMN role_id uuid REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE org_members ADD COLUMN location_scope uuid REFERENCES locations(id) ON DELETE SET NULL;
-- location_scope: if set, user can only see data for this location (city isolation for training managers)
```

## Payroll Tables
```sql
CREATE TABLE payroll_periods (
  id uuid PK, org_id uuid FK→organizations,
  name text NOT NULL,               -- 'May 2026', 'April 2026'
  start_date date NOT NULL,
  end_date date NOT NULL,
  working_days integer NOT NULL DEFAULT 22,
  status payroll_status DEFAULT 'draft',
  created_by uuid FK→auth.users,
  finalized_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE payroll_slips (
  id uuid PK, org_id uuid FK→organizations,
  period_id uuid FK→payroll_periods ON DELETE CASCADE,
  employee_id uuid FK→employees ON DELETE CASCADE,
  -- Attendance summary (auto-calculated from attendance_records)
  working_days integer DEFAULT 0,
  present_days integer DEFAULT 0,
  absent_days integer DEFAULT 0,
  late_days integer DEFAULT 0,
  leave_days integer DEFAULT 0,
  -- Salary calculation
  base_salary numeric DEFAULT 0,
  daily_rate numeric DEFAULT 0,        -- base_salary / working_days
  attendance_deduction numeric DEFAULT 0, -- absent_days * daily_rate
  late_deduction numeric DEFAULT 0,
  bonus numeric DEFAULT 0,
  allowances numeric DEFAULT 0,        -- housing, transport, etc.
  overtime_hours numeric DEFAULT 0,
  overtime_amount numeric DEFAULT 0,
  other_deductions numeric DEFAULT 0,  -- loans, advances, penalties
  social_insurance_deduction numeric DEFAULT 0,
  gross_salary numeric DEFAULT 0,
  net_salary numeric DEFAULT 0,
  notes text,
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  UNIQUE(period_id, employee_id)
);
```

## Personnel Tables
```sql
CREATE TABLE personnel_files (
  id uuid PK, org_id uuid FK→organizations,
  employee_id uuid FK→employees ON DELETE CASCADE,
  category file_category NOT NULL DEFAULT 'other',
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  expiry_date date,                     -- alerts when within 30 days
  is_verified boolean DEFAULT false,
  verified_by uuid FK→auth.users,
  notes text,
  uploaded_by uuid FK→auth.users,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE social_insurance (
  id uuid PK, org_id uuid FK→organizations,
  employee_id uuid FK→employees ON DELETE CASCADE,
  gosi_number text,
  registration_date date,
  contribution_rate numeric DEFAULT 9.75, -- Saudi GOSI rate
  employer_share numeric DEFAULT 0,
  employee_share numeric DEFAULT 0,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, employee_id)
);

CREATE TABLE employee_contracts (
  id uuid PK, org_id uuid FK→organizations,
  employee_id uuid FK→employees ON DELETE CASCADE,
  contract_type contract_type DEFAULT 'permanent',
  start_date date NOT NULL,
  end_date date,
  probation_end_date date,
  salary_at_signing numeric,
  file_path text,
  status text DEFAULT 'active',        -- active, expired, terminated
  signed_at timestamptz,
  terminated_at timestamptz,
  termination_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

## Recruitment Tables
```sql
CREATE TABLE job_postings (
  id uuid PK, org_id uuid FK→organizations,
  title text NOT NULL,
  department_id uuid FK→departments,
  location_id uuid FK→locations,
  description text,
  requirements text,
  employment_type employment_type DEFAULT 'full_time',
  salary_range_min numeric,
  salary_range_max numeric,
  positions_count integer DEFAULT 1,
  status text DEFAULT 'draft',          -- draft, published, closed, filled
  published_at timestamptz,
  closes_at timestamptz,
  created_by uuid FK→auth.users,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE job_applications (
  id uuid PK, org_id uuid FK→organizations,
  posting_id uuid FK→job_postings ON DELETE CASCADE,
  applicant_name text NOT NULL,
  applicant_email text NOT NULL,
  applicant_phone text,
  resume_path text,
  cover_letter text,
  status hire_status DEFAULT 'new',
  rating integer CHECK (rating BETWEEN 1 AND 5),
  notes text,
  reviewed_by uuid FK→auth.users,
  applied_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE interview_rounds (
  id uuid PK, org_id uuid FK→organizations,
  application_id uuid FK→job_applications ON DELETE CASCADE,
  round_number integer DEFAULT 1,
  scheduled_at timestamptz,
  interviewer_id uuid FK→employees,
  location text,
  meeting_link text,
  status text DEFAULT 'scheduled',      -- scheduled, completed, cancelled, no_show
  score integer CHECK (score BETWEEN 1 AND 10),
  feedback text,
  created_at timestamptz DEFAULT now()
);
```

## Balance/Deficit Tables
```sql
CREATE TABLE employee_balances (
  id uuid PK, org_id uuid FK→organizations,
  employee_id uuid FK→employees ON DELETE CASCADE,
  type balance_type NOT NULL,
  amount numeric NOT NULL,
  remaining numeric NOT NULL,           -- decreases as paid off
  description text,
  due_date date,
  status text DEFAULT 'pending',        -- pending, partial, settled, cancelled
  created_by uuid FK→auth.users,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE balance_attachments (
  id uuid PK,
  balance_id uuid FK→employee_balances ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  uploaded_by uuid FK→auth.users,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE balance_acknowledgments (
  id uuid PK,
  balance_id uuid FK→employee_balances ON DELETE CASCADE,
  employee_id uuid FK→employees,
  acknowledged_at timestamptz DEFAULT now(),
  signature_data text,                  -- base64 signature or 'checkbox_confirmed'
  ip_address text,
  UNIQUE(balance_id, employee_id)
);
```

## Asset Handover Tables
```sql
CREATE TABLE asset_categories (
  id uuid PK, org_id uuid FK→organizations,
  name text NOT NULL,                   -- 'Laptop', 'Fingerprint Device', 'Phone', 'Uniform', 'Keys'
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE assets (
  id uuid PK, org_id uuid FK→organizations,
  category_id uuid FK→asset_categories ON DELETE SET NULL,
  asset_code text,                      -- inventory code
  name text NOT NULL,
  description text,
  serial_number text,
  purchase_date date,
  purchase_cost numeric,
  status asset_status DEFAULT 'available',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, asset_code)
);

CREATE TABLE asset_assignments (
  id uuid PK, org_id uuid FK→organizations,
  asset_id uuid FK→assets ON DELETE CASCADE,
  employee_id uuid FK→employees ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid FK→auth.users,
  returned_at timestamptz,
  return_condition text,                -- 'good', 'damaged', 'lost'
  notes text,
  acknowledgment_signature text,
  status text DEFAULT 'active'          -- active, returned, lost, damaged
);
```

## Attendance Enhancements
```sql
ALTER TABLE employees ADD COLUMN registered_device_id text;
ALTER TABLE employees ADD COLUMN registered_device_name text;
ALTER TABLE attendance_records ADD COLUMN device_fingerprint text;
ALTER TABLE attendance_records ADD COLUMN is_registered_device boolean DEFAULT false;
-- Prevent duplicate check-ins per day
ALTER TABLE attendance_records ADD CONSTRAINT unique_daily_checkin UNIQUE(employee_id, work_date);
```

## Leave Multi-Level Approval
```sql
CREATE TABLE leave_approval_steps (
  id uuid PK,
  org_id uuid FK→organizations,
  leave_request_id uuid FK→leave_requests ON DELETE CASCADE,
  step_order integer NOT NULL,
  approver_id uuid FK→employees,
  status approval_step_status DEFAULT 'pending',
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE leave_requests ADD COLUMN total_steps integer DEFAULT 1;
ALTER TABLE leave_requests ADD COLUMN current_step integer DEFAULT 1;
-- Add more leave types
-- Will need to alter leave_type enum: ADD VALUE 'annual', 'unpaid', 'maternity', 'paternity'
```

## Audit Log Table (missing from Phase 1)
```sql
CREATE TABLE audit_logs (
  id uuid PK DEFAULT gen_random_uuid(),
  org_id uuid FK→organizations,
  actor_user_id uuid FK→auth.users,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz DEFAULT now()
);
```
