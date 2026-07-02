# Automatic Financial Flows Blueprint

## Overview

This blueprint defines the automation of all financial recording flows in the system.
Currently, most financial events require manual intervention to create GL (General Ledger) entries.
This plan converts them to **event-driven auto-posting** — when a business event occurs, the corresponding
accounting entries are created and posted automatically.

---

## Current State vs Target State

| Flow | Current | Target |
|------|---------|--------|
| Sales Log Submitted | Manual: create invoice → issue → posts | Auto: submit → journal posted |
| Payroll Generated | Manual: create draft → approve → post | Auto: approve payslips → journal posted |
| Payroll Paid | Semi-auto: record payment manually | Auto: mark paid → payment journal posted |
| Advance Approved | No GL entry | Auto: approve → disbursement journal posted |
| Advance Deducted from Salary | Partial (in payroll draft) | Auto: included in payroll posting |
| Expense Approved | Already auto-posts | No change needed |
| Expense Paid | Already auto-posts | No change needed |
| Invoice Issued | Already auto-posts | No change needed |
| Invoice Paid | Already auto-posts | No change needed |
| Payment Posted | Already auto-posts | No change needed |
| Asset Purchased | No GL entry | Auto: record asset → capitalize in GL |
| Asset Depreciation | No GL entry | Auto: monthly batch → depreciation journal |
| Leave Encashment | Not implemented | Auto: termination → encashment journal |
| End of Service Benefits | Not implemented | Auto: monthly accrual + termination settlement |

---

## Phase 1: Sales Revenue Auto-Recognition

### Trigger
When a `sales_log` is created (POST `/api/sales/log`) with status = `submitted`

### Accounting Entry
```
DR  Accounts Receivable (1100)     = grand_total (incl. VAT)
  CR  Sales Revenue (4000/product)   = subtotal (per line item)
  CR  VAT Payable (2100)             = vat_amount (if applicable)
```

### Implementation

**File:** `src/app/api/sales/log/route.ts`

After successful insert of sales_log:

1. Look up the sales company → customer link (`accounting_sales_company_links` table)
2. If no customer linked, skip auto-posting (log warning)
3. Build journal lines from `items[]`:
   - Each item → credit to product's `revenue_account_id` or default revenue account
   - VAT = 15% of subtotal (use org tax rate)
   - Single debit to AR for grand_total + VAT
4. Call `postTransaction()` from PostingEngine with template = `sales`
5. Create invoice record with `source_module = 'sales_log'`, status = `issued`
6. Store `journal_entry_id` on invoice

**New function:** `autoPostSalesLog(admin, orgId, userId, salesLog)`

**Config:** Add `auto_post_sales` boolean to `accounting_settings` (default: true)

### Edge Cases
- Sales log edited after posting → reverse original, post new (or block edits)
- Sales log deleted → reverse journal entry
- No customer linked to sales company → skip, show warning in UI

---

## Phase 2: Payroll Full Auto-Posting

### Current Flow (keep but automate)
1. Generate payslips (already exists)
2. Approve payslips → triggers accounting
3. Pay payslips → triggers payment

### Trigger A: Payroll Approval
When ALL payslips for a month are approved (or batch approval action)

### Accounting Entry (Accrual)
```
DR  Salary Expense (5000)          = total base_salary (all employees)
DR  Allowances Expense (5010)      = total allowances
DR  GOSI Expense (5020)            = employer GOSI contribution
  CR  Salary Payable (2200)          = net_salary (all employees)
  CR  GOSI Payable (2300)            = GOSI amount
  CR  Employee Advances (1200)       = advance deductions (if any)
  CR  Other Deductions Payable       = other deductions
```

### Trigger B: Payroll Payment
When payroll is marked as paid (bank transfer confirmed)

### Accounting Entry (Payment)
```
DR  Salary Payable (2200)          = total net paid
  CR  Bank Account (1010)            = total net paid
```

### Implementation

**File:** `src/app/api/accounting/[...segments]/route.ts` (payroll section)

