# Blueprint: Remove Automatic Deduction Rules & Enable Manual HR Deductions/Absences

## Summary

**Client Request (Arabic):** شيل قاعدة الخصم والغياب الأوتوماتيكية من فورم إضافة الموظف، وخلي الـ HR يقدر ينزل خصم أو غياب يدوي على أي موظف.

**What changes:** Remove the automatic rule-based deduction system (deduction rule groups) from the employee forms. Instead, give HR a standalone UI to manually record deductions and absences against any employee at any time.

---

## Current System Architecture

### How It Works Today

1. **Deduction Rule Groups** (`deduction_rule_groups` table) define policies:
   - Late grace minutes, deduction per late hour
   - Allowed absent days, deduction per absent day
   - Deduction per excess approved leave day

2. **Employee Assignment:** Each employee has `deduction_rule_group_id` linking to a policy

3. **Automatic Payroll Calculation** (`src/lib/server/payroll.ts`):
   - Loads employee's deduction rule group
   - Scans `attendance_records` for late minutes & absences
   - Auto-calculates `lateDeductionHalalas` and `absenceDeductionHalalas`
   - Applies to payslip automatically

4. **Manual Adjustments** (already exist): HR can add bonus/deduction to a *specific payslip* during payroll processing

### Files Involved

| File | Role |
|------|------|
| `src/components/forms/AddEmployeeDialog.tsx` | Deduction rule group dropdown (line 722-738) |
| `src/components/forms/EditEmployeeDialog.tsx` | Deduction rule group dropdown (line 839-853) |
| `src/app/(app)/settings/deduction-rules/page.tsx` | Settings CRUD page for rule groups |
| `src/lib/services/deduction-rule-groups.ts` | Client-side service for fetching groups |
| `src/app/api/deduction-rule-groups/route.ts` | API for listing/creating groups |
| `src/app/api/deduction-rule-groups/[id]/route.ts` | API for updating/deleting groups |
| `src/lib/server/payroll.ts` (lines 200-262) | Auto-calculation logic using rules |
| `src/app/api/payroll/adjust/route.ts` | Existing manual adjustment API (payslip-level) |
| `src/app/(app)/payroll/page.tsx` (lines 544-556) | Policy snapshot display in payslip breakdown |
| `db/schema_v54_payroll_deduction_groups.sql` | Schema definition |
| `db/schema_v90_atomic_deduction_policies.sql` | Atomic command function |

---

## Implementation Plan

### Phase 1: Remove Automatic Deduction Rule Group from Employee Forms

#### 1.1 AddEmployeeDialog.tsx
- **Remove** the deduction rule group dropdown (lines 722-738)
- **Remove** `deduction_rule_group_id` from form state (line 111)
- **Remove** `deductionGroups` state and the `getDeductionRuleGroups` import/fetch (lines 19, 75, 174)
- **Keep** `deductions` field (line 110) — this is the "fixed deduction" amount, unrelated to rules

#### 1.2 EditEmployeeDialog.tsx
- **Remove** the deduction rule group dropdown (lines 839-853)
- **Remove** `deductionGroups` state and the fetch logic
- **Remove** `deduction_rule_group_id` from form state and payload
- **Keep** `deductions` field (line 836) — "الخصومات الثابتة" (fixed recurring deduction)

#### 1.3 Payroll Engine — Disable Auto-Calculation
In `src/lib/server/payroll.ts`, modify `loadEmployeePayrollInput`:
- **Set** `lateDeductionHalalas = 0` and `absenceDeductionHalalas = 0` regardless of rule group
- **Remove** the rule group lookup block (lines 200-228)
- **Remove** the late/absence calculation block (lines 239-262)
- **Keep** `approvedAbsentDays`, `unapprovedAbsentDays`, `lateMinutes` tracking for informational display
- **Keep** the snapshot structure (set rule fields to zero/null)

> **Note:** Do NOT drop the `deduction_rule_groups` table or the `deduction_rule_group_id` column yet — this is a soft removal. The data remains for potential future re-enablement.

#### 1.4 Hide Settings Page
- **Remove or hide** the sidebar link to `/settings/deduction-rules`
- Optionally add a redirect or "feature disabled" notice on the page itself

---

### Phase 2: Add Manual Deduction & Absence Entry for HR

