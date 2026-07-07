# Database Structure

## Overview

Tatwir Talent HRMS uses **Supabase (PostgreSQL)** as its database, with Row Level Security (RLS) enforcing multi-tenant data isolation. The schema consists of 50+ tables across multiple modules, managed through versioned SQL migrations.

## Schema Files

| File | Purpose |
|------|---------|
| `db/schema-production-clean.sql` | Canonical base schema (v1) |
| `db/schema_v2_additions.sql` through `db/schema_v40_accounting_audit_fixes.sql` | Incremental migrations |
| `db/schema_v41_multi_tenancy_audit_fixes.sql` | Tenant isolation hardening for employee locations, profiles, chat RLS, audit logs, and task/chat storage |
| `db/schema_v42_tenant_platform_completion.sql` | Tenant settings, feature flags, plans, subscriptions, usage, workflows, soft delete, quotas, private balance/recruitment storage, and composite indexes |
| `db/schema_v43_lms_module.sql` | Professional multi-tenant LMS module, feature flag, private LMS storage, RLS policies, LMS notifications, and verification support |
| `db/schema_v47_field_agents.sql` | Field-agent SIM distribution foundation, SIM inventory, transfers, cash collections, requests, and agent commissions |
| `db/schema_v48_merchants.sql` | Trader/merchant tier, merchant accounts, merchant SIM ownership, merchant requests, collections, and commissions |
| `db/schema_v49_onground_agent_manager.sql` | Dedicated on-ground agent manager role and field-agent management authority |
| `db/schema_v50_sim_packages_trader_payments.sql` | SIM package catalog, package-based sales ledger, trader onboarding details, payment proof buckets, and payment confirmation statuses |
| `db/schema_v51_trader_sale_activation_details.sql` | Trader sale activation/customer details stored on `sim_sales` |
| `db/schema_v52_sim_box_ocr_import.sql` | SIM box OCR import batches, generated kit codes, private image storage, and stock import metadata |

## LMS v43 Additive Migration

Migration file: `db/schema_v43_lms_module.sql`

The LMS migration is additive and introduces a private, multi-tenant learning schema. It adds `organization_features.lms_enabled`, appends `"lms"` to `organization_features.enabled_modules`, adds notification enum value `lms`, creates private Supabase Storage bucket `lms-content`, and creates all LMS tables with `org_id`, timestamps, indexes, constraints, and RLS.

### LMS Tables
`lms_categories`, `lms_courses`, `lms_course_instructors`, `lms_course_sections`, `lms_lessons`, `lms_lesson_attachments`, `lms_quizzes`, `lms_quiz_questions`, `lms_enrollments`, `lms_lesson_progress`, `lms_quiz_attempts`, `lms_tasks`, `lms_task_submissions`, `lms_task_reviews`, `lms_learning_paths`, `lms_learning_path_courses`, `lms_assignment_rules`, `lms_certificates`, `lms_course_feedback`, `lms_course_announcements`, `lms_community_posts`, `lms_community_comments`, `lms_community_reactions`, `lms_community_post_reads`.

### LMS Security
Every LMS table has RLS enabled. Policies enforce tenant isolation through `org_id`, allow Admin/HR_Admin management, apply scoped Training_Manager checks, and allow assigned instructors through `lms_course_instructors` permission columns. Learners can only access assigned/published course content and mutate their own progress, attempts, submissions, feedback, and community records.

### LMS Storage
Bucket `lms-content` is private. Object policies are service-role only so browser clients cannot bypass LMS access checks. The server generates signed URLs only after validating tenant, role, and learner/instructor/course access.

Required LMS object paths are org-prefixed:
- `orgs/{org_id}/lms/courses/{course_id}/lessons/{lesson_id}/{filename}`
- `orgs/{org_id}/lms/courses/{course_id}/tasks/{task_id}/{filename}`
- `orgs/{org_id}/lms/courses/{course_id}/submissions/{submission_id}/{filename}`
- `orgs/{org_id}/lms/courses/{course_id}/community/{post_id}/{filename}`

Run `npm run verify:lms` after applying the migration to check required tables, RLS, feature flag column, notification enum value, private storage bucket, policies, and indexes.

## On-Ground Agent and Trader SIM Chain v47-v52

Migration files: `db/schema_v47_field_agents.sql`, `db/schema_v48_merchants.sql`, `db/schema_v49_onground_agent_manager.sql`, `db/schema_v50_sim_packages_trader_payments.sql`, `db/schema_v51_trader_sale_activation_details.sql`, `db/schema_v52_sim_box_ocr_import.sql`

These migrations implement a multi-tier SIM distribution chain:

```text
stock -> field_agent -> merchant/trader -> customer
```

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `field_agents` | On-ground agent profiles linked to auth users | organization_id, user_id, full_name, phone, national_id, region, sim_price, commission_rate, max_sim_capacity, status |
| `sim_units` | SIM inventory and current ownership | iccid, kit_code, provider, sim_type, price, status, current_agent_id, current_merchant_id, import_batch_id, dealer_box_number, box_sequence, import_source, sold_by_agent_id, sold_by_merchant_id, sold_package_id |
| `sim_import_batches` | Reviewed SIM box OCR import batches | provider, order_number, batch_number, barcode_text, first_kitcode, last_kitcode, quantity, step, image_path, extracted_json, generated_preview, imported_count, duplicate_count, assigned_agent_id |
| `sim_transfers` | Append-only SIM movement audit | sim_unit_id, transfer_type, from_agent_id, to_agent_id, from_merchant_id, to_merchant_id, performed_by |
| `agent_cash_collections` | Cash collected from agents by the organization | agent_id, amount, payment_method, collected_by, collection_date |
| `agent_sim_requests` | Field-agent SIM reorder requests | agent_id, quantity, sim_type, status, reviewed_by, reviewed_at |
| `agent_commissions` | Agent commission ledger | agent_id, sim_unit_id, sim_package_id, sale_price, commission_type, commission_amount, is_paid |
| `merchants` | Trader/small-business accounts owned by agents | agent_id, user_id, business_name, owner_name, phone, city, region, latitude, longitude, place_photo_url, status |
| `merchant_sim_requests` | Trader reorder requests to the owning agent | merchant_id, agent_id, quantity, sim_type, status, reviewed_by |
| `merchant_cash_collections` | Trader payments to agents | merchant_id, agent_id, amount, payment_method, status, payment_proof_url, confirmed_by, rejected_by |
| `merchant_commissions` | Trader commission ledger | merchant_id, agent_id, sim_unit_id, sim_package_id, commission_type, commission_amount, is_paid |
| `sim_packages` | Package/baqa catalog | provider, package_name, allowances, base_price, sale_price, tax_included, agent_commission_type/value, merchant_commission_type/value, status |
| `sim_sales` | Package-based sale ledger for agent and trader sales | sim_unit_id, package_id, seller_type, agent_id, merchant_id, sale_price, customer fields, commission snapshots, sold_at |

### Trader Sale Activation Details

Migration v51 adds activation/customer fields to `sim_sales`. The merchant selling UI requires these before completing a trader sale:

| Column | Meaning |
|--------|---------|
| `customer_national_id` | Customer national/resident identity number |
| `customer_absher_mobile` | Customer Absher-linked mobile number |
| `customer_birth_date_hijri` | Customer Hijri birth date as entered |
| `customer_id_expiry_hijri` | Customer ID expiry date in Hijri format |
| `customer_email` | Customer email address |
| `customer_nationality` | Customer nationality |
| `package_reference` | Package reference shown/entered at activation time |
| `device_serial` | Device serial captured during activation |
| `city_district` | Customer city/district |
| `marketer_name` | Optional marketer name |
| `national_address` | Customer national address |
| `supervisor_name` | Supervisor name captured for the sale |

Indexes `idx_sim_sales_customer_national_id` and `idx_sim_sales_device_serial` support manager-side lookup by identity number and device serial within an organization.

### SIM Box OCR Import

Migration v52 adds a manager-only import workflow for physical SIM dealer boxes. A manager uploads an image into private bucket `sim-box-imports`, reviews the extracted label fields, and confirms the import. The server regenerates kit codes from `first_kitcode`, `last_kitcode`, and `quantity`; it does not trust a client-submitted generated list.

Confirmed imports create a `sim_import_batches` audit row and insert generated SIMs into `sim_units`. OCR imports set both `kit_code` and legacy `iccid` to the generated kit code for compatibility with the existing `sim_units` unique ICCID constraint. `import_source = 'box_ocr'`, `import_batch_id`, `dealer_box_number`, and `box_sequence` preserve box provenance. Direct assignment to an active field agent is optional; otherwise SIMs remain `in_stock`.

Duplicate protection checks `(organization_id, provider, kit_code)` and legacy `(organization_id, iccid)`. The default strategy blocks the import; the optional skip strategy records duplicate counts on the batch and inserts only non-duplicates.

### Access and RLS

- `can_manage_field_agents()` authorizes Admin, Sales_Manager, and Onground_Agent_Manager for stock and network management.
- `current_field_agent_id()` and `current_merchant_id()` resolve the auth user's scoped agent/trader profile.
- Managers can see and manage the chain for the organization.
- Field agents can see their own SIMs, merchants, requests, commissions, and collections.
- Field agents can read only SIM import batches assigned directly to them; only managers can create or confirm OCR imports.
- Merchants can see their own SIMs, requests, payments, commissions, and submitted sale records.
- `sim_sales` is org-scoped and readable by managers, owning agents, and the selling merchant. The manager-only API exposes enriched trader sale activation records.

