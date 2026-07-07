# Feature Modules

## Overview

Tatwir Talent HRMS is organized into distinct feature modules, each with its own pages, API routes, and service layer. Modules are accessed based on user roles.

---

## LMS Module v43

**Paths:** `/lms`, `/lms/my`, `/lms/catalog`, `/lms/player/[enrollmentId]`, `/lms/community`, `/lms/certificates`, `/lms/courses`, `/lms/courses/new`, `/lms/courses/[courseId]/edit`, `/lms/courses/[courseId]/instructors`, `/lms/courses/[courseId]/tasks`, `/lms/courses/[courseId]/submissions`, `/lms/courses/[courseId]/community`, `/lms/assignments`, `/lms/reports`

**Feature flag:** `organization_features.lms_enabled` plus `"lms"` in `organization_features.enabled_modules`

**Access model:**
- Learner pages are available to authenticated workspace roles when LMS is enabled.
- Admin and HR_Admin can manage LMS resources across their organization.
- Training_Manager can manage and report within the existing scoped employee model.
- Course instructors are assigned per course in `lms_course_instructors`; no new global role is added.

**Features:**
- Categories, courses, sections, and lessons.
- Text, video, document/file, and external link lesson types.
- Quizzes with max attempts, score calculation, pass/fail, and sanitized learner responses.
- Course tasks, learner submissions, instructor review, score, feedback, and revision states.
- Course announcements and course community posts/comments/reactions/read tracking.
- Assignments to employees or scoped groups.
- Learner progress, completion workflow, certificate records, and printable certificate UI.
- Reports for completion, quiz, task, certificate, feedback, and community activity.

**Out of scope in v1:** SCORM, xAPI, video transcoding, public registration, paid courses, external instructors, PDF certificate generation, live sessions, and AI recommendations.

---

## 1. Dashboard

**Path:** `/`  
**Access:** Admin, HR_Admin, Employee, Training_Manager  
**Purpose:** Role-based KPI overview and quick actions

### Admin View
- Total employees count
- Present today count
- Active tasks count
- Pending leave requests count
- 7-day attendance trend chart
- Recent notifications (top 3)

### Employee View
- My assigned tasks
- Attendance status today
- Next shift information
- Alert count
- Same chart and notification widgets

---

## 2. Employee Management

**Path:** `/employees`, `/employees/[id]`  
**Access:** Admin, HR_Admin, Training_Manager  
**Service:** `src/lib/services/employees.ts`, `src/lib/services/employee-details.ts`

### Features
- Employee listing with search (by name/email/code) and department filter
- Add employee dialog (15+ fields: name, email, phone, national ID, department, location, job title, manager, employment type, salary, etc.)
- Edit employee dialog (pre-filled)
- Delete employee (hard delete)
- Employee detail page with:
  - Basic info, work info, salary info cards
  - Recent attendance records
  - Documents (upload CV, contracts, IDs)
  - Salary history audit trail
  - KPI metrics
  - Performance reviews
  - Disciplinary/reward actions

### Business Rules
- Employee codes are unique within organization
- Manager is a self-referencing relationship (employee → employee)
- Employees are linked to departments and locations
- User account can be optionally linked via `user_id`

---

## 3. Department Management

**Path:** `/departments`  
**Access:** Admin, HR_Admin  
**Service:** `src/lib/services/departments.ts`

### Features
- Department table (name, manager, headcount)
- Add/Edit/Delete departments
- Assign department manager (from employee list)
- Computed headcount (number of employees in department)

---

## 4. Location Management

**Path:** `/locations`  
**Access:** Admin, HR_Admin  
**Service:** `src/lib/services/locations.ts`

### Features
- Location table (name, type, manager, geofence radius, coordinates)
- Types: branch, booth, office, area
- Geofence configuration (latitude, longitude, radius in meters)
- Leaflet map picker for coordinate selection
- Location manager assignment

### Business Rules
- Default geofence radius: 100 meters
- Used for attendance geofence validation
- Employees are assigned to locations for shift/attendance tracking

---

## 5. Attendance Tracking