#### 2.1 New Database Table: `employee_manual_entries`

```sql
CREATE TABLE IF NOT EXISTS public.employee_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('deduction', 'absence')),
  amount numeric(14,2), -- nullable for absence entries (absence = day-based, not monetary)
  days integer, -- for absence: number of absence days
  reason text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE, -- the date the deduction/absence applies to
  month text, -- payroll month this should be applied to (YYYY-MM-01 format, nullable = current)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled')),
  applied_to_payslip_id uuid REFERENCES public.payslips(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_manual_entries_employee ON public.employee_manual_entries(org_id, employee_id);
CREATE INDEX idx_manual_entries_month ON public.employee_manual_entries(org_id, month);

ALTER TABLE public.employee_manual_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY manual_entries_select ON public.employee_manual_entries
  FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY manual_entries_write ON public.employee_manual_entries
  FOR ALL TO service_role USING(true) WITH CHECK(true);
```

#### 2.2 New API Route: `/api/employees/[id]/manual-entries`

**POST** — Create a new manual deduction or absence
```typescript
// Schema
{
  entry_type: "deduction" | "absence",
  amount?: number,       // required for deduction, optional for absence
  days?: number,         // required for absence
  reason: string,        // min 3 chars
  entry_date: string,    // ISO date
  month?: string,        // which payroll month to apply (defaults to current)
}
```

**GET** — List manual entries for an employee (paginated, filtered by month/status)

**DELETE /api/employees/[id]/manual-entries/[entryId]** — Cancel (soft-delete) a pending entry

#### 2.3 New UI Component: Manual Entry Panel

Add a new tab/section in the employee detail or a floating action from the personnel list:

**Location:** Inside the existing employee management screens (personnel page or a new sub-route)

**UI Flow:**
1. HR selects an employee
2. Clicks "إضافة خصم / غياب" (Add Deduction / Absence)
3. Dialog appears with:
   - Toggle: خصم (Deduction) / غياب (Absence)
   - If Deduction: Amount field (SAR), Reason, Date
   - If Absence: Number of days, Reason, Date range
   - Optional: Target payroll month
4. Confirmation → saves to `employee_manual_entries`
5. Shows history table of all entries for this employee

#### 2.4 Integrate with Payroll

Modify `loadEmployeePayrollInput` in `src/lib/server/payroll.ts`:

```typescript
// Instead of auto-calculating from attendance + rules:
// Load pending manual entries for this employee + month
const manualEntriesResult = await context.admin
  .from("employee_manual_entries")
  .select("*")
  .eq("org_id", context.orgId)
  .eq("employee_id", employeeId)
  .eq("month", month)
  .eq("status", "pending");

// Sum deduction amounts
const manualDeductionTotal = manualEntriesResult.data
  ?.filter(e => e.entry_type === 'deduction')
  .reduce((sum, e) => sum + moneyToHalalas(e.amount), 0) ?? 0;

// Sum absence days × daily rate (or just pass as absence days)
const manualAbsenceDays = manualEntriesResult.data
  ?.filter(e => e.entry_type === 'absence')
  .reduce((sum, e) => sum + (e.days || 0), 0) ?? 0;

// Calculate absence deduction = manual_absence_days × (base_salary / 30)
const dailyRate = roundDivideHalfUp(monthlyBaseSalaryHalalas, 30);
const absenceDeductionHalalas = manualAbsenceDays * dailyRate;

// Feed into formula
lateDeductionHalalas: 0,  // no longer auto-calculated
absenceDeductionHalalas: manualDeductionTotal + absenceDeductionHalalas,
```

After payslip is saved, mark entries as `applied`:
```typescript
// Update status to 'applied' and link to payslip
await context.admin
  .from("employee_manual_entries")
  .update({ status: 'applied', applied_to_payslip_id: payslipId })
  .eq("org_id", context.orgId)
  .eq("employee_id", employeeId)
  .eq("month", month)
  .eq("status", "pending");
```

---

### Phase 3: Accounting Integration (Auto-Posting)

When HR applies a manual deduction or absence, the system should automatically create accounting journal entries — following the same pattern used by sales auto-posting (`autoPostSalesLog`) and payroll auto-posting (`autoPostPayrollMonth`).

#### 3.1 Accounting Flow Overview

