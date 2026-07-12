# Payroll Enhancement Blueprint

**Feature:** Deduction Rules Groups + Enhanced Payroll Calculation Workflow  
**Status:** Planning  
**Author:** Abdulrhman Elfeky  
**Date:** 2026-07-12  

---

## 1. Overview

The current payroll system uses hardcoded deduction logic (lateness deducted by pro-rated minute, absence deducted by daily rate). This enhancement introduces **Deduction Rules Groups** — configurable policy sets that define how lateness and absences are penalized. Each employee is assigned a group; when payroll runs, the group's rules are snapshotted into the payslip so that historical records are never corrupted by future policy changes.

### Goals
- Configurable payroll policy per employee group
- Correct absence classification (approved leave vs. unapproved absence)
- Full draft-review-edit-approve-pay lifecycle with audit trail
- Re-calculation allowed at any point before the payslip is marked **Paid**
- Manual adjustment support (bonus/deduction) with reason, author, and timestamp

---

## 2. Deduction Rules Group — Definition

A **Deduction Rules Group** is a named policy object that holds four fields:

| Field | Type | Description |
|---|---|---|
| `name` | `text` | e.g. "Standard", "Management", "Field Staff" |
| `late_grace_minutes` | `integer` | Minutes of lateness forgiven before any deduction starts |
| `deduction_per_late_hour` | `numeric` | SAR amount deducted per full hour late (after grace) |
| `allowed_absent_days` | `integer` | N days of **approved** absence allowed before deduction applies |
| `deduction_per_absent_day` | `numeric` | SAR amount deducted per **unapproved** absent day |
| `deduction_per_excess_approved_day` | `numeric` | SAR amount deducted per approved absent day **beyond the N allowed** (usually softer than unapproved rate) |

### Absence Classification Rule
```
For each absence day in the month:

  Case A — Unapproved absence (no approved leave request for that date):
    → ALWAYS deducted at deduction_per_absent_day rate
    → Does NOT count toward the N allowed days

  Case B — Approved absence (approved leave request covers that date):
    → counts toward the N allowed days
    → if total approved absences ≤ N  →  no deduction
    → if total approved absences > N  →  excess days deducted at deduction_per_excess_approved_day rate
```

This ensures employees are incentivized to file leave requests properly.

### Late Deduction Rule
```
effective_late_minutes = max(0, total_late_minutes - late_grace_minutes)
late_deduction = (effective_late_minutes / 60) × deduction_per_late_hour
```

---

