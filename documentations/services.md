# Service Layer Documentation

## Overview

The service layer (`src/lib/services/`) contains 27 modules that encapsulate all database operations and business logic. Services use the **browser-side** Supabase client (subject to RLS) for client-callable operations, while API routes use the **admin client** (bypasses RLS) for privileged operations.

All services follow the `{ data, error }` return pattern from Supabase.

---

## Server Tenant Helpers

### `src/lib/server/tenant-context.ts`

Shared tenant authorization for API routes that use the service-role admin client.

| Function | Description |
|----------|-------------|
| `requireTenantContext(options)` | Authenticates the current user, resolves org/role/employee, blocks suspended or deleted tenants, and optionally checks role, module feature, or employee profile requirements |
| `withTenantContext(handler, options)` | Wraps route handlers with the same tenant guard |

### `src/lib/server/tenant-provisioning.ts`

| Function | Description |
|----------|-------------|
| `provisionOrganizationDefaults(admin, orgId, actorUserId?)` | Creates default tenant settings, features, subscription, usage row, and approval workflows after superadmin organization creation |

---

## Core HR Services

### `employees.ts`
Employee CRUD with relational joins.

| Function | Description |
|----------|-------------|
| `getEmployees(orgId)` | List all employees with department.name, location.name joins |
| `getEmployeeById(id)` | Single employee with all joins |
| `createEmployee(values)` | Insert new employee record |
| `updateEmployee(id, values)` | Update employee fields |
| `deleteEmployee(id)` | Hard delete employee record |

### `departments.ts`
Department management.

| Function | Description |
|----------|-------------|
| `getDepartments(orgId)` | List departments with manager.full_name join |
| `createDepartment(values)` | Insert new department |
| `updateDepartment(id, values)` | Update department |
| `deleteDepartment(id)` | Delete department |

### `locations.ts`
Location and geofence management.

| Function | Description |
|----------|-------------|
| `getLocations(orgId)` | List locations with manager.full_name join |
| `createLocation(values)` | Insert new location (with lat/lng/radius) |
| `updateLocation(id, values)` | Update location |
| `deleteLocation(id)` | Delete location |

### `employee-details.ts`
Employee sub-records (documents, salary, KPIs, reviews, actions).

| Function | Description |
|----------|-------------|
| `getEmployeeDocuments(orgId, employeeId)` | Get all documents for employee |
| `getEmployeeSalaryHistory(orgId, employeeId)` | Get salary change history |
| `getEmployeeKpis(orgId, employeeId)` | Get KPI records |
| `getEmployeeReviews(orgId, employeeId)` | Get performance reviews |
| `getEmployeeActions(orgId, employeeId)` | Get disciplinary/reward actions |
| `uploadEmployeeDocument(orgId, employeeId, docType, file)` | Upload to "employee-documents" bucket + insert record |

---

## Attendance & Schedule Services

### `attendance.ts`
Attendance tracking with GPS and geofence validation.

| Function | Description |
|----------|-------------|
| `getAttendance(orgId, workDate?)` | Get attendance records with employee/shift joins |
| `getEmployeeAttendance(employeeId, workDate?)` | Get records for one employee |
| `createCheckIn(values)` | Create attendance record (check-in with GPS/photo) |
| `updateCheckOut(id, values)` | Update record with check-out data |
| `uploadAttendanceSelfie(orgId, employeeId, workDate, file)` | Upload selfie to storage bucket |

### `schedule.ts`
Shift template and assignment management.

| Function | Description |
|----------|-------------|
| `getShifts(orgId)` | List shift templates with location.name join |
| `createShift(values)` | Create shift template |
| `updateShift(id, values)` | Update shift template |
| `deleteShift(id)` | Delete shift template |
| `getEmployeeShifts(orgId, employeeId?)` | Get shift assignments with joins |
| `assignEmployeeShift(values)` | Assign employee to shift (with date range) |
| `removeEmployeeShift(id)` | Remove shift assignment |

---

## Task Management Services

### `tasks.ts`
Task lifecycle management.

| Function | Description |
|----------|-------------|
| `getTasks(orgId)` | List tasks with assignments, updates, location joins |
| `getTaskById(id)` | Single task with all related data |
| `createTask(values)` | Create new task |
| `updateTask(id, values)` | Update task fields |
| `deleteTask(id)` | Delete task |
| `assignTask(values)` | Assign task to employee |
| `updateTaskAssignment(id, values)` | Update assignment status |
| `createTaskUpdate(values)` | Add progress note (status, progress %, note) |

---

## Leave Management Services

### `leaves.ts`
Leave request workflow and balance management.

| Function | Description |
|----------|-------------|
| `getLeaveRequests(orgId)` | List all requests with employee.full_name join |
| `createLeaveRequest(values)` | Submit new leave request |
| `updateLeaveRequest(id, values)` | Approve/reject (updates status, decision note, decided_by) |
| `getLeaveBalances(orgId, employeeId?)` | Get leave balances (sick, vacation, emergency remaining) |

### `leave-accrual.ts`
Leave balance accrual calculations.

| Function | Description |
|----------|-------------|
| Monthly accrual rate: 1.75 days/month | Based on Saudi labor law |
| Annual calculation from hiring date | Pro-rated for partial years |

---

## Notification Services

### `notifications.ts`
Notification CRUD.

| Function | Description |
|----------|-------------|
| `getNotifications(orgId, userId)` | Get user's notifications (ordered by created_at desc) |
| `markNotificationRead(id, isRead)` | Toggle read status |
| `markAllNotificationsRead(orgId, userId)` | Mark all as read for user |