**Path:** `/attendance`  
**Access:** All except HR_Recruitment  
**Service:** `src/lib/services/attendance.ts`

### Features
- **Check-in card:** GPS capture + selfie upload + "I Arrived" button
- **Check-out card:** GPS capture + "I Left" button
- Today's attendance table (admin sees all, employee sees own)
- Status badges: present, late, absent, on_leave, half_day

### Check-in Workflow
1. Employee opens attendance page
2. Selfie file upload (required)
3. Clicks "I Arrived"
4. Browser captures GPS coordinates
5. System calculates distance from assigned location
6. Determines if within geofence
7. Calculates late minutes (based on shift start time)
8. Uploads selfie to `attendance-selfies` bucket
9. Creates attendance record
10. If late → triggers HR notification

### Check-out Workflow
1. Employee clicks "I Left"
2. Browser captures GPS coordinates
3. Calculates total working minutes
4. Updates the attendance record

---

## 6. Schedule / Shift Management

**Path:** `/schedule`  
**Access:** Admin, HR_Admin  
**Service:** `src/lib/services/schedule.ts`

### Features
- Shift template creation (name, type, start/end time, location)
- Shift types: morning, night, flexible
- Employee-shift assignment (employee + shift + date range)
- Assignment table: employee, shift name, type, time range, location, dates
- Remove assignment

---

## 7. Task Management

**Path:** `/tasks`, `/tasks/mine`  
**Access:** All authenticated users  
**Service:** `src/lib/services/tasks.ts`

### Features
- Task creation (title, description, priority, due date, assignees)
- Task assignment to one or more employees
- Status workflow: pending → in_progress → completed/rejected/delayed
- Progress notes with percentage
- Task attachments (file uploads)
- Task history/timeline dialog
- "My Tasks" view for employees

### Business Rules
- Admin creates tasks and assigns to employees
- Employees can start (in_progress) and complete assigned tasks
- Auto-notification on task assignment
- Priority levels affect display ordering

---

## 8. Leave Management

**Path:** `/leave`, `/balances`  
**Access:** All authenticated users  
**Service:** `src/lib/services/leaves.ts`, `src/lib/leave-balance-core.ts`

### Features
- **Employee view:**
  - Leave balance card (sick, vacation, emergency remaining days)
  - "Request Leave" dialog (type, date range, reason)
- **Admin view:**
  - All requests table
  - Approve/Reject buttons with optional decision note
  - Request details: employee, type, dates, day count, reason

### Business Rules
- Leave types: sick, vacation, emergency
- Status workflow: pending → approved/rejected
- Balance tracking per employee per type
- Auto-notification on approval/rejection
- Multi-level approval support (manager + HR)

---

## 9. Recruitment / ATS

**Path:** `/recruitment`, `/recruitment/new`, `/recruitment/[postingId]`  
**Access:** Admin, HR_Recruitment  
**Service:** `src/lib/services/recruitment.ts`, `src/lib/services/candidate.ts`

### Features
- Job posting creation with custom form builder
- Job posting listing (active, draft, closed)
- Kanban ATS board with pipeline stages
- Application detail panel (candidate info, notes, attachments)
- Interview scheduling
- Stage transitions (Applied → Reviewed → Interviewed → Offered → Hired/Rejected)
- Hire workflow: converts candidate to employee record
- Posting duplication

### Candidate Portal (Public)
- **Path:** `/apply/[postingId]`, `/candidate/login`, `/candidate/applications`
- Public job posting view (no auth)
- Application submission
- Candidate registration/login
- Application status tracking

---

## 10. Sales Module

**Path:** `/sales/dashboard`, `/sales/log`, `/sales/history`, `/sales/team`, `/sales/products`, `/sales/reports`  
**Access:** Sales, Sales_Manager, Admin, HR_Admin  
**Service:** `src/lib/services/sales.ts`

