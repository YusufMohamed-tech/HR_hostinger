# Tatwir Talent HRMS â€” Complete Project Context Document

> **Purpose:** Feed this document to any AI assistant so it can immediately understand the entire codebase without scanning files. This eliminates analysis time and token consumption.
>
> **Last Updated:** May 22, 2026 | **Build Status:** âœ… Compiles (exit code 0)

---

## 1. PROJECT IDENTITY

- **Name:** Tatwir Talent HRMS
- **Package name:** `tatwir-hrms`
- **Version:** 0.1.0
- **Purpose:** SaaS HR Management System for deskless workers (retail, logistics, field ops)
- **Target Market:** Saudi Arabia (KSA)
- **Brand Color:** `#5DAE46` (Tatwir Green)
- **Tagline:** "Measure Work. Maximize Performance."
- **Project Root:** `f:\HR system`
- **Repo:** Git-based, 10 commits

## 2. TECH STACK

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.35 |
| Language | TypeScript (strict) | ^5 |
| UI Library | React | ^18.3.1 |
| Styling | Tailwind CSS + tailwindcss-animate | ^3.4.1 |
| Component System | ShadCN/UI (custom) + class-variance-authority | ^0.7.1 |
| Database | Supabase (PostgreSQL) | @supabase/supabase-js ^2.105.1 |
| Auth | Supabase Auth (email/password) | @supabase/ssr ^0.10.2 |
| Icons | lucide-react | ^1.14.0 |
| Date Utils | date-fns | ^4.1.0 |
| Calendar | react-day-picker | ^9.14.0 |
| CSS Merge | tailwind-merge + clsx | latest |
| Font | Inter (Google Fonts, variable `--font-inter`) | â€” |

**No testing libraries, no state management (beyond React context), no form libraries (no react-hook-form/Zod), no data fetching libraries (no SWR/React Query).**

## 3. DIRECTORY STRUCTURE

