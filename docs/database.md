# Database Design (Supabase PostgreSQL)

## Core Tables
- organizations (id, name, plan, created_at)
- org_members (id, org_id, user_id, role)
- profiles (id, org_id, full_name, role, department_id)
- employees (id, org_id, profile_id, status, location_id)
- departments (id, org_id, name, head_id)
- locations (id, org_id, name, city, geofence)
- contracts (id, org_id, employee_id, start_date, end_date, salary)
- hierarchy (id, org_id, manager_id, report_id)

## Scheduling
- shifts (id, org_id, location_id, start_time, end_time)
- shift_assignments (id, org_id, shift_id, employee_id)
- availability (id, org_id, employee_id, rules)
- shift_conflicts (id, org_id, shift_id, conflict_type)

## Events
- events (id, org_id, user_id, event_type, payload_json, created_at)

## KPI and Payroll
- kpi_definitions, kpi_targets, kpi_results
- payroll_cycles, payroll_items, earnings, deductions, kpi_payouts

## LMS
- courses, modules, enrollments, milestones

## Audit
- audit_logs (id, org_id, actor_id, action, entity, old_values, new_values, created_at)

## RLS Policy Principles
- All tables include org_id
- SELECT, INSERT, UPDATE, DELETE scoped by org_id
- Super Admin has global access
