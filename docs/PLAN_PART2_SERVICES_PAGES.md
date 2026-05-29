# Implementation Plan — Part 2: Services, Pages, Components

---

## RBAC (Role-Based Access Control)

### Permission Codes (seeded into `permissions` table)
```
Module: employees    → employees.view, employees.manage
Module: payroll      → payroll.view, payroll.manage, payroll.finalize
Module: personnel    → personnel.view, personnel.manage, personnel.verify
Module: recruitment  → recruitment.view, recruitment.manage, recruitment.interview
Module: attendance   → attendance.view, attendance.manage, attendance.device_admin
Module: leave        → leave.view, leave.manage, leave.approve
Module: balance      → balance.view, balance.manage, balance.acknowledge
Module: assets       → assets.view, assets.manage, assets.assign
Module: settings     → settings.view, settings.manage
Module: departments  → departments.view, departments.manage
Module: locations    → locations.view, locations.manage
Module: tasks        → tasks.view, tasks.manage
Module: reports      → reports.view
```

### Default Roles
| Role | Permissions |
|---|---|
| `super_admin` | ALL permissions |
| `hr_admin` | employees.*, payroll.*, personnel.*, leave.*, balance.*, assets.*, attendance.*, departments.*, locations.*, tasks.*, settings.*, reports.* |
| `hr_recruitment` | recruitment.*, employees.view |
| `training_manager` | employees.view (location-scoped), attendance.view (location-scoped), tasks.manage (location-scoped) |
| `employee` | attendance.view (self), leave.view (self), tasks.view (assigned), balance.view (self), balance.acknowledge |

### Modified Files
1. **`src/types/index.ts`** — Add to User: `permissions: string[]`, `roleId: string`, `roleName: string`, `locationScope: string | null`
2. **`src/providers/RoleProvider.tsx`** — After fetching org_members, also fetch role→role_permissions→permissions. Expose `hasPermission(code)` helper. If `location_scope` is set, pass it to all service calls.
3. **`src/components/layout/Sidebar.tsx`** — New nav structure:

```
CORE: Dashboard, Attendance, Tasks, Leave, Schedule, Notifications
HR: Employees, Departments, Personnel, Recruitment, Payroll  (gated by respective .view permissions)
FINANCE: Balances                                            (gated by balance.view)
OPERATIONS: Locations, Assets                                (gated by respective .view permissions)
SYSTEM: Settings
```

---

## Module 1: Payroll

### Service: `src/lib/services/payroll.ts`
```
getPayrollPeriods(orgId) → periods[] ordered by start_date desc
createPayrollPeriod({org_id, name, start_date, end_date, working_days, created_by})
getPayrollSlips(orgId, periodId) → slips[] with employee(full_name, employee_code, department:name) joins
generatePayrollSlips(orgId, periodId) → for each active employee:
  1. Query attendance_records WHERE work_date BETWEEN period.start_date AND period.end_date
  2. Count: present_days (status='present'|'late'), absent_days (no record or status='absent'), late_days (status='late'), leave_days (status='on_leave')
  3. daily_rate = employee.base_salary / period.working_days
  4. attendance_deduction = absent_days × daily_rate
  5. late_deduction = late_days × (daily_rate × 0.25)  [configurable]
  6. Get employee_balances with type 'loan'|'advance' status != 'settled' → sum as other_deductions
  7. social_insurance_deduction = from social_insurance.employee_share or default 9.75%
  8. gross = base_salary + allowances + bonus + overtime_amount
  9. net = gross - attendance_deduction - late_deduction - other_deductions - social_insurance_deduction
  10. Upsert payroll_slips row
updatePayrollSlip(id, values) → manual override for bonus, deductions, notes
finalizePayrollPeriod(periodId) → set status='finalized', lock all slips
```

### Page: `src/app/(app)/payroll/page.tsx`
- **Header:** "Payroll" title + "Create Period" button (permission: payroll.manage)
- **Periods Table:** name, date range, working days, status badge, employee count, total net
- **Click period** → navigates to `/payroll/[periodId]`