### Features
- **Dashboard:** Sales KPIs, performance charts, target tracking
- **Daily Log:** Activity logging (date, company, products, quantity, amount)
- **History:** Transaction history with search/filter
- **Team Management:** Sales rep profiles, assignments, targets
- **Products:** Product catalog management
- **Reports:** Sales analytics and export
- **Shift Monitor:** Real-time shift status for sales team
- **Edit Requests:** Sales reps can request edits to submitted logs (manager approval)

### Business Rules
- Sales entries are tied to telecom companies
- Shift-level targets for performance tracking
- Edit requests require Sales_Manager approval
- Dashboard is configurable per org

---

## 10a. On-Ground Agent / Trader SIM Distribution

**Manager paths:** `/sales/agents`, `/sales/stock`, `/sales/traders`, `/sales/trader-sales`

**Agent kiosk paths:** `/agent`, `/agent/sims`, `/agent/sell`, `/agent/merchants`, `/agent/requests`, `/agent/balance`, `/agent/commissions`

**Trader kiosk paths:** `/merchant`, `/merchant/sims`, `/merchant/sell`, `/merchant/requests`, `/merchant/balance`

**Access:** Admin, Sales_Manager, Onground_Agent_Manager, Field_Agent, Merchant

**Service:** `src/lib/services/field-agents.ts`, `src/lib/services/merchants.ts`

### Features
- Manager imports SIM stock, assigns SIMs to field agents, reviews agent requests, tracks transfers, and records organization cash collection from agents.
- Manager can import a physical SIM dealer box from an image: OCR extracts label fields, the manager reviews/edit fields, the server generates kit codes, duplicate checks run, and confirmed SIMs enter stock or are directly assigned to one active field agent.
- Manager creates and maintains package catalog entries with sale price, tax flag, and editable commission rules.
- Field agents receive SIMs, sell directly to customers, create trader accounts, assign SIMs to traders, review trader stock requests, collect or confirm trader payments, and track commissions.
- Traders view their stock, select an active package, complete required activation/customer fields, record SIM sales, request more SIMs, and submit payments with optional proof files.
- Manager-facing trader sales page lists merchant sales with customer activation details, package/SIM context, agent/trader names, and commission totals.

### Trader Sale Activation Fields
Before a trader sale is completed, the merchant UI requires customer name, national ID, Absher mobile, Hijri birth date, Hijri ID expiry, email, nationality, package reference, device serial, city/district, national address, and supervisor name. Marketer name is optional. These values are stored in `sim_sales` by migration v51.

### SIM Box OCR Import
The v52 SIM box import workflow is manager-only and belongs to stock intake, not sales. The frontend reads the uploaded box image locally with Tesseract.js and tries barcode detection with ZXing. `POST /api/sales/agents/sims/box-preview` receives the extracted/editable fields, stores the private image path, recalculates kit codes, checks duplicates, and returns a reviewable preview. `POST /api/sales/agents/sims/box-import` recalculates the kit-code range again before inserting `sim_units` and `sim_import_batches`.

Kit-code generation preserves leading zeros, supports quantity `1` only when first and last kit code match, and requires `(last - first)` to divide evenly by `quantity - 1`. Duplicate strategy defaults to fail, with an optional skip mode for already-imported kit codes.

### Business Rules
- SIM ownership follows `in_stock -> with_agent -> with_merchant -> sold`.
- Package provider must match the SIM provider before a sale is accepted.
- OCR imports set `kit_code` and legacy `iccid` to the generated kit code; the import never creates a sale or merchant/trader assignment.
- Sale price and commission amounts are calculated from the selected `sim_packages` row and snapshotted onto `sim_sales`, `agent_commissions`, and `merchant_commissions`.
- Default package commission is 15 SAR total. Trader sales split it as 5 SAR to the field-agent chain and 10 SAR to the trader. Direct field-agent activations pay the full 15 SAR to the field agent and create no trader commission.
- Package commission rules are editable per package. Old sales and old commission records keep their sale-time snapshots when package rules change later.
- A suspended field agent or trader cannot receive or sell SIMs.
- Trader payment submissions are `pending` when submitted by the trader and only reduce balances after confirmation. Cash can be confirmed by the owning agent/manager; electronic methods require manager confirmation.
- `/sales/trader-sales` is manager-only because it exposes customer activation details.