Changes to existing flow:
1. **Remove manual draft step** — when payslips are approved, directly create & post journal
2. **New endpoint:** `POST /api/accounting/payroll/auto-post`
   - Input: `{ month: "2026-06" }`
   - Validates all payslips for month are approved
   - Aggregates: sum base_salary, allowances, deductions per type, net
   - Calls PostingEngine with payroll template
   - Returns posted journal entry
3. **Payment auto-post:** When `POST /api/accounting/payroll/record-payment` is called,
   auto-post the payment journal (this already works, keep it)

**New function:** `autoPostPayrollMonth(admin, orgId, userId, month)`

**Config:** Add `auto_post_payroll` boolean to `accounting_settings` (default: true)

### Cost Center Distribution
- Group employees by department → distribute salary expense across cost centers
- Each department gets its proportional share of salary/allowances/GOSI

### Payslip-level detail
- Store individual payslip_id references in journal line descriptions
- Enables drill-down from GL to individual employee

---

## Phase 3: Employee Advance Auto-Posting

### Trigger A: Advance Approved & Disbursed
When advance request status changes to `approved` or `partial_approved`

### Accounting Entry (Disbursement)
```
DR  Employee Advances (1200)       = approved_amount
  CR  Bank Account (1010)            = approved_amount
```

### Trigger B: Advance Deducted from Salary
Handled automatically in Phase 2 (payroll posting includes advance deductions)

### Implementation

**File:** `src/app/api/advance-requests/route.ts`

After status update to approved:
1. Get accounting settings for org
2. Build journal entry:
   - DR: `default_employee_advances_id`
   - CR: `default_bank_account_id`
3. Call PostingEngine
4. Create payment record (type='employee_advance')
5. Link journal_entry_id to advance_request (add column if needed)

**New function:** `autoPostAdvanceDisbursement(admin, orgId, userId, advanceRequest)`

**New template:** `src/lib/accounting/templates/advance-disbursement.ts`

**Config:** Add `auto_post_advances` boolean to `accounting_settings` (default: true)

---

## Phase 4: Asset Capitalization & Depreciation

### Trigger A: Asset Registered with Purchase Cost
When asset is added to inventory with `purchase_price` > 0

### Accounting Entry (Capitalization)
```
DR  Fixed Assets (1500)            = purchase_price
  CR  Accounts Payable (2000)        = purchase_price
      OR Bank (1010) if paid immediately
```

### Trigger B: Monthly Depreciation (Batch Job)
Runs on period close or manual trigger for all active depreciable assets

### Accounting Entry (Depreciation)
```
DR  Depreciation Expense (5300)    = monthly_depreciation
  CR  Accumulated Depreciation (1510) = monthly_depreciation
```

### Implementation

**Database changes:**
```sql
ALTER TABLE asset_inventory ADD COLUMN IF NOT EXISTS purchase_price numeric(14,2) DEFAULT 0;
ALTER TABLE asset_inventory ADD COLUMN IF NOT EXISTS useful_life_months integer DEFAULT 60;
ALTER TABLE asset_inventory ADD COLUMN IF NOT EXISTS salvage_value numeric(14,2) DEFAULT 0;
ALTER TABLE asset_inventory ADD COLUMN IF NOT EXISTS depreciation_method text DEFAULT 'straight_line';
ALTER TABLE asset_inventory ADD COLUMN IF NOT EXISTS capitalized_journal_id uuid REFERENCES accounting_journal_entries(id);
ALTER TABLE asset_inventory ADD COLUMN IF NOT EXISTS last_depreciation_date date;
```

**New endpoint:** `POST /api/accounting/assets/run-depreciation`
- Input: `{ month: "2026-06" }` or `{ period_id: "..." }`
- For each active asset where `purchase_price > 0`:
  - Monthly depreciation = (purchase_price - salvage_value) / useful_life_months
  - Skip if fully depreciated
  - Create single batch journal entry with lines per asset