```
HR adds manual deduction/absence
        │
        ▼
employee_manual_entries (status: pending)
        │
        ▼  (on payroll run)
Payslip calculated with manual entries
        │
        ▼  (payroll approved)
autoPostPayrollMonth fires → journal entry includes deduction amounts
        │
        ▼
Manual entries marked as "applied" + linked to payslip
```

**Two accounting integration points:**

| Trigger | Journal Entry | Accounts |
|---------|--------------|----------|
| Payroll approved (includes deductions) | Already handled by `autoPostPayrollMonth` — deductions reduce net pay, which reduces CR Salary Payable | Existing salary expense/payable accounts |
| Standalone deduction (penalty outside payroll) | New auto-post: DR Employee Penalties Receivable, CR Penalty Income/Salary Payable | New account mapping needed |

#### 3.2 New Accounting Settings Fields

Add to `AccountingSettings` interface in `src/lib/accounting/posting-engine.ts`:

```typescript
// New fields
default_penalties_expense_id?: string | null;      // مصروف جزاءات / خصومات (DR)
default_penalties_payable_id?: string | null;      // جزاءات مستحقة على الموظف (CR → cleared via payroll)
auto_post_hr_penalties?: boolean;                  // Toggle: auto-post when HR applies entry
```

Add corresponding columns to `accounting_settings` table:
```sql
ALTER TABLE public.accounting_settings
  ADD COLUMN IF NOT EXISTS default_penalties_expense_id uuid REFERENCES public.accounting_accounts(id),
  ADD COLUMN IF NOT EXISTS default_penalties_payable_id uuid REFERENCES public.accounting_accounts(id),
  ADD COLUMN IF NOT EXISTS auto_post_hr_penalties boolean NOT NULL DEFAULT false;
```

#### 3.3 Auto-Post Function: `autoPostManualEntry`

Add to `src/lib/accounting/auto-posting.ts`:

```typescript
// =============================================================================
// Phase N: HR Manual Deduction/Absence Auto-Posting
// =============================================================================

interface ManualEntryData {
  id: string;
  employee_id: string;
  employee_name: string;
  entry_type: "deduction" | "absence";
  amount: number;         // final SAR amount (for absence: days × daily rate)
  reason: string;
  entry_date: string;
}

export async function autoPostManualEntry(
  admin: AdminClient,
  orgId: string,
  userId: string,
  entry: ManualEntryData,
  options?: { commandId?: string; requestId?: string }
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_hr_penalties) return { success: true };
    if (!settings.default_penalties_expense_id || !settings.default_penalties_payable_id) {
      throw new Error("حسابات الجزاءات والخصومات غير مكتملة. أكمل الإعدادات أولاً.");
    }

    const amount = roundMoney(entry.amount);
    if (amount <= 0) return { success: true };

    const typeLabel = entry.entry_type === "deduction" ? "خصم" : "غياب";
    const description = `${typeLabel} - ${entry.employee_name} - ${entry.reason}`;

    const lines = [
      // DR: Penalties Expense (the company recognizes the penalty as a recovery)
      {
        account_id: settings.default_penalties_expense_id,
        debit: amount,
        credit: 0,
        description: `${typeLabel} على ${entry.employee_name}`,
      },
      // CR: Penalties Payable (will be cleared when deducted from salary)
      {
        account_id: settings.default_penalties_payable_id,
        debit: 0,
        credit: amount,
        description: `${typeLabel} مستحق - ${entry.employee_name}`,
      },
    ];

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const commandId = options?.commandId
      || accountingSourceUuid(`hr-penalty:${orgId}:${entry.id}`);

    const journalEntry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: entry.entry_date,
      description,
      sourceModule: "hr_penalty",
      sourceId: entry.id,
      status: "posted",
      lines,
      commandId,
      requestId: options?.requestId || commandId,
    });

    return { success: true, journalEntryId: String(journalEntry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "HR penalty auto-posting failed";
    await logAutoPostFailure(admin, orgId, "hr_penalty", entry.id, message);
    return { success: false, error: message };
  }
}
```

#### 3.4 Clearing Entry When Payroll Runs

When the payroll is approved and deductions are applied to the payslip, the penalties payable needs to be cleared:

```typescript
// Inside autoPostPayrollMonth — after existing logic:
// Load applied manual entries for this month
const { data: appliedEntries } = await (admin as any)
  .from("employee_manual_entries")
  .select("id, amount, days, entry_type")
  .eq("org_id", orgId)
  .eq("month", `${month}-01`)
  .eq("status", "applied");

const totalPenalties = roundMoney(
  (appliedEntries || []).reduce((sum, e) => sum + Number(e.amount || 0), 0)
);

// If penalties were auto-posted individually, clear the payable during payroll:
if (totalPenalties > 0 && settings.default_penalties_payable_id) {
  // DR: Penalties Payable (clear the liability)
  lines.push({
    account_id: settings.default_penalties_payable_id,
    debit: totalPenalties,
    credit: 0,
    description: `تسوية جزاءات ${month}`,
  });
  // CR: Salary Payable (reduce what we owe the employee)
  lines.push({
    account_id: settings.default_salary_payable_id,
    debit: 0,
    credit: totalPenalties,
    description: `خصم جزاءات من الراتب ${month}`,
  });
}
```

**Net accounting effect across the cycle:**

| Step | DR | CR |
|------|----|----|
| 1. HR adds deduction | Penalties Expense | Penalties Payable |
| 2. Payroll runs (clears) | Penalties Payable | Salary Payable |
| 3. Salary paid | Salary Payable | Bank/Cash |

**Result:** Employee receives less salary; the deduction is tracked as an expense with full audit trail.

#### 3.5 Cancellation Reversal

If HR cancels a pending entry that was already auto-posted to accounting:

```typescript
export async function autoReverseManualEntry(
  admin: AdminClient,
  orgId: string,
  userId: string,
  entryId: string,
  reason: string,
  options: { commandId: string; requestId: string }
): Promise<{ success: boolean; reversalEntryId?: string; error?: string }> {
  // Look up the original journal entry by sourceModule + sourceId
  const { data: original } = await (admin as any)
    .from("accounting_journal_entries")
    .select("id")
    .eq("organization_id", orgId)
    .eq("source_module", "hr_penalty")
    .eq("source_id", entryId)
    .maybeSingle();

  if (!original) return { success: true }; // no posting to reverse

  const { reverseJournalEntry } = await import("@/lib/accounting/posting");
  const reversal = await reverseJournalEntry(
    admin, orgId, String(original.id), userId, reason, options
  );
  return { success: true, reversalEntryId: String(reversal.id) };
}
```

#### 3.6 Updated `employee_manual_entries` Table (with accounting link)

Add accounting reference columns:

```sql
ALTER TABLE public.employee_manual_entries
  ADD COLUMN IF NOT EXISTS accounting_journal_entry_id uuid
    REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_status text
    DEFAULT 'pending' CHECK (accounting_status IN ('pending', 'posted', 'reversed', 'failed', 'skipped'));
```

#### 3.7 Accounting Settings UI Update

In the accounting settings page, add a new section under the payroll accounts section:

```
┌─────────────────────────────────────────────────────┐
│  حسابات الجزاءات والخصومات                          │
│                                                     │
│  حساب مصروف الجزاءات    [▼ اختر الحساب]            │
│  حساب جزاءات مستحقة     [▼ اختر الحساب]            │
│  ☐ ترحيل تلقائي عند إضافة خصم/غياب                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### 3.8 Integration Call Points

| Where | When | What |
|-------|------|------|
| `POST /api/employees/[id]/manual-entries` | After saving entry | Call `autoPostManualEntry()` |
| `DELETE /api/employees/[id]/manual-entries/[entryId]` | On cancellation | Call `autoReverseManualEntry()` |
| `autoPostPayrollMonth()` | Payroll approved | Add clearing entries for penalties payable |
| Accounting Settings UI | Config page | Show new penalty account fields + toggle |

---

### Phase 4: UI Polish & Permissions

#### 4.1 RBAC
- Only `admin`, `hr_admin` roles can create/edit/cancel manual entries
- Employees can view their own entries (read-only)

#### 4.2 Payroll Display Updates
- In payslip breakdown, replace the "policy snapshot" section with a list of applied manual entries
- Show: entry type, amount, reason, date, who created it
- Show accounting status badge (posted/pending/failed)

#### 4.3 Notifications (optional)
- When HR adds a deduction/absence, optionally notify the employee

#### 4.4 Accounting Audit Trail
- Each manual entry shows its linked journal entry ID (clickable link to accounting)
- In accounting journal list, entries with `source_module = 'hr_penalty'` show employee name + reason

---

## Migration Strategy

1. **No data loss:** Keep `deduction_rule_groups` table and `deduction_rule_group_id` column intact
2. **Soft disable:** Set `lateDeductionHalalas = 0` and `absenceDeductionHalalas = 0` in payroll calculation
3. **New table:** Create `employee_manual_entries` via a new migration file
4. **New accounting columns:** Add penalty account settings + auto-post toggle
5. **Feature flag (optional):** Could use org-level setting to toggle between auto/manual modes

---

## File Changes Summary

| Action | File | Description |
|--------|------|-------------|
| EDIT | `src/components/forms/AddEmployeeDialog.tsx` | Remove deduction group dropdown & related imports |
| EDIT | `src/components/forms/EditEmployeeDialog.tsx` | Remove deduction group dropdown & related imports |
| EDIT | `src/lib/server/payroll.ts` | Disable auto-calculation, integrate manual entries |
| EDIT | `src/components/layout/Sidebar.tsx` | Hide deduction-rules settings link |
| EDIT | `src/lib/accounting/auto-posting.ts` | Add `autoPostManualEntry` + `autoReverseManualEntry` + payroll clearing logic |
| EDIT | `src/lib/accounting/posting-engine.ts` | Add penalty account fields to `AccountingSettings` |
| EDIT | Accounting settings page | Add penalty account selectors + toggle |
| CREATE | `db/schema_v{next}_manual_deduction_entries.sql` | New table + accounting settings columns |
| CREATE | `src/app/api/employees/[id]/manual-entries/route.ts` | CRUD API with accounting auto-post |
| CREATE | `src/components/forms/ManualEntryDialog.tsx` | UI for adding deduction/absence |
| EDIT | `src/app/(app)/payroll/page.tsx` | Update breakdown display |
| EDIT | `src/app/(app)/personnel/page.tsx` (or equivalent) | Add "manual entry" action button |

---

## Testing Checklist

### HR / Payroll
- [ ] Adding employee no longer shows deduction rule group dropdown
- [ ] Editing employee no longer shows deduction rule group dropdown
- [ ] Payroll calculation ignores deduction rule groups (late/absence = 0 from rules)
- [ ] HR can add a manual deduction with amount + reason
- [ ] HR can add a manual absence with days + reason
- [ ] Manual entries appear in payslip calculation
- [ ] Manual entries get marked as "applied" after payroll runs
- [ ] HR can cancel a pending entry before payroll runs
- [ ] Employee can see their deduction/absence history (read-only)
- [ ] Existing payslips with snapshots still display correctly (backward compatible)

### Accounting Integration
- [ ] When `auto_post_hr_penalties` is ON: adding a deduction creates a journal entry (DR Penalties Expense, CR Penalties Payable)
- [ ] When `auto_post_hr_penalties` is OFF: no journal entry created on deduction add
- [ ] Cancelling a pending entry with an existing journal entry creates a reversal entry
- [ ] Cancelling a pending entry with no journal entry does nothing in accounting
- [ ] Payroll approval creates clearing entries (DR Penalties Payable, CR Salary Payable) for applied entries
- [ ] Journal entries show correct `source_module = 'hr_penalty'` and link back to the manual entry
- [ ] Manual entry UI shows accounting status badge (posted/pending/failed)
- [ ] Accounting settings page shows new penalty account fields and toggle
- [ ] If penalty accounts not configured but toggle is ON, validation error prevents posting
- [ ] Double-posting protection: same entry ID cannot create duplicate journal entries

---

## Risks & Considerations

1. **Existing employees with rule groups:** Their `deduction_rule_group_id` stays populated but becomes inert — no deductions calculated from it
2. **Historical payslips:** Already have snapshot data stored; won't be affected
3. **Re-enablement:** If client wants to bring back automatic rules later, the infrastructure remains — just reconnect the calculation logic
4. **Absence tracking:** The attendance_records table still tracks present/absent/late — but it won't trigger automatic deductions anymore. HR must explicitly enter deductions.
