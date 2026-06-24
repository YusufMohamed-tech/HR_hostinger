# Database Structure

## Overview

Tatwir Talent HRMS uses **Supabase (PostgreSQL)** as its database, with Row Level Security (RLS) enforcing multi-tenant data isolation. The schema consists of 40+ tables across multiple modules, managed through versioned SQL migrations.

## Schema Files

| File | Purpose |
|------|---------|
| `db/schema-production-clean.sql` | Canonical base schema (v1) |
| `db/schema_v2_additions.sql` through `db/schema_v40_accounting_audit_fixes.sql` | Incremental migrations |

## Multi-Tenancy Model

Every table includes an `org_id` column referencing the `organizations` table. Database-level helper functions extract the current user's organization:

```sql
current_org_id()      -- Returns org_id for the authenticated user
current_role()        -- Returns the user's org role text
is_admin()            -- Returns boolean (true for admin/super_admin roles)
current_employee_id() -- Returns employee.id for the authenticated user
```

## Enums

```sql
org_role:          'super_admin' | 'admin' | 'employee' | 'hr_admin' | 'hr_recruitment' |
                   'training_manager' | 'sales' | 'sales_manager' | 'finance_manager' |
                   'accountant' | 'finance_viewer'
employment_type:   'full_time' | 'part_time' | 'intern' | 'contract'
attendance_status: 'present' | 'late' | 'absent' | 'on_leave' | 'half_day'
task_status:       'pending' | 'in_progress' | 'completed' | 'rejected' | 'delayed'
leave_type:        'sick' | 'vacation' | 'emergency'
leave_status:      'pending' | 'approved' | 'rejected'
shift_type:        'morning' | 'night' | 'flexible'
notification_type: 'attendance' | 'task' | 'leave' | 'system' | 'sales' | 'accounting'
document_type:     'cv' | 'contract' | 'national_id' | 'certificate' | 'other'
location_type:     'branch' | 'booth' | 'office' | 'area'
```

## Table Catalog

### Core / Platform Tables

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `organizations` | Tenant registry | id, name, slug, status, created_at, updated_at |
| `org_members` | User-org membership with roles | id, org_id→organizations, user_id→auth.users, role(org_role) |
| `profiles` | User profile data | user_id(PK)→auth.users, org_id, full_name, email, phone, title, account_status |
| `platform_admins` | Platform-level superadmins | user_id→auth.users, role, status |

### Employee Management

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `employees` | Employee records | id, org_id, user_id, employee_code, full_name, email, phone, department_id, job_title, manager_id(self-ref), location_id, employment_type, base_salary, bonus, deductions, hiring_date, status |
| `departments` | Organizational departments | id, org_id, name, manager_employee_id→employees |
| `locations` | Physical locations with geofence | id, org_id, name, type(location_type), latitude, longitude, radius_meters(default 100), manager_employee_id |
| `employee_documents` | Uploaded documents | id, org_id, employee_id, doc_type, file_path, file_name, uploaded_by |
| `salary_history` | Salary change audit trail | id, org_id, employee_id, base_salary, bonus, deductions, effective_date |
| `employee_kpis` | KPI metrics | id, org_id, employee_id, kpi_name, value, recorded_at |
| `employee_reviews` | Performance reviews | id, org_id, employee_id, review_month, rating, notes |
| `employee_actions` | Disciplinary/reward actions | id, org_id, employee_id, action_type, reason, points |
| `employee_career_events` | Career progression | id, org_id, employee_id, event_type, details |
| `employee_locations` | Employee-location assignments | id, org_id, employee_id, location_id |

### Scheduling & Attendance

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `shifts` | Shift templates | id, org_id, name, shift_type, start_time(TIME), end_time(TIME), location_id |
| `employee_shifts` | Shift assignments | id, org_id, employee_id, shift_id, start_date, end_date |
| `attendance_records` | Daily attendance logs | id, org_id, employee_id, work_date, shift_id, check_in_at, check_out_at, check_in_lat/lng, check_out_lat/lng, check_in_photo_path, status, total_minutes, late_minutes, within_geofence, distance_meters |

### Task Management

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `tasks` | Task definitions | id, org_id, title, description, priority, status(task_status), due_date, created_by |
| `task_assignments` | Task-employee links | id, org_id, task_id, employee_id, status(task_status), assigned_at |
| `task_updates` | Progress notes | id, org_id, task_id, employee_id, status, progress(int), note |
| `task_attachments` | Task file uploads | id, org_id, task_id, uploaded_by, file_path, file_name |

### Leave Management

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `leave_balances` | Per-employee balances | id, org_id, employee_id, sick_remaining, vacation_remaining, emergency_remaining | UNIQUE(org_id, employee_id) |
| `leave_requests` | Leave request workflow | id, org_id, employee_id, leave_type, status(leave_status), start_date, end_date, reason, decided_at, decided_by, decision_note |

### Notifications

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `notifications` | In-app notifications | id, org_id, user_id, title, body, type(notification_type), link, is_read, created_at |

### Recruitment / ATS

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `recruitment_postings` | Job postings | id, org_id, title, description, status, location, requirements |
| `recruitment_applications` | Candidate applications | id, org_id, posting_id, candidate data, stage, status |
| `recruitment_interviews` | Interview scheduling | id, org_id, application_id, date, type, notes |
| `recruitment_pipeline_stages` | Custom pipeline stages | id, org_id, name, order |
| `recruitment_form_templates` | Custom application forms | id, org_id, name, fields(jsonb) |