**New function:** `autoCapitalizeAsset(admin, orgId, userId, asset)`
**New function:** `runMonthlyDepreciation(admin, orgId, userId, month)`

**Config:** Add `auto_post_assets` boolean to `accounting_settings` (default: true)

---

## Phase 5: End of Service Benefits (EOSB)

### Saudi Labor Law Calculation
- First 5 years: 15 days salary per year
- After 5 years: 30 days salary per year
- Daily rate = base_salary / 30

### Trigger A: Monthly Accrual (Provision)
Each month-end, accrue the EOSB liability increase

### Accounting Entry (Monthly Accrual)
```
DR  EOSB Expense (new: 5030)      = monthly_accrual_increment
  CR  EOSB Provision (2500)          = monthly_accrual_increment
```

### Trigger B: Employee Termination/Resignation
When employee status changes to terminated/resigned

### Accounting Entry (Settlement)
```
DR  EOSB Provision (2500)          = accrued_amount
DR  EOSB Expense (5030)            = difference (if actual > accrued)
  CR  Bank Account (1010)            = settlement_amount
```

### Implementation

**Database changes:**
```sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_type text; -- 'resignation', 'termination', 'end_of_contract'

CREATE TABLE IF NOT EXISTS eosb_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  month text NOT NULL,  -- '2026-06'
  years_of_service numeric(5,2) NOT NULL,
  daily_rate numeric(14,2) NOT NULL,
  monthly_accrual numeric(14,2) NOT NULL,
  cumulative_accrual numeric(14,2) NOT NULL,
  journal_entry_id uuid REFERENCES accounting_journal_entries(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, employee_id, month)
);
```

**New endpoints:**
- `POST /api/accounting/eosb/run-accrual` — monthly batch
- `POST /api/accounting/eosb/settle` — on termination

**New functions:**
- `calculateEOSB(baseSalary, yearsOfService, terminationType)` — Saudi labor law calc
- `runMonthlyEOSBAccrual(admin, orgId, userId, month)`
- `settleEmployeeEOSB(admin, orgId, userId, employeeId)`

**New account:** Add `5030 - مصروف مكافأة نهاية الخدمة` (EOSB Expense)

---

## Phase 6: Leave Encashment

### Trigger
When employee is terminated AND has remaining vacation balance

### Calculation
```
encashment_amount = remaining_vacation_days × (base_salary / 30)
```

### Accounting Entry
```
DR  Leave Encashment Expense (new: 5040)  = encashment_amount
  CR  Salary Payable (2200)                  = encashment_amount
```

When paid:
```
DR  Salary Payable (2200)                   = encashment_amount
  CR  Bank Account (1010)                    = encashment_amount
```

### Implementation

Integrate with Phase 5 (termination flow):
1. On termination, calculate remaining vacation days from `leave_balances`
2. Calculate encashment amount
3. Post journal entry
4. Include in final settlement payment

**New function:** `calculateLeaveEncashment(admin, orgId, employeeId)`
**New account:** Add `5040 - تعويض إجازات` (Leave Encashment Expense)

---

## Phase 7: GOSI (Social Insurance) Auto-Posting

### Trigger
Part of payroll processing (Phase 2), but broken out for clarity

### Saudi GOSI Rates
- Employee contribution: 9.75% of base salary (capped at SAR 45,000/month)
- Employer contribution: 11.75% of base salary (same cap)

### Accounting Entry (included in payroll)
```
DR  GOSI Expense - Employer (5020)   = employer_share (11.75%)
  CR  GOSI Payable (2300)              = employer_share + employee_share
  (Employee share already deducted from gross salary in payroll entry)
```

### When GOSI is paid to authority:
```
DR  GOSI Payable (2300)               = total_remitted
  CR  Bank Account (1010)              = total_remitted
```

### Implementation

Add GOSI calculation to payroll generation:
- `employee_gosi = min(base_salary, 45000) * 0.0975`
- `employer_gosi = min(base_salary, 45000) * 0.1175`
- Include in payslip deductions_details
- Include in payroll journal entry (Phase 2)