## 3. Full Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  SETUP (one-time / as-needed)                               │
│  Admin creates Deduction Rules Groups                       │
│  Admin assigns a group to each employee (on creation / HR)  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1 — Trigger Calculation                               │
│  Admin selects month → clicks "Run Payroll"                 │
│  System skips employees that already have a PAID payslip    │
│  for the selected month                                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2 — Per-Employee Calculation                          │
│  For each employee:                                         │
│    a. Read employee base_salary, bonus, fixed_deductions    │
│    b. Read assigned Deduction Rules Group → SNAPSHOT all    │
│       4 fields into the payslip row                         │
│    c. Fetch attendance_records for the month                │
│    d. Fetch approved leave_requests for the month           │
│    e. Classify each absent day (approved vs. unapproved)    │
│    f. Compute late_deduction (with grace)                   │
│    g. Compute absence_deduction (using classification)      │
│    h. Compute GOSI (global constants, always applied)       │
│    i. net = base + bonus - fixed_ded - late_ded             │
│           - absence_ded                                     │
│    j. Upsert payslip with status = "draft"                  │
│       (re-run is allowed; overwrites draft if not paid)     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3 — Admin Reviews Draft Report                        │
│  Admin sees full payroll table for the month                │
│  Each row shows: employee, base, allowances, deductions     │
│  breakdown (late, absence, fixed), GOSI, net                │
│  Admin can:                                                 │
│    - Add manual bonus  (amount + reason)                    │
│    - Add manual deduction (amount + reason)                 │
│    - Remove a manual adjustment                             │
│    - Re-trigger calculation for a single employee           │
│      (blocked if employee's payslip is already PAID)        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4 — Finance Approval                                  │
│  Admin submits payroll run for approval                     │
│  Finance_Manager reviews totals & approves                  │
│  Status → "approved"                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5 — Payment & Accounting                              │
│  Finance records bank payment                               │
│  Accounting journal posted:                                 │
│    DR Salary Expense    (base + allowances)                 │
│    DR Allowances Expense                                    │
│    DR GOSI Expense      (employer share)                    │
│    CR Salary Payable    (net)                               │
│    CR GOSI Payable      (employee + employer share)         │
│  All payslips for the month → status: "paid"                │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Database Changes

### 4.1 New Table — `deduction_rule_groups`

```sql
CREATE TABLE deduction_rule_groups (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  late_grace_minutes       integer NOT NULL DEFAULT 0,
  deduction_per_late_hour  numeric(14,2) NOT NULL DEFAULT 0,
  allowed_absent_days      integer NOT NULL DEFAULT 0,
  deduction_per_absent_day          numeric(14,2) NOT NULL DEFAULT 0,
  deduction_per_excess_approved_day numeric(14,2) NOT NULL DEFAULT 0,
  created_at                        timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE deduction_rule_groups ENABLE ROW LEVEL SECURITY;
-- SELECT: org members; INSERT/UPDATE/DELETE: admin only
```

### 4.2 Alter Table — `employees`

```sql
-- Link employee to a deduction rules group
ALTER TABLE employees
  ADD COLUMN deduction_rule_group_id uuid REFERENCES deduction_rule_groups(id) ON DELETE SET NULL;
```

### 4.3 Alter Table — `payslips`

```sql
-- Snapshot of the rules group used at calculation time
ALTER TABLE payslips
  ADD COLUMN snapshot_group_name            text,
  ADD COLUMN snapshot_late_grace_minutes    integer,
  ADD COLUMN snapshot_deduction_per_late_hour numeric(14,2),
  ADD COLUMN snapshot_allowed_absent_days               integer,
  ADD COLUMN snapshot_deduction_per_absent_day          numeric(14,2),
  ADD COLUMN snapshot_deduction_per_excess_approved_day numeric(14,2),

  -- Attendance breakdown
  ADD COLUMN approved_absent_days    integer DEFAULT 0,
  ADD COLUMN unapproved_absent_days  integer DEFAULT 0,
  ADD COLUMN late_minutes            integer DEFAULT 0,
  ADD COLUMN late_deduction          numeric(14,2) DEFAULT 0,
  ADD COLUMN absence_deduction       numeric(14,2) DEFAULT 0,

  -- Manual adjustments array (JSONB)
  -- Shape: [{ id, type: "bonus"|"deduction", amount, reason, created_by, created_at }]
  ADD COLUMN manual_adjustments      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN manual_adjustments_total numeric(14,2) DEFAULT 0;
  -- manual_adjustments_total = sum(bonuses) - sum(deductions) from manual_adjustments
  -- net_salary already exists; it will be recomputed to include manual_adjustments_total
```

### 4.4 Migration File

Create: `db/schema_v54_payroll_deduction_groups.sql`

---

## 5. Service Layer Changes

### 5.1 New Service — `src/lib/services/deduction-rule-groups.ts`

```
getDeductionRuleGroups(orgId)          → list all groups for org
getDeductionRuleGroup(id)              → single group
createDeductionRuleGroup(orgId, data)  → insert
updateDeductionRuleGroup(id, data)     → update (blocks if employees assigned — warn only)
deleteDeductionRuleGroup(id)           → blocks if employees are assigned
```

### 5.2 Rewrite — `src/lib/services/payroll.ts`

#### `generatePayslip(orgId, employeeId, month)`

Full replacement of the current calculation logic:

```
1. Fetch employee: base_salary, bonus, deductions, deduction_rule_group_id
2. Fetch deduction_rule_groups row for that group_id
3. Fetch attendance_records for [monthStart, monthEnd]
4. Fetch approved leave_requests for [monthStart, monthEnd] for this employee
   - Build a Set of approved_dates from the leave records
5. For each day in the month that has an absence record:
   - If date is in approved_dates  → approved_absent_day++
   - Else                          → unapproved_absent_day++
6. late_deduction:
   - effective_minutes = max(0, total_late_minutes - late_grace_minutes)
   - late_deduction = (effective_minutes / 60) × deduction_per_late_hour
7. absence_deduction:
   - unapproved_deduction = unapproved_absent_days × deduction_per_absent_day
   - excess_approved = max(0, approved_absent_days - allowed_absent_days)
   - excess_approved_deduction = excess_approved × deduction_per_excess_approved_day
   - absence_deduction = unapproved_deduction + excess_approved_deduction
8. GOSI (unchanged global constants)
9. Preserve existing manual_adjustments from current draft if re-running
10. net = base + bonus - fixed_ded - late_ded - absence_ded + manual_adjustments_total
11. Upsert with all snapshot fields populated
    onConflict: "org_id,employee_id,month"
    Block upsert if existing row has status = "paid"
```

#### `addManualAdjustment(payslipId, adjustment)`

```
- Blocks if payslip status = "paid"
- Generates a uuid for the adjustment entry
- Appends to manual_adjustments JSONB array
- Recomputes manual_adjustments_total and net_salary
- Stores created_by (user id) and created_at (timestamp)
```

#### `removeManualAdjustment(payslipId, adjustmentId)`

```
- Blocks if payslip status = "paid"
- Filters out the entry by id from manual_adjustments array
- Recomputes manual_adjustments_total and net_salary
```

#### `recalculatePayslip(orgId, employeeId, month)`

```
- Identical to generatePayslip but PRESERVES existing manual_adjustments
- Blocks if payslip status = "paid"
```

---

## 6. API Routes

### 6.1 New — Deduction Rules Groups

```
GET    /api/deduction-rule-groups                → list for org
POST   /api/deduction-rule-groups                → create  [Admin, HR_Admin]
PUT    /api/deduction-rule-groups/[id]           → update  [Admin, HR_Admin]
DELETE /api/deduction-rule-groups/[id]           → delete  [Admin]
```

### 6.2 Updated — Payroll

```
POST   /api/payroll/run           → trigger full month calculation  [Admin, HR_Admin]
POST   /api/payroll/recalculate   → recalculate single employee     [Admin, HR_Admin]
                                     body: { employeeId, month }
POST   /api/payroll/adjust        → add manual adjustment            [Admin, HR_Admin]
                                     body: { payslipId, type, amount, reason }
DELETE /api/payroll/adjust/[id]   → remove manual adjustment         [Admin, HR_Admin]
                                     query: ?payslipId=...
```

Existing endpoints kept unchanged:
```
GET    /api/accounting/payroll/status
POST   /api/accounting/payroll/create-draft-entry
POST   /api/accounting/payroll/record-payment
POST   /api/accounting/payroll/auto-post
```

---

## 7. UI Changes

### 7.1 New Page — Deduction Rules Groups

**Path:** `src/app/(app)/settings/deduction-rules/page.tsx`  
(under Settings, visible to Admin and HR_Admin only)

**Components:**
- Table listing all groups with their 4 policy fields
- "Add Group" button → modal/drawer with form
- Edit / Delete per row (delete blocked if employees assigned — show warning with count)

### 7.2 Updated — Employee Form / HR Profile

**Files:** `src/app/(app)/employees/` and `src/app/(app)/hr/`

- Add **"Payroll Policy Group"** dropdown field to employee creation and edit forms
- Shows group name + brief summary of its rules as helper text
- Required field (cannot save employee without assigning a group)

### 7.3 Updated — Payroll Page

**Path:** `src/app/(app)/payroll/page.tsx`

**New features:**
- Payroll run table shows expanded per-employee breakdown:
  - Base salary, bonus, fixed deductions
  - Approved absent days, unapproved absent days, late minutes
  - Late deduction, absence deduction
  - Manual adjustments (list of each with reason)
  - GOSI (employee + employer)
  - **Net salary**
- "Re-calculate" button per employee row (disabled if paid)
- "Add Adjustment" button per employee row (disabled if paid):
  - Form: type (bonus / deduction), amount, reason
- Manual adjustments shown as an expandable sub-row with remove button
- Summary bar at bottom: total gross, total deductions, total net, total employer GOSI

---

## 8. Implementation Phases

### Phase 1 — Database (Migration)
- [ ] Write `db/schema_v54_payroll_deduction_groups.sql`
  - Create `deduction_rule_groups` table with RLS
  - Alter `employees` to add `deduction_rule_group_id`
  - Alter `payslips` to add all snapshot + breakdown + manual adjustment columns
- [ ] Verify migration runs cleanly against current schema

### Phase 2 — Deduction Rules Group CRUD
- [ ] `src/lib/services/deduction-rule-groups.ts` — full CRUD service
- [ ] `src/app/api/deduction-rule-groups/route.ts` — GET + POST
- [ ] `src/app/api/deduction-rule-groups/[id]/route.ts` — PUT + DELETE
- [ ] `src/app/(app)/settings/deduction-rules/page.tsx` — list + add + edit + delete UI

### Phase 3 — Employee Assignment
- [ ] Add `deduction_rule_group_id` field to employee creation form
- [ ] Add `deduction_rule_group_id` field to employee edit / HR profile
- [ ] Update employee service queries to include the group field

### Phase 4 — Payroll Calculation Rewrite
- [ ] Rewrite `generatePayslip()` in `src/lib/services/payroll.ts`
  - New absence classification logic (approved vs. unapproved via leave_requests)
  - New late deduction logic (with grace period)
  - Snapshot all group fields into payslip
  - Preserve manual_adjustments on re-run
  - Block if payslip is paid
- [ ] Add `recalculatePayslip()` function
- [ ] Add `addManualAdjustment()` function
- [ ] Add `removeManualAdjustment()` function
- [ ] Update `src/app/api/payroll/` routes to expose new endpoints

### Phase 5 — Payroll UI Overhaul
- [ ] Expand payroll table to show full breakdown per employee
- [ ] Add "Re-calculate" button per row
- [ ] Add "Add Adjustment" button + modal per row
- [ ] Show manual adjustments as expandable sub-rows with remove button
- [ ] Add summary totals bar

### Phase 6 — QA & Validation
- [ ] Test: employee with no group assigned → clear error, not silent failure
- [ ] Test: re-run payroll → manual adjustments preserved
- [ ] Test: re-run on a PAID payslip → blocked
- [ ] Test: approved leave within N days → no deduction
- [ ] Test: approved leave beyond N days → deduction on excess only
- [ ] Test: unapproved absence → always deducted regardless of N
- [ ] Test: late under grace period → zero deduction
- [ ] Test: late over grace period → correct SAR deduction
- [ ] Test: policy group fields edited after payslip generated → payslip snapshot unchanged
- [ ] Test: manual adjustment added → net salary updated correctly
- [ ] Test: manual adjustment removed → net salary reverted correctly

---

## 9. Key Data Contracts

### Payslip Row (after enhancement)

```typescript
type Payslip = {
  // existing
  id: string
  org_id: string
  employee_id: string
  month: string                      // "YYYY-MM-01"
  base_salary: number
  total_allowances: number
  total_deductions: number
  net_salary: number
  employee_gosi: number
  employer_gosi: number
  attendance_days: number
  allowances_details: AdjustmentLine[]
  deductions_details: AdjustmentLine[]
  status: "draft" | "approved" | "paid"

  // new — policy snapshot
  snapshot_group_name: string | null
  snapshot_late_grace_minutes: number | null
  snapshot_deduction_per_late_hour: number | null
  snapshot_allowed_absent_days: number | null
  snapshot_deduction_per_absent_day: number | null
  snapshot_deduction_per_excess_approved_day: number | null

  // new — attendance breakdown
  approved_absent_days: number
  unapproved_absent_days: number
  late_minutes: number
  late_deduction: number
  absence_deduction: number

  // new — manual adjustments
  manual_adjustments: ManualAdjustment[]
  manual_adjustments_total: number
}

type ManualAdjustment = {
  id: string
  type: "bonus" | "deduction"
  amount: number
  reason: string
  created_by: string                 // user id
  created_at: string                 // ISO timestamp
}
```

---

## 10. Files Touched Summary

| File | Change |
|---|---|
| `db/schema_v54_payroll_deduction_groups.sql` | **NEW** — full migration |
| `src/lib/services/deduction-rule-groups.ts` | **NEW** — CRUD service |
| `src/lib/services/payroll.ts` | **REWRITE** — full calculation logic |
| `src/app/api/deduction-rule-groups/route.ts` | **NEW** — list + create |
| `src/app/api/deduction-rule-groups/[id]/route.ts` | **NEW** — update + delete |
| `src/app/api/payroll/route.ts` | **UPDATE** — add recalculate + adjust endpoints |
| `src/app/(app)/settings/deduction-rules/page.tsx` | **NEW** — groups management UI |
| `src/app/(app)/employees/` (form files) | **UPDATE** — add group dropdown |
| `src/app/(app)/hr/` (profile files) | **UPDATE** — add group dropdown |
| `src/app/(app)/payroll/page.tsx` | **REWRITE** — enhanced payroll UI |
| `src/types/payroll.ts` (or `types/index.ts`) | **UPDATE** — new TypeScript types |