### Sales Module

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `sales_companies` | Customer/company registry | id, org_id, name, type |
| `sales_log_entries` | Daily sales activity | id, org_id, employee_id, date, company_id, products, amount |
| `sales_products` | Product catalog | id, org_id, name, category, price |
| `sales_dashboard_settings` | Dashboard config | id, org_id, settings(jsonb) |
| `sales_shift_targets` | Sales targets per shift | id, org_id, shift_id, target_amount |

### Accounting Module

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `chart_of_accounts` | GL account registry | id, org_id, account_code, name, type, parent_id, status |
| `journal_entries` | Journal header | id, org_id, entry_number, posting_date, memo, status |
| `journal_entry_lines` | Journal line items | id, journal_entry_id, account_id, debit, credit, description |
| `invoices` | Invoice records | id, org_id, invoice_number, customer_id, invoice_date, total_amount, status |
| `invoice_lines` | Invoice line items | id, invoice_id, description, quantity, unit_price, amount |
| `expenses` | Expense records | id, org_id, expense_number, vendor_id, amount, category, status |
| `payments` | Payment records | id, org_id, payment_number, vendor_id/customer_id, amount, date |
| `vendors` | Vendor registry | id, org_id, name, contact, tax_id |
| `customers` | Customer registry | id, org_id, name, contact, tax_id |
| `cost_centers` | Cost center definitions | id, org_id, code, name, status |
| `accounting_team_members` | Finance team roles | id, org_id, user_id, role |
| `audit_logs` | Accounting audit trail | id, org_id, actor_id, action, entity_type, entity_id, details, created_at |

## Entity Relationship Diagram

```
organizations (1)─────────────(N) org_members (N)─────────────(1) auth.users
       │                                                              │
       │                                                              │
       ├──(1)──────────(N) departments                                │
       │                      │                                       │
       │                      │ manager_employee_id                   │
       │                      ▼                                       │
       ├──(1)──────────(N) employees ◄────────────────────────────────┘
       │                      │         (user_id)
       │                      │
       │              ┌───────┼───────────────────────┐
       │              │       │                       │
       │              ▼       ▼                       ▼
       │    employee_documents  salary_history   employee_kpis
       │              
       │              │
       │              ▼
       ├──(1)──────────(N) locations
       │                      │
       │                      ▼
       ├──(1)──────────(N) shifts ──────(N)── employee_shifts
       │                      │
       │                      ▼
       ├──(1)──────────(N) attendance_records
       │
       ├──(1)──────────(N) tasks ──────(N)── task_assignments
       │                      │
       │                      ├──(N)── task_updates
       │                      └──(N)── task_attachments
       │
       ├──(1)──────────(N) leave_requests
       ├──(1)──────────(N) leave_balances
       │
       ├──(1)──────────(N) notifications
       │
       ├──(1)──────────(N) recruitment_postings ──(N)── recruitment_applications
       │
       ├──(1)──────────(N) sales_log_entries
       │
       └──(1)──────────(N) chart_of_accounts
                                    │
                                    ▼
                           journal_entry_lines ──(N)── journal_entries
```

## Row Level Security (RLS) Policies

All tables have RLS enabled with these patterns:

### SELECT (Read) Policies
- **Org-scoped:** `org_id = current_org_id()` — users see only their organization's data
- **Employee self-access:** Employees can read their own records

### INSERT/UPDATE/DELETE (Write) Policies
- **Admin-only writes:** `is_admin()` required for most management tables
- **Employee self-service:** Employees can:
  - Insert/update own attendance records
  - View assigned tasks and create task updates
  - Submit leave requests
  - See own notifications and mark them read

### Special Cases
- `platform_admins` table: accessible only by authenticated superadmins
- `notifications`: users can only read/update their own (user_id match)
- `task_assignments`: employees can update status on their own assignments

## Triggers

| Trigger | Function | Purpose |
|---------|----------|---------|
| `touch_updated_at` | Updates `updated_at` column | Auto-timestamp on row modification |
| `handle_new_user` | Auto-creates profile | On `auth.users` INSERT, creates corresponding profile |

## Migration Strategy

Migrations are versioned SQL files applied sequentially:

```bash
# Safe incremental migration (production-safe)
npm run apply:migration -- db/schema_v12_safe_saves_and_policy_fix.sql

# Full destructive reset (local/staging only)
ALLOW_DESTRUCTIVE_SCHEMA_APPLY=true npm run apply:schema
```

### Migration History Highlights

| Version | Feature |
|---------|---------|
| v1 (base) | Core HR tables, auth, orgs, employees, departments |
| v2-v4 | Additional modules, RBAC enhancements |
| v5-v8 | Recruitment portal and ATS |
| v9-v10 | Platform admins, attendance policies |
| v11-v15 | Manager scoping, shift timing, task cleanup |
| v16-v17 | Recruitment pipeline, sales module |
| v18-v20 | Leave accrual, task attachments, advance requests |
| v21-v26 | Multi-checkin, employee locations, career events, job templates |
| v27-v29 | Test accounts, leave balance unification, chat module |
| v30-v36 | Sales enhancements (telecom, log edits, dashboards, shift targets) |
| v37-v40 | Full accounting module (journals, invoices, AP/AR, auditing) |

## Storage Buckets (Supabase Storage)

| Bucket | Purpose | Access |
|--------|---------|--------|
| `attendance-selfies` | Employee check-in photos | Private (RLS) |
| `employee-documents` | CVs, contracts, IDs, certificates | Private (RLS) |