```
f:\HR system\
â”œâ”€â”€ .env.example              # Template (3 vars needed)
â”œâ”€â”€ .env.local                # âŒ MISSING - must create
â”œâ”€â”€ middleware.ts              # Supabase auth middleware (session refresh + route protection)
â”œâ”€â”€ next.config.mjs            # Empty config
â”œâ”€â”€ tailwind.config.ts         # Custom HSL tokens + brand colors
â”œâ”€â”€ tsconfig.json              # Strict mode, path alias @/* â†’ ./src/*
â”œâ”€â”€ package.json               # Dependencies listed above
â”œâ”€â”€ components.json            # ShadCN config
â”‚
â”œâ”€â”€ db/
â”‚   â”œâ”€â”€ schema.sql                    # Original schema (29KB)
â”‚   â”œâ”€â”€ schema-production.sql         # Production attempt (27KB)
â”‚   â””â”€â”€ schema-production-clean.sql   # âœ… CANONICAL schema (27KB, 620 lines)
â”‚
â”œâ”€â”€ scripts/
â”‚   â”œâ”€â”€ apply-schema.mjs       # Applies schema via pg
â”‚   â”œâ”€â”€ debug-schema.mjs       # Schema debugging utility
â”‚   â””â”€â”€ seed-demo-users.mjs    # Seeds demo users
â”‚
â”œâ”€â”€ docs/                      # 10 markdown docs (architecture, phases, etc.)
â”‚
â”œâ”€â”€ fix.js, fix2.js, fix_schema.js, append_seed.js  # âš ï¸ Dead dev scripts, should delete
â”‚
â””â”€â”€ src/
    â”œâ”€â”€ app/
    â”‚   â”œâ”€â”€ globals.css         # Tailwind + HSL CSS variables (light + dark themes)
    â”‚   â”œâ”€â”€ layout.tsx          # Root: Inter font + RoleProvider wrapper
    â”‚   â”œâ”€â”€ favicon.ico
    â”‚   â”‚
    â”‚   â”œâ”€â”€ login/page.tsx      # Login page (email/password + demo credential buttons)
    â”‚   â”‚
    â”‚   â”œâ”€â”€ auth/callback/route.ts  # Server route: magic link code exchange
    â”‚   â”‚
    â”‚   â””â”€â”€ (app)/              # Route group â€” all protected pages
    â”‚       â”œâ”€â”€ layout.tsx      # AuthGuard + Sidebar + Header + ErrorBoundary
    â”‚       â”œâ”€â”€ page.tsx        # Dashboard (KPI cards, attendance chart, notifications)
    â”‚       â”œâ”€â”€ employees/
    â”‚       â”‚   â”œâ”€â”€ page.tsx    # Employee list (search, filter, CRUD)
    â”‚       â”‚   â””â”€â”€ [id]/page.tsx  # Employee detail (profile, salary, docs, actions)
    â”‚       â”œâ”€â”€ departments/page.tsx   # Department CRUD
    â”‚       â”œâ”€â”€ locations/page.tsx     # Location CRUD with geofence
    â”‚       â”œâ”€â”€ attendance/page.tsx    # GPS check-in/out with selfie + late detection
    â”‚       â”œâ”€â”€ tasks/page.tsx         # Task CRUD + assignment + progress tracking
    â”‚       â”œâ”€â”€ leave/page.tsx         # Leave request + approve/reject workflow
    â”‚       â”œâ”€â”€ schedule/
    â”‚       â”‚   â”œâ”€â”€ page.tsx           # Shift templates + employee assignments
    â”‚       â”‚   â””â”€â”€ builder/page.tsx   # âš ï¸ Placeholder (Phase 2+)
    â”‚       â”œâ”€â”€ notifications/page.tsx  # Notification list + mark read
    â”‚       â””â”€â”€ settings/page.tsx      # Profile edit, company info, logout
    â”‚
    â”œâ”€â”€ components/
    â”‚   â”œâ”€â”€ auth/AuthGuard.tsx          # Client-side auth check â†’ redirect to /login
    â”‚   â”œâ”€â”€ ErrorBoundary.tsx           # React class error boundary
    â”‚   â”œâ”€â”€ PhasePlaceholder.tsx        # "Coming in Phase 2+" placeholder card
    â”‚   â”œâ”€â”€ Skeletons.tsx              # Loading skeleton variants
    â”‚   â”œâ”€â”€ layout/
    â”‚   â”‚   â”œâ”€â”€ Sidebar.tsx            # Fixed left sidebar with role-based nav sections
    â”‚   â”‚   â””â”€â”€ Header.tsx             # Top bar: mobile menu, global search, user dropdown
    â”‚   â”œâ”€â”€ charts/
    â”‚   â”‚   â”œâ”€â”€ MiniLineChart.tsx       # SVG polyline sparkline
    â”‚   â”‚   â””â”€â”€ MiniBarChart.tsx        # SVG bar chart
    â”‚   â”œâ”€â”€ forms/
    â”‚   â”‚   â”œâ”€â”€ AddEmployeeDialog.tsx   # 15+ fields employee creation
    â”‚   â”‚   â”œâ”€â”€ EditEmployeeDialog.tsx  # Pre-filled employee edit
    â”‚   â”‚   â”œâ”€â”€ AddDepartmentDialog.tsx
    â”‚   â”‚   â”œâ”€â”€ EditDepartmentDialog.tsx
    â”‚   â”‚   â”œâ”€â”€ AddLocationDialog.tsx   # With lat/lng/radius
    â”‚   â”‚   â”œâ”€â”€ EditLocationDialog.tsx
    â”‚   â”‚   â””â”€â”€ AddShiftDialog.tsx      # Shift template creation
    â”‚   â””â”€â”€ ui/                         # 14 ShadCN primitive components
    â”‚       â”œâ”€â”€ avatar.tsx, badge.tsx, button.tsx, calendar.tsx
    â”‚       â”œâ”€â”€ card.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx
    â”‚       â”œâ”€â”€ label.tsx, popover.tsx, select.tsx, sheet.tsx
    â”‚       â”œâ”€â”€ table.tsx, tabs.tsx
    â”‚
    â”œâ”€â”€ lib/
    â”‚   â”œâ”€â”€ utils.ts                    # cn() helper (clsx + tailwind-merge)
    â”‚   â”œâ”€â”€ utils/audit.ts             # writeAuditLog() â†’ âš ï¸ writes to non-existent table
    â”‚   â”œâ”€â”€ supabase/
    â”‚   â”‚   â”œâ”€â”€ client.ts              # Browser Supabase client (anon key)
    â”‚   â”‚   â”œâ”€â”€ server.ts              # Server Supabase client (cookie-based)
    â”‚   â”‚   â””â”€â”€ admin.ts               # Service role client (bypasses RLS)
    â”‚   â””â”€â”€ services/                   # 12 service modules (all use browser client)
    â”‚       â”œâ”€â”€ employees.ts            # CRUD + department/location joins
    â”‚       â”œâ”€â”€ departments.ts          # CRUD + manager join
    â”‚       â”œâ”€â”€ locations.ts            # CRUD + manager join
    â”‚       â”œâ”€â”€ attendance.ts           # Check-in/out + selfie upload
    â”‚       â”œâ”€â”€ tasks.ts                # CRUD + assignments + updates
    â”‚       â”œâ”€â”€ leaves.ts               # Requests + balances
    â”‚       â”œâ”€â”€ schedule.ts             # Shifts + employee-shift assignments
    â”‚       â”œâ”€â”€ notifications.ts        # Get + mark read
    â”‚       â”œâ”€â”€ organizations.ts        # CRUD
    â”‚       â”œâ”€â”€ members.ts              # Org member CRUD
    â”‚       â”œâ”€â”€ employee-details.ts     # Documents, salary history, KPIs, reviews, actions
    â”‚       â””â”€â”€ notification-triggers.ts # Auto-create notifications on events
    â”‚
    â”œâ”€â”€ hooks/
    â”‚   â””â”€â”€ use-data.ts                 # useOrgData() generic hook + 10 domain hooks
    â”‚
    â”œâ”€â”€ providers/
    â”‚   â””â”€â”€ RoleProvider.tsx            # Auth context: currentUser, login(), logout(), refresh()
    â”‚
    â”œâ”€â”€ config/
    â”‚   â””â”€â”€ brand.ts                    # Brand colors, fonts, tagline constants
    â”‚
    â”œâ”€â”€ data/
    â”‚   â””â”€â”€ mock.ts                     # âš ï¸ UNUSED mock data (168 lines, dead code)
    â”‚
    â””â”€â”€ types/
        â”œâ”€â”€ index.ts                    # Role, User, ActivityEvent types
        â””â”€â”€ database.ts                 # Full Supabase Database type (771 lines, 20 tables)
```