## Tenant Platform Tables

Migration v42 adds these tenant platform tables:

| Table | Purpose |
|---|---|
| `organization_settings` | Per-tenant branding, locale, timezone, attendance, leave, workflow, and shift defaults |
| `organization_features` | Per-tenant module flags and enabled module list |
| `plans` | Sellable plan definitions, features, limits, and prices |
| `organization_subscriptions` | Tenant subscription state and provider identifiers |
| `organization_usage` | Tenant usage snapshot for employee count, storage, API usage, sales agents, and accounting entries |
| `organization_quota_events` | Quota observations, warnings, and blocks |
| `approval_workflows` | Configurable per-tenant workflow steps |

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
                   'training_manager' | 'sales' | 'sales_manager' | 'onground_agent_manager' |
                   'promoter' | 'field_agent' | 'merchant' | 'finance_manager' |
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
sim_status:        'in_stock' | 'with_agent' | 'with_merchant' | 'sold' | 'returned'
sim_transfer_type: 'initial_import' | 'assign_to_agent' | 'return_to_stock' |
                   'assign_to_merchant' | 'return_from_merchant' | 'sold'
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
| `field_agents` | On-ground SIM agents | id, organization_id, user_id, full_name, phone, national_id, sim_price, commission_rate, status |
| `sim_units` | SIM stock, ownership, import provenance, and sale status | id, organization_id, iccid, kit_code, provider, sim_type, status, current_agent_id, current_merchant_id, import_batch_id, sold_package_id |
| `sim_import_batches` | SIM box OCR import audit rows | id, organization_id, provider, order_number, batch_number, first_kitcode, last_kitcode, quantity, image_path, generated_preview, imported_count |
| `sim_transfers` | SIM movement audit | id, organization_id, sim_unit_id, transfer_type, from/to agent/merchant ids |
| `agent_sim_requests` | Agent stock requests | id, organization_id, agent_id, quantity, status |
| `agent_cash_collections` | Agent payment collection records | id, organization_id, agent_id, amount, payment_method, collection_date |
| `agent_commissions` | Agent commission records | id, organization_id, agent_id, sim_unit_id, sim_package_id, commission_amount, is_paid |
| `merchants` | Trader/small-business accounts | id, organization_id, agent_id, user_id, business_name, phone, city, region, place_photo_url, status |
| `merchant_sim_requests` | Trader stock requests | id, organization_id, merchant_id, agent_id, quantity, status |
| `merchant_cash_collections` | Trader payment records and proofs | id, organization_id, merchant_id, agent_id, amount, payment_method, status, payment_proof_url |
| `merchant_commissions` | Trader commission records | id, organization_id, merchant_id, agent_id, sim_unit_id, sim_package_id, commission_amount, is_paid |
| `sim_packages` | SIM package catalog and commission rules | id, organization_id, provider, package_name, base_price, sale_price, agent/merchant commission fields |
| `sim_sales` | Package-based SIM sales ledger | id, organization_id, sim_unit_id, package_id, seller_type, agent_id, merchant_id, customer activation fields, commission snapshots |

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

# Supabase Management API path when direct DB networking is unavailable
npm run apply:supabase-sql -- db/schema_v42_tenant_platform_completion.sql

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
| v41-v42 | Multi-tenancy hardening and tenant platform completion |
| v43-v44 | LMS module and classroom experience |
| v45 | Auto-flow fixes |
| v46 | Promoter kiosk, telecom offers, campaigns, and leads |
| v47 | Field-agent SIM distribution foundation |
| v48 | Trader/merchant tier and merchant SIM workflows |
| v49 | On-ground agent manager role |
| v50 | SIM packages, package-based sales ledger, trader onboarding details, and payment proof flow |
| v51 | Trader sale activation/customer details on `sim_sales` |
| v52 | SIM box OCR import batches, kit-code generation, private box-image storage, and import provenance |

## Storage Buckets (Supabase Storage)

| Bucket | Purpose | Access |
|--------|---------|--------|
| `attendance-selfies` | Employee check-in photos | Private (RLS) |
| `employee-documents` | CVs, contracts, IDs, certificates | Private (RLS) |
| `lms-content` | LMS lesson/task/submission/community files | Private; signed URLs only |
| `merchant-place-photos` | Trader storefront/place photos | Public URL stored on `merchants.place_photo_url` |
| `merchant-payment-proofs` | Trader payment proof images/PDFs | Public URL stored on `merchant_cash_collections.payment_proof_url` |
| `sim-box-imports` | SIM dealer box images used for OCR import review | Private; API stores only the object path on `sim_import_batches.image_path` |