### Page: `src/app/(app)/payroll/[periodId]/page.tsx`
- **Header:** Period name + status badge + action buttons
- **"Generate Payslips" button** → runs auto-calculation, shows progress
- **Slips Table:** Employee | Code | Dept | Working | Present | Absent | Late | Base | Deductions | Bonus | Net
- **Click row** → Edit Slip dialog (adjust bonus, deductions, notes)
- **"Finalize" button** → confirmation dialog → locks period
- **Print button** → CSS @media print layout

### Hook: `usePayrollPeriods()`, `usePayrollSlips(periodId)`

---

## Module 2: Personnel

### Service: `src/lib/services/personnel.ts`
```
getPersonnelFiles(orgId, employeeId?, category?) → files[] ordered by created_at desc
uploadPersonnelFile(orgId, employeeId, {category, file, expiry_date, notes}) → upload to 'personnel-files' bucket + insert DB
deletePersonnelFile(id) → delete storage + DB
verifyPersonnelFile(id, verifiedBy) → set is_verified=true
getExpiringDocuments(orgId, daysAhead=30) → files where expiry_date <= now() + interval

getSocialInsurance(orgId, employeeId) → single record
upsertSocialInsurance(values) → insert or update (unique on org_id+employee_id)

getContracts(orgId, employeeId?) → contracts[]
createContract(values) → insert
updateContract(id, values) → update
terminateContract(id, reason) → set status='terminated', terminated_at=now()
```

### Page: `src/app/(app)/personnel/page.tsx`
- **Left sidebar:** Employee list/search (filterable by department)
- **Right content (per selected employee):** 3 tabs
  - **Documents Tab:** File list by category, upload button, expiry date column with ⚠️ warnings, verify checkbox (admin), delete
  - **Insurance Tab:** Form with GOSI number, registration date, contribution rate, employer/employee shares, save button
  - **Contracts Tab:** Contract list, current contract highlighted green, "Add Contract" dialog, terminate button
- **Dashboard card at top:** "X documents expiring soon" alert

### Hook: `usePersonnelFiles(employeeId?)`, `useSocialInsurance(employeeId)`, `useContracts(employeeId?)`

---

## Module 3: Recruitment

### Service: `src/lib/services/recruitment.ts`
```
getJobPostings(orgId, status?) → postings[] with department, location, application count joins
createJobPosting(values) → insert
updateJobPosting(id, values) → update
publishJobPosting(id) → set status='published', published_at=now()
closeJobPosting(id) → set status='closed'

getApplications(orgId, postingId?, status?) → applications[]
createApplication(values) → insert (called from public form, no auth)
updateApplication(id, values) → update status, rating, notes
bulkUpdateApplicationStatus(ids[], status) → batch status change

getInterviewRounds(applicationId) → rounds[] with interviewer(full_name) join
scheduleInterview(values) → insert
updateInterview(id, values) → update score, feedback, status
```

### Page: `src/app/(app)/recruitment/page.tsx`
- **Two tabs:** "Job Postings" and "Applications"
- **Postings Tab:**
  - Table: title, department, location, type, positions, applicants count, status, dates
  - "Create Posting" dialog: title, description, requirements, department, location, salary range, employment type, positions count
  - Row actions: Publish, Close, Edit, View applications
- **Applications Tab:**
  - Filter by posting dropdown + status filter
  - Table: applicant name, email, posting title, applied date, status pipeline badge, rating stars
  - Click row → Application Detail dialog:
    - Applicant info, resume download link, cover letter
    - Status change dropdown with pipeline: New → Screening → Interview → Offer → Hired/Rejected
    - Interview rounds timeline
    - "Schedule Interview" button: date/time, interviewer select, location/link
    - After interview: score (1-10) + feedback text

### Page: `src/app/apply/[postingId]/page.tsx` (PUBLIC — outside (app) route group)
- No auth required, clean branded design matching login page
- Shows: job title, department, location, description, requirements, salary range
- Application form: full name, email, phone, resume file upload, cover letter textarea
- Submit → success confirmation message
- If posting is closed/filled → shows "Position no longer available"