## 4. ENVIRONMENT VARIABLES

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

âš ï¸ `.env.local` is MISSING. Build succeeds because placeholder strings are hardcoded in client.ts/server.ts.

## 5. AUTHENTICATION FLOW

```
1. User visits any route
2. middleware.ts intercepts â†’ creates server Supabase client â†’ calls getUser()
3. If no user + not on /login or /auth/* â†’ redirect to /login
4. If user + on /login â†’ redirect to /
5. Login page: email/password â†’ supabase.auth.signInWithPassword()
6. RoleProvider.tsx fetches: auth.getUser() â†’ org_members â†’ profiles â†’ employees
7. Builds User object: { id, name, email, role: "Admin"|"Employee", orgId, employeeId }
8. AuthGuard.tsx: client-side guard, shows loading spinner, redirects if no user
```

**Demo credentials (âš ï¸ hardcoded in login page UI):**
- Admin: `hr@tatwir.sa` / `12345678`
- Employee: `employee@tatwir.sa` / `123456789`

## 6. DATABASE SCHEMA

### 6.1 Enums
```sql
org_role: 'admin' | 'employee'
employment_type: 'full_time' | 'part_time' | 'intern' | 'contract'
attendance_status: 'present' | 'late' | 'absent' | 'on_leave' | 'half_day'
task_status: 'pending' | 'in_progress' | 'completed' | 'rejected' | 'delayed'
leave_type: 'sick' | 'vacation' | 'emergency'
leave_status: 'pending' | 'approved' | 'rejected'
shift_type: 'morning' | 'night' | 'flexible'
notification_type: 'attendance' | 'task' | 'leave' | 'system'
document_type: 'cv' | 'contract' | 'national_id' | 'certificate' | 'other'
location_type: 'branch' | 'booth' | 'office' | 'area'
```

### 6.2 Tables (all UUIDs, all have org_id for multi-tenancy)

**organizations** â€” `id, name, slug, status, created_at, updated_at`

**org_members** â€” `id, org_idâ†’organizations, user_idâ†’auth.users, role(org_role), created_at` | UNIQUE(org_id, user_id)

**profiles** â€” `user_id(PK)â†’auth.users, org_idâ†’organizations, full_name, email, phone, title, username, account_status, last_login_at, created_at, updated_at`

**departments** â€” `id, org_idâ†’organizations, name, manager_employee_idâ†’employees, created_at, updated_at`