### `notification-triggers.ts`
Event-driven notification creation.

| Function | Description |
|----------|-------------|
| `notifyAdmins(orgId, title, body, type)` | Create notification for all admins in org |
| `notifyEmployee(orgId, employeeId, title, body, type)` | Create notification for specific employee |
| `notifyHrLateArrival(orgId, employeeName, lateMinutes)` | Notify admins of late arrival |
| `notifyTaskAssigned(orgId, employeeId, taskTitle)` | Notify employee of task assignment |
| `notifyLeaveDecision(orgId, employeeId, leaveType, status)` | Notify employee of leave decision |

---

## Organization & Member Services

### `organizations.ts`
Current-tenant organization settings.

| Function | Description |
|----------|-------------|
| `getCurrentOrganizationSettings()` | Fetch current tenant organization, settings, features, subscription, and usage via `/api/organization/settings` |
| `updateCurrentOrganizationSettings(values)` | Persist current tenant company profile/settings via authenticated API route |
| `getOrganizations()` | Compatibility wrapper returning the current tenant organization only |
| `createOrganization(values)` | Disabled for workspace users; organization creation is handled by superadmin provisioning |
| `updateOrganization(id, values)` | Compatibility wrapper for updating current tenant name/settings |
| `deleteOrganization(id)` | Disabled; organization deletion is superadmin soft-delete only |

### `members.ts`
Organization membership management.

| Function | Description |
|----------|-------------|
| `getOrgMembers(orgId)` | List members with profile.full_name, profile.email joins |
| `addOrgMember(values)` | Add user to organization |
| `updateOrgMemberRole(id, role)` | Change member's role |
| `removeOrgMember(id)` | Remove member from organization |

---

## Recruitment Services

### `recruitment.ts`
Recruitment pipeline and ATS operations.

| Function | Description |
|----------|-------------|
| Job posting CRUD | Create, edit, close, duplicate postings |
| Application management | List, update stage, add notes |
| Interview scheduling | Create, reschedule interviews |
| Hire workflow | Convert application to employee record |
| Form templates | Manage custom application forms |

### `candidate.ts`
Public candidate portal operations.

| Function | Description |
|----------|-------------|
| Posting lookup | Public job posting retrieval |
| Application submission | Submit application with form answers |
| Application tracking | Candidate's application history |
| Status notifications | Application stage update notifications |

---

## Sales Services

### `sales.ts`
Sales module operations.

| Function | Description |
|----------|-------------|
| Dashboard data | Aggregated KPIs and metrics |
| Daily log CRUD | Create/edit sales activity entries |
| Edit requests | Request and approve log corrections |
| Company management | Telecom company registry |
| Product catalog | Product CRUD |
| Team management | Sales rep assignments and targets |
| Reports | Analytics and export data |
| Shift monitoring | Real-time shift status |

---

## Accounting Services

### `accounting.ts`
Core accounting operations.

| Function | Description |
|----------|-------------|
| Chart of accounts CRUD | Account registry management |
| Journal entries | Create, post, reverse journal entries |
| Invoice management | Invoice creation and payment tracking |
| Expense tracking | Expense submission and categorization |
| Payment records | Payment registry |
| Vendor/customer CRUD | AP/AR entity management |
| Cost centers | Cost allocation management |

### `accounting-team.ts`
Finance team management.

| Function | Description |
|----------|-------------|
| Team member CRUD | Add/remove finance team members |
| Role assignment | Assign accounting roles (manager, accountant, viewer) |

---

## Financial Services

### `financial.ts`
Employee financial operations.

| Function | Description |
|----------|-------------|
| Advance requests | Create/manage salary advances |
| Balance tracking | Employee financial balance management |
| File uploads | Signature and document uploads |

### `payroll.ts`
Payroll operations.

| Function | Description |
|----------|-------------|
| Payslip generation | Calculate net salary (base - deductions - absences) |
| Payment tracking | Record salary payments |

---

## Other Services

### `career-events.ts`
Employee career milestone tracking (promotions, transfers, etc.)

### `chat.ts`
Internal messaging operations (conversations, messages, participants)

### `assets.ts`
Company asset tracking (assignment, return, status)

### `personnel.ts`
Personnel records and HR operational data

### `admin-users.ts`
Administrative user provisioning and management

### `superadmin-organizations.ts`
Platform-level organization management (cross-org operations)

### `superadmin-workflows.ts`
Platform administration workflows and approvals

---

## Business Logic Utilities

### `src/lib/accounting/`

| File | Purpose |
|------|---------|
| `permissions.ts` | Accounting role-capability matrix |
| `posting.ts` | GL posting logic (debit/credit validation, period checks) |
| `validation.ts` | Journal entry validation (min 2 lines, balanced) |
| `numbering.ts` | Sequential entry numbering by type/period |
| `reports.ts` | Report generation (balance sheet, P&L, GL, etc.) |

### `src/lib/server/`

| File | Purpose |
|------|---------|
| `leave-balances.ts` | Server-side leave balance calculations |
| `sales-auth.ts` | Sales-specific authorization logic |
| `task-attachments.ts` | File upload handling (validation, path generation) |
| `task-notifications.ts` | Server-side task notification creation |

### `src/lib/` (root)

| File | Purpose |
|------|---------|
| `rbac.ts` | Role definitions, path access rules, role routing |
| `validation.ts` | Zod schemas for form validation |
| `leave-balance-core.ts` | Leave accrual calculations (1.75 days/month) |
| `location-classification.ts` | Location type categorization |
| `hr-options.ts` | HR dropdown constants (cities, banks, education levels) |