---

## 11. Accounting / Finance Module

**Path:** `/accounting/*`  
**Access:** Finance_Manager, Accountant, Finance_Viewer  
**Service:** `src/lib/services/accounting.ts`, `src/lib/accounting/*`

### Features
- **Chart of Accounts:** GL account registry (assets, liabilities, equity, revenue, expenses)
- **Journal Entries:** Creation, posting, approval workflow (draft → pending → posted)
- **Invoices:** Invoice generation, line items, payment tracking
- **Expenses:** Expense submission, categorization, approval
- **Payments:** Payment registry and reconciliation
- **Sales Commissions:** Payable/paid commission ledger for SIM package sales, split by field-agent and trader beneficiaries
- **Customers/Vendors:** CRM data for AR/AP
- **Cost Centers:** Cost allocation by department/location/project
- **Team Management:** Finance team role assignments (Finance_Manager only)
- **Settings:** Accounting configuration (Finance_Manager only)

### Reports
- Balance Sheet
- Profit & Loss
- General Ledger
- Trial Balance
- Accounts Receivable Aging
- Accounts Payable Aging
- VAT Report
- Employee Advances
- Payroll Cost Analysis

### Role Restrictions
| Capability | Finance_Manager | Accountant | Finance_Viewer |
|-----------|----------------|------------|----------------|
| View records | Yes | Yes | Yes |
| Create/edit | Yes | Yes | No |
| Post journals | Yes | No | No |
| Settle sales commissions | Yes | Yes | No |
| Manage settings | Yes | No | No |
| Manage team | Yes | No | No |

---

## 12. Payroll

**Path:** `/payroll`  
**Access:** Admin, HR_Admin  
**Service:** `src/lib/services/payroll.ts`

### Features
- Payroll overview dashboard
- Employee salary components (base, bonus, deductions)
- Payment method tracking (bank transfer, cash)
- Advance request management

---

## 13. Personnel / HR Operations

**Path:** `/personnel`  
**Access:** Admin, HR_Admin  
**Service:** `src/lib/services/personnel.ts`

### Features
- HR operational views
- Employee status management
- Career event tracking (promotions, transfers)

---

## 14. Chat / Messaging

**Path:** `/chat`  
**Access:** All authenticated users  
**Service:** `src/lib/services/chat.ts`

### Features
- Internal messaging system
- Chat rooms/channels
- Message history

---

## 15. Assets

**Path:** `/assets`  
**Access:** Admin, HR_Admin, Employee  
**Service:** `src/lib/services/assets.ts`

### Features
- Company asset registry
- Asset assignment to employees
- Status tracking (assigned, returned)

---

## 16. Notifications

**Path:** `/notifications`  
**Access:** All authenticated users  
**Service:** `src/lib/services/notifications.ts`, `src/lib/services/notification-triggers.ts`

### Features
- Notification list with type badges (attendance, task, leave, system, sales, accounting)
- Mark individual notifications as read
- "Mark all read" global action
- Unread count in header

### Trigger Events
- Late arrival detected → notify HR admins
- Task assigned → notify assigned employee
- Leave request decided → notify requesting employee
- Sales log edit approved/rejected → notify sales rep

---

## 17. Superadmin Platform

**Path:** `/superadmin/*`  
**Access:** Superadmin only  
**Service:** `src/lib/services/superadmin-organizations.ts`, `src/lib/services/superadmin-workflows.ts`

### Features
- Platform dashboard (org count, user count, activity metrics)
- Organization management (create, edit, suspend/activate)
- User management across all organizations
- Role assignment (including finance roles)
- Audit log viewer (filter by module, actor, date)
- Workflow approvals

---

## 18. Settings

**Path:** `/settings`  
**Access:** All authenticated users  
**Service:** Uses profile/organization services

### Features
- Account profile (name, email, role display)
- Edit profile dialog (updates profiles + employees tables)
- Admin-only: Company profile card
- Admin-only: Roles & permissions display
- Notification preferences (UI only, not persisted)
- Security info (2FA marked as planned)
- Sign out button