**locations** â€” `id, org_idâ†’organizations, name, type(location_type), latitude, longitude, radius_meters(default 100), manager_employee_idâ†’employees, created_at, updated_at`

**employees** â€” `id, org_idâ†’organizations, user_idâ†’auth.users, employee_code, full_name, email, phone, address, emergency_contact_name, emergency_contact_phone, national_id, date_of_birth, gender, hiring_date, department_idâ†’departments, job_title, manager_idâ†’employees(self), location_idâ†’locations, employment_type, status(default 'Active'), base_salary, bonus, deductions, payment_method, bank_account, created_at, updated_at` | UNIQUE(org_id, employee_code)

**employee_documents** â€” `id, org_id, employee_idâ†’employees, doc_type(document_type), file_path, file_name, uploaded_byâ†’auth.users, created_at`

**salary_history** â€” `id, org_id, employee_idâ†’employees, base_salary, bonus, deductions, payment_method, bank_account, effective_date, created_at`

**employee_kpis** â€” `id, org_id, employee_idâ†’employees, kpi_name, value, recorded_at`

**employee_reviews** â€” `id, org_id, employee_idâ†’employees, review_month, rating, notes, created_at`

**employee_actions** â€” `id, org_id, employee_idâ†’employees, action_type, reason, points, created_at`

**shifts** â€” `id, org_idâ†’organizations, name, shift_type(shift_type), start_time(time), end_time(time), location_idâ†’locations, created_at, updated_at`

**employee_shifts** â€” `id, org_id, employee_idâ†’employees, shift_idâ†’shifts, start_date, end_date, created_at`

**attendance_records** â€” `id, org_id, employee_idâ†’employees, work_date, shift_idâ†’shifts, check_in_at, check_out_at, check_in_lat, check_in_lng, check_out_lat, check_out_lng, check_in_device, check_out_device, check_in_photo_path, status(attendance_status), total_minutes, late_minutes, within_geofence, distance_meters, created_at, updated_at`

**tasks** â€” `id, org_id, title, description, priority, status(task_status), due_date, location_idâ†’locations, created_byâ†’auth.users, created_at, updated_at`

**task_assignments** â€” `id, org_id, task_idâ†’tasks, employee_idâ†’employees, status(task_status), assigned_at`

**task_updates** â€” `id, org_id, task_idâ†’tasks, employee_idâ†’employees, status, progress(int), note, created_at`

**task_attachments** â€” `id, org_id, task_idâ†’tasks, uploaded_byâ†’auth.users, file_path, file_name, created_at`

**leave_balances** â€” `id, org_id, employee_idâ†’employees, sick_remaining, vacation_remaining, emergency_remaining, updated_at` | UNIQUE(org_id, employee_id)

**leave_requests** â€” `id, org_id, employee_idâ†’employees, leave_type, status(leave_status), start_date, end_date, reason, requested_at, decided_at, decided_byâ†’auth.users, decision_note`

**notifications** â€” `id, org_id, user_idâ†’auth.users, title, body, type(notification_type), link, is_read, created_at`

### 6.3 Helper Functions
```sql
current_org_id()     â†’ returns org_id for current auth user
current_role()       â†’ returns role text for current auth user  
is_admin()           â†’ returns boolean
current_employee_id() â†’ returns employee.id for current auth user
touch_updated_at()   â†’ trigger function for updated_at columns
handle_new_user()    â†’ auto-creates profile on auth.users insert
```

### 6.4 RLS Summary
- All tables have RLS enabled
- org-scoped SELECT: `org_id = current_org_id()`
- org-scoped INSERT/UPDATE/DELETE: `is_admin()` required
- Employees can: read own record, insert/update own attendance, view assigned tasks, create task updates, submit leave requests, see own notifications
- Admins can: full CRUD on everything within their org

### 6.5 âš ï¸ MISSING TABLE
`audit_logs` â€” referenced in `src/lib/utils/audit.ts` but table does NOT exist in schema. All audit writes silently fail.
# Tatwir Talent HRMS â€” Project Context (Part 2: Services, Pages, Bugs, State)

> Continuation of the project handoff. Read Part 1 first for schema, auth, and structure.

---

## 7. SERVICE LAYER API (all in `src/lib/services/`)

All services use the **browser-side** Supabase client (`createClient()` from `@/lib/supabase/client`). All return `{ data, error }` pattern. All use `as never` for inserts (bypasses type safety).