### Hook: `useJobPostings(status?)`, `useApplications(postingId?, status?)`

---

## Module 4: Enhanced Attendance

### Service changes: `src/lib/services/attendance.ts`
```
ADD: registerDevice(employeeId, deviceFingerprint, deviceName) → update employees table
ADD: validateDevice(employeeId, deviceFingerprint) → boolean check
ADD: resetDevice(employeeId) → clear registered_device_id/name
ADD: getDeviceInfo(employeeId) → { registered_device_id, registered_device_name }
MODIFY: createCheckIn() → add device_fingerprint field, check is_registered_device, prevent duplicate (same employee+work_date)
```

### Page changes: `src/app/(app)/attendance/page.tsx`
- **Device Registration Flow:**
  1. Generate device fingerprint (User-Agent + screen resolution + canvas fingerprint hash)
  2. On first check-in: if no device registered → "Register this as your work device?" prompt
  3. On subsequent check-ins: compare fingerprint → if mismatch → block + show error + notify admin
- **Speed Optimizations:**
  1. Start GPS acquisition on page mount (not on button click)
  2. Cache device fingerprint in localStorage
  3. One-tap "Check In" button → parallel: GPS + device check + create record
  4. Target: < 2 seconds total
  5. Show success toast instead of full refetch
- **Admin Section (new):**
  - "Device Management" tab/section
  - Table: employee, device name, device ID, registered date
  - "Reset Device" button per employee
  - "Unregistered Check-ins" alert list

---

## Module 5: Enhanced Leave

### Service changes: `src/lib/services/leaves.ts`
```
ADD: createLeaveApprovalChain(orgId, requestId, approverIds[]) → insert leave_approval_steps in order
ADD: getLeaveApprovalSteps(requestId) → steps[] with approver(full_name) join
ADD: processLeaveStep(stepId, {status, decision_note}) → update step, if approved advance current_step, if all approved finalize request
ADD: getMyPendingApprovals(orgId, employeeId) → requests where I'm the current step approver
MODIFY: createLeaveRequest() → auto-create approval chain based on employee's manager + HR admin
```

### Page changes: `src/app/(app)/leave/page.tsx`
- **Approval Chain Visualization:** Per request, show: Step 1 (Manager) ✅ → Step 2 (HR) ⏳ → Final
- **"My Approvals" tab (for managers/HR):** Only show requests where they're the current pending approver
- **Extended leave types:** annual, sick, emergency, unpaid, maternity, paternity, other
- **Leave policy display:** Show remaining balance per type before submitting

---

## Module 6: Balance/Deficit

### Service: `src/lib/services/balances.ts`
```
getEmployeeBalances(orgId, employeeId?, status?) → balances[] with employee join
createBalance(values) → insert
updateBalance(id, values) → update
getBalanceAttachments(balanceId) → attachments[]
uploadBalanceAttachment(balanceId, file) → upload to 'balance-attachments' bucket + insert
deleteBalanceAttachment(id) → delete
acknowledgeBalance(balanceId, employeeId, signatureData) → insert acknowledgment
getAcknowledgment(balanceId) → acknowledgment record with signature
```

### Page: `src/app/(app)/balances/page.tsx`
- **Summary Cards:** Total owed BY employees | Total owed TO employees | Pending acknowledgments
- **Admin View:**
  - Table: employee, type (advance/loan/penalty/etc), amount, remaining, due date, status, acknowledged?
  - "Add Balance Entry" dialog: select employee, type, amount, description, due date
  - Click row → detail panel:
    - Balance info
    - Attachments list with upload button
    - Acknowledgment status (signed or pending)
- **Employee View:** "My Balances"
  - List of their balance entries
  - "Acknowledge" button → opens signature dialog
  - View attached documents

### Component: `src/components/forms/SignatureCanvas.tsx`
- HTML5 Canvas for drawing signature
- Clear/Undo buttons
- "Confirm" button → exports as base64 PNG → saves to acknowledgment
- Alternative: simple checkbox "I acknowledge this balance" with timestamp