**New endpoint:** `POST /api/accounting/gosi/record-payment`
- Records GOSI remittance to authority

---

## Settings & Configuration

### New columns on `accounting_settings`:
```sql
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_sales boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_payroll boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_advances boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_assets boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS auto_post_eosb boolean DEFAULT true;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_gosi_payable_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_eosb_expense_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_eosb_provision_id uuid REFERENCES accounting_accounts(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_leave_encashment_id uuid REFERENCES accounting_accounts(id);
```

### New accounts to seed:
| Code | Name AR | Name EN | Type | Subtype |
|------|---------|---------|------|---------|
| 2300 | التأمينات الاجتماعية المستحقة | GOSI Payable | liability | current_liability |
| 2500 | مكافأة نهاية الخدمة | EOSB Provision | liability | long_term_liability |
| 5030 | مصروف مكافأة نهاية الخدمة | EOSB Expense | expense | payroll |
| 5040 | تعويض إجازات | Leave Encashment | expense | payroll |

---

## Implementation Priority & Dependencies

```
Phase 1 (Sales)      ←── No dependencies, highest business value
Phase 2 (Payroll)    ←── No dependencies, monthly recurring
Phase 3 (Advances)   ←── Depends on Phase 2 for deduction integration
Phase 7 (GOSI)       ←── Depends on Phase 2 (part of payroll)
Phase 4 (Assets)     ←── Independent, needs schema changes
Phase 5 (EOSB)       ←── Needs hire_date on employees
Phase 6 (Leave)      ←── Depends on Phase 5 (termination trigger)
```

### Recommended Order:
1. **Phase 1** — Sales auto-posting (immediate revenue recognition)
2. **Phase 2 + 7** — Payroll + GOSI (monthly necessity)
3. **Phase 3** — Advances (ties into payroll)
4. **Phase 4** — Assets (independent track)
5. **Phase 5 + 6** — EOSB + Leave (complex, lower frequency)

---

## API Changes Summary

### New Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/accounting/payroll/auto-post` | Auto-post approved payroll |
| POST | `/api/accounting/assets/capitalize` | Record asset purchase in GL |
| POST | `/api/accounting/assets/run-depreciation` | Batch monthly depreciation |
| POST | `/api/accounting/eosb/run-accrual` | Monthly EOSB accrual |
| POST | `/api/accounting/eosb/settle` | Employee EOSB settlement |
| POST | `/api/accounting/gosi/record-payment` | GOSI remittance to authority |

### Modified Endpoints
| Method | Path | Change |
|--------|------|--------|
| POST | `/api/sales/log` | Add auto-posting after insert |
| PATCH | `/api/advance-requests` | Add auto-posting on approval |
| POST | `/api/accounting/payroll/create-draft-entry` | Convert to auto-post (no draft) |

---

## Rollback Safety

Each auto-posting function:
1. Wraps in try/catch — failure does NOT block the business action
2. Logs failure to `accounting_source_postings` with status='failed'
3. Shows warning in UI: "العملية تمت بنجاح لكن القيد المحاسبي لم يُنشأ تلقائياً"
4. Admin can retry failed postings from a dashboard

### Audit Trail
All auto-posted entries include:
- `source_module` = identifying module ('sales_log', 'payroll', 'advance', 'asset_depreciation', 'eosb')
- `source_id` = reference to originating record
- Entry in `accounting_source_postings` table

---

## Testing Checklist

For each phase:
- [ ] Happy path: action → journal entry created & posted
- [ ] Duplicate prevention: same action twice → only one entry
- [ ] Failure isolation: GL failure doesn't block business action
- [ ] Reversal: undo action → reversal entry created
- [ ] Period validation: entry date within open period
- [ ] Balance validation: DR = CR
- [ ] Settings toggle: auto_post_X = false → no auto entry
- [ ] Missing config: required account not set → graceful skip with warning