### employees.ts
```
getEmployees(orgId) â†’ employees[] with department.name, location.name joins
getEmployeeById(id) â†’ single employee with joins
createEmployee(values) â†’ insert + select
updateEmployee(id, values) â†’ update + select
deleteEmployee(id) â†’ hard delete (âš ï¸ no soft delete)
```

### departments.ts
```
getDepartments(orgId) â†’ departments[] with manager.full_name join
createDepartment(values) â†’ insert
updateDepartment(id, values) â†’ update
deleteDepartment(id) â†’ delete
```

### locations.ts
```
getLocations(orgId) â†’ locations[] with manager.full_name join
createLocation(values) â†’ insert
updateLocation(id, values) â†’ update
deleteLocation(id) â†’ delete
```

### attendance.ts
```
getAttendance(orgId, workDate?) â†’ records[] with employee.full_name, shift.name joins
getEmployeeAttendance(employeeId, workDate?) â†’ records for one employee
createCheckIn(values) â†’ insert attendance record
updateCheckOut(id, values) â†’ update with check-out data
uploadAttendanceSelfie(orgId, employeeId, workDate, file) â†’ storage upload to "attendance-selfies" bucket
```

### tasks.ts
```
getTasks(orgId) â†’ tasks[] with location, assignments(employee), updates(employee) joins
getTaskById(id) â†’ single task with all joins
createTask(values) â†’ insert
updateTask(id, values) â†’ update
deleteTask(id) â†’ delete
assignTask(values) â†’ insert task_assignments
updateTaskAssignment(id, values) â†’ update assignment status
createTaskUpdate(values) â†’ insert task_updates (progress note)
```

### leaves.ts
```
getLeaveRequests(orgId) â†’ requests[] with employee.full_name join
createLeaveRequest(values) â†’ insert
updateLeaveRequest(id, values) â†’ update (approve/reject)
getLeaveBalances(orgId, employeeId?) â†’ balances[]
```

### schedule.ts
```
getShifts(orgId) â†’ shifts[] with location.name join
createShift(values) â†’ insert
updateShift(id, values) â†’ update
deleteShift(id) â†’ delete
getEmployeeShifts(orgId, employeeId?) â†’ assignments[] with shift+location+employee joins
assignEmployeeShift(values) â†’ insert
removeEmployeeShift(id) â†’ delete
```

### notifications.ts
```
getNotifications(orgId, userId) â†’ notifications[] ordered by created_at desc
markNotificationRead(id, isRead) â†’ update single
markAllNotificationsRead(orgId, userId) â†’ update all for user
```

### organizations.ts
```
getOrganizations() â†’ all orgs (âš ï¸ no org scoping, returns all visible)
createOrganization(values) â†’ insert
updateOrganization(id, values) â†’ update
deleteOrganization(id) â†’ delete
```

### members.ts
```
getOrgMembers(orgId) â†’ members[] with profiles.full_name, profiles.email joins
addOrgMember(values) â†’ insert
updateOrgMemberRole(id, role) â†’ update role field
removeOrgMember(id) â†’ delete
```

### employee-details.ts
```
getEmployeeDocuments(orgId, employeeId) â†’ documents[]
getEmployeeSalaryHistory(orgId, employeeId) â†’ salary_history[]
getEmployeeKpis(orgId, employeeId) â†’ kpis[]
getEmployeeReviews(orgId, employeeId) â†’ reviews[]
getEmployeeActions(orgId, employeeId) â†’ actions[]
uploadEmployeeDocument(orgId, employeeId, docType, file) â†’ upload to "employee-documents" bucket + insert record
```

### notification-triggers.ts
```
notifyAdmins(orgId, title, body, type) â†’ creates notification for all admin users in org
notifyEmployee(orgId, employeeId, title, body, type) â†’ creates notification for specific employee's user_id
notifyHrLateArrival(orgId, employeeName, lateMinutes) â†’ calls notifyAdmins with attendance type
notifyTaskAssigned(orgId, employeeId, taskTitle) â†’ calls notifyEmployee with task type
notifyLeaveDecision(orgId, employeeId, leaveType, status) â†’ calls notifyEmployee with leave type
```

## 8. REACT HOOKS (`src/hooks/use-data.ts`)

Core pattern: `useOrgData<T>(fetcher, initial)` â€” generic hook that:
1. Gets `orgId` from `useRoleContext()`
2. Calls `fetcher(orgId)` on mount and when orgId changes
3. Returns `{ data, loading, error, refetch }`