### Hook: `useEmployeeBalances(employeeId?)`, `useBalanceAttachments(balanceId)`

---

## Module 7: Asset Handover

### Service: `src/lib/services/assets.ts`
```
getAssetCategories(orgId) → categories[]
createAssetCategory(values) → insert
updateAssetCategory(id, values) → update

getAssets(orgId, {status?, categoryId?, search?}) → assets[] with category join
createAsset(values) → insert
updateAsset(id, values) → update
deleteAsset(id) → delete (only if status='available')

getAssetAssignments(orgId, {employeeId?, assetId?, status?}) → assignments[] with asset+employee+category joins
assignAsset({org_id, asset_id, employee_id, assigned_by, notes}) → insert assignment + update asset status='assigned'
returnAsset(assignmentId, {return_condition, notes}) → update assignment (returned_at=now, status='returned') + update asset status='available'
getEmployeeAssets(employeeId) → active assignments for one employee
```

### Page: `src/app/(app)/assets/page.tsx`
- **Two tabs:** "Inventory" and "Handovers"
- **Inventory Tab:**
  - Table: asset code, name, category, serial number, purchase date, cost, status badge
  - "Add Asset" dialog: name, category (select), asset code, serial, purchase date, cost, description
  - "Manage Categories" dialog: CRUD for categories
  - Filter by category, status
- **Handovers Tab:**
  - Table: employee, asset, category, assigned date, assigned by, status, return date
  - "Assign Asset" dialog: select employee + select available asset + notes
  - "Return" button per row → condition dropdown (good/damaged/lost) + notes
  - "View Employee Assets" → filter by employee → shows everything they have
- **Onboarding integration:** When viewing an employee's detail page, show "Assets" tab with their current items

### Hook: `useAssets(filters?)`, `useAssetAssignments(filters?)`, `useAssetCategories()`

---

## Module 8: Training Isolation (part of RBAC)

This is handled by the `location_scope` column on `org_members`:
- When a `training_manager` logs in, their `location_scope` is set to their city's location ID
- All service calls automatically filter by this location
- Modified in `useOrgData()` hook: if `currentUser.locationScope`, pass it to fetcher
- Each service's `get*` function accepts optional `locationId` filter
- Training managers in Riyadh cannot see Jeddah data and vice versa

---

## New Hooks Summary (added to `src/hooks/use-data.ts`)
```
usePayrollPeriods()
usePayrollSlips(periodId)
usePersonnelFiles(employeeId?)
useSocialInsurance(employeeId)
useContracts(employeeId?)
useJobPostings(status?)
useApplications(postingId?)
useEmployeeBalances(employeeId?)
useAssets(filters?)
useAssetAssignments(filters?)
useAssetCategories()
useMyPendingApprovals()
```

---

## New Sidebar Navigation Structure
```
CORE
  ├── Dashboard
  ├── Attendance          (attendance.view)
  ├── Tasks               (tasks.view)
  ├── Leave               (leave.view)
  ├── Schedule            (attendance.view)
  └── Notifications       (all)

HR
  ├── Employees           (employees.view)
  ├── Departments         (departments.view)
  ├── Personnel           (personnel.view)
  ├── Recruitment         (recruitment.view)
  └── Payroll             (payroll.view)

FINANCE
  └── Balances            (balance.view)

OPERATIONS
  ├── Locations           (locations.view)
  └── Assets              (assets.view)

SYSTEM
  └── Settings            (all)
```

---

## Execution Order
1. **Phase 1 (Day 1-2):** migration SQL + seed roles/permissions + RBAC provider + sidebar
2. **Phase 2 (Day 3-5):** Payroll service+page + Personnel service+page + Assets service+page
3. **Phase 3 (Day 6-8):** Recruitment service+pages + Leave v2 + Balances service+page + SignatureCanvas
4. **Phase 4 (Day 9-10):** Attendance v2 (device lock + speed) + fix existing bugs

## Verification After Each Phase
- `npm run build` → zero errors
- Manual browser test of each new page
- RBAC test: login as different roles, verify access restrictions