All data is typed as `Record<string, unknown>[]` (weak typing).

```
useEmployees()         â†’ useOrgData(getEmployees, [])
useDepartments()       â†’ useOrgData(getDepartments, [])
useLocations()         â†’ useOrgData(getLocations, [])
useShifts()            â†’ useOrgData(getShifts, [])
useSchedule()          â†’ alias for useShifts()
useAttendance(date?)   â†’ useOrgData with date filter
useTasks()             â†’ useOrgData(getTasks, [])
useLeaveRequests()     â†’ useOrgData(getLeaveRequests, [])
useLeaveBalances(empId?) â†’ custom hook, filters by employee
useEmployeeShifts(empId?) â†’ custom hook, filters by employee
useNotifications()     â†’ custom hook, needs userId + orgId
useOrganizations()     â†’ custom hook, no org scoping
```

## 9. PAGE-BY-PAGE FUNCTIONALITY

### `/login` â€” Login Page
- Two-column layout (branding left, form right) on desktop; single column mobile
- Email + password fields, show/hide password toggle
- **"Fill HR Login" and "Fill Employee Login" buttons** auto-fill demo credentials (âš ï¸ security risk)
- On success: redirect to `/`
- On error: shows error message inline

### `/` â€” Dashboard
- **Admin view:** 4 stat cards (Employees, Present Today, Active Tasks, Pending Leave) + attendance chart + notifications
- **Employee view:** 4 stat cards (My Tasks, Attendance Status, Next Shift, Alerts) + same widgets
- 7-day attendance trend as MiniLineChart (fetches ALL attendance records to compute)
- Recent notifications (top 3)

### `/employees` â€” Employee List
- Search by name/email/code
- Filter by department dropdown
- Table: name, email, code, status badge, job title, department, location
- Admin: Add Employee dialog (15+ fields), Edit Employee dialog, Delete button
- "View" button links to `/employees/[id]`

### `/employees/[id]` â€” Employee Detail
- 3-column grid: Basic Info, Work Info, Salary Info
- Recent Attendance (last 3 records)
- Documents list, Actions/Warnings list
- **âš ï¸ BUG:** Detail data fetch has broken guard condition â€” documents/KPIs/actions never load (line 40: `employeeId === id` prevents fetch)

### `/departments` â€” Department Management
- Table: name, manager, headcount (computed by filtering employees)
- Admin: Add/Edit/Delete dialogs

### `/locations` â€” Location Management
- Table: name, type, manager, geofence radius badge, coordinates
- Admin: Add/Edit/Delete with latitude/longitude/radius fields

### `/attendance` â€” Attendance Tracking
- **Left panel (all users):** "My Check-in" card
  - Shows current status badge
  - Selfie file upload (required for check-in)
  - "I Arrived" button: gets GPS â†’ checks geofence â†’ calculates late minutes â†’ uploads selfie â†’ creates record â†’ triggers notification if late
  - "I Left" button: gets GPS â†’ calculates total minutes â†’ updates record
- **Right panel:** Today's records table (admin sees all, employee sees own)
  - Columns: employee name, status badge, check-in time, check-out time, late minutes

### `/tasks` â€” Task Management
- Table: title+description, priority, status badge, due date, location, assignees
- Admin: Create Task dialog (title, description, priority, due date, location, assign to employee)
- Employee (assigned): Start (in_progress) and Complete buttons, Add Note dialog
- Task History dialog: chronological updates with status badges
- Auto-notification on task assignment

### `/leave` â€” Leave Requests
- Employee view: Leave balance card (sick/vacation/emergency remaining), "Request Leave" dialog
- Admin view: All requests table with Approve âœ“ / Reject âœ• buttons (with optional note prompt)
- Table: employee, type, date range, day count, status badge, reason
- Auto-notification on approve/reject

### `/schedule` â€” Schedule Management
- Table: employee name, shift name, type, time range, location, date range
- Admin: "Add Shift" dialog (name, type, start/end time, location)
- Admin: "Assign Shift" dialog (employee + shift + date range)
- Remove assignment button

### `/notifications` â€” Notification Center
- List of notifications with type badge, title, body
- "Mark read" button per notification, "Mark all read" global button
- Unread items show green brand color, read items show gray

### `/settings` â€” Settings
- Account Profile card: name, email, role badge, org ID, user ID
- "Edit Profile" dialog: updates profiles + employees tables
- Admin-only cards: Company Profile (âš ï¸ save doesn't persist), Roles & Permissions (display only), Notification preferences (checkboxes, not wired), Security info (2FA marked "Planned")
- Sign Out button

### `/schedule/builder` â€” Shift Builder
- Phase 2+ placeholder only

## 10. COMPONENT PATTERNS

### Dialog Pattern (used by all forms)
```tsx
// Uses @base-ui/react Dialog with render prop pattern:
<DialogTrigger render={<Button />}>Label</DialogTrigger>
// NOT the standard ShadCN asChild pattern
```

### Data Display Pattern
All data from Supabase is typed as `Record<string, unknown>` and manually extracted:
```tsx
const empRecord = emp as Record<string, unknown>;
const empName = typeof empRecord.full_name === "string" ? empRecord.full_name : "â€”";
```
This pattern repeats across ALL pages. It's verbose but type-safe at runtime.

### Role-Based UI Pattern
```tsx
const { currentUser } = useRoleContext();
const isAdmin = currentUser?.role === "Admin";
// Admin-only elements wrapped in: {isAdmin && <Component />}
```

## 11. KNOWN BUGS & ISSUES

| # | Severity | File | Line | Description |
|---|---|---|---|---|
| 1 | ðŸ”´ Critical | `login/page.tsx` | 146-169 | Demo credentials exposed in production UI |
| 2 | ðŸ”´ Critical | `lib/utils/audit.ts` | 25 | Writes to non-existent `audit_logs` table |
| 3 | ðŸ”´ Critical | `append_seed.js` | 50 | References `first_name`/`last_name` columns that don't exist |
| 4 | ðŸ”´ Critical | `employees/[id]/page.tsx` | 40 | Fetch guard `employeeId === id` prevents detail data from loading |
| 5 | ðŸ”´ Critical | Project root | â€” | `.env.local` missing; app runs on placeholder Supabase URLs |
| 6 | ðŸŸ¡ High | `settings/page.tsx` | 196-199 | Company Profile save shows "Saved!" but never calls Supabase |
| 7 | ðŸŸ¡ High | `notification-triggers.ts` | all | Uses browser client; RLS blocks employee notification inserts |
| 8 | ðŸŸ¡ High | All services | all | `as never` casting bypasses TypeScript on all DB operations |
| 9 | ðŸŸ¡ High | All pages | â€” | Zero input validation on any form |
| 10 | ðŸŸ¡ Medium | `hooks/use-data.ts` | 51 | `initial` array in deps creates new reference each render |
| 11 | ðŸŸ¡ Medium | All CRUD pages | â€” | Delete operations have no error feedback |
| 12 | ðŸŸ¡ Medium | `leave/page.tsx` | â€” | Leave balance not decremented on approval |
| 13 | ðŸŸ¡ Medium | `attendance/page.tsx` | â€” | No duplicate check-in prevention per day |
| 14 | ðŸŸ¢ Low | `data/mock.ts` | all | 168 lines of unused mock data |
| 15 | ðŸŸ¢ Low | `globals.css` | 51-83 | Dark mode theme loses brand colors entirely |
| 16 | ðŸŸ¢ Low | Project root | â€” | 4 dead fix scripts should be deleted |

## 12. WHAT'S NOT IMPLEMENTED

**Missing Features:** User registration, password reset, payroll module, reports/exports, audit log viewer, file download/preview, org chart, contracts module, AI insights, LMS/training, calendar view, bulk import/export, email/SMS notifications, i18n (Arabic), real-time updates.

**Missing Infrastructure:** Testing (zero tests), CI/CD, API routes for business logic, rate limiting, CSP headers, error tracking (Sentry), performance monitoring, database migrations tool, pagination on all queries, data caching, storage bucket creation verification.

## 13. CURRENT STATE SUMMARY

The project is a **functional Phase 1 prototype**. The frontend is well-structured with consistent patterns, the database schema is comprehensive, and RLS is properly configured. However, it is **not production-ready** due to: exposed demo credentials, zero validation, zero tests, no error handling on mutations, missing audit table, and several critical UI bugs. The codebase needs a security hardening pass, input validation layer (Zod), proper error feedback, pagination, and the missing modules before serving real users.

**Build output:** 15 routes, 87KB shared JS, 169-238KB per page first load. All pages compile and generate successfully.
