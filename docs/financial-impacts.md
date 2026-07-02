# Financial Impacts & Workflows

Complete reference for all financial transactions, auto-posting rules, and accounting workflows in the HR system.

---

## Table of Contents

1. [Sales Revenue](#1-sales-revenue)
2. [Payroll Accrual](#2-payroll-accrual)
3. [Employee Advances](#3-employee-advances)
4. [Asset Capitalization & Depreciation](#4-asset-capitalization--depreciation)
5. [End of Service Benefits (EOSB)](#5-end-of-service-benefits-eosb)
6. [Leave Encashment](#6-leave-encashment)
7. [GOSI Payment](#7-gosi-payment)
8. [Invoice Issuance](#8-invoice-issuance)
9. [Expense Recording & Payment](#9-expense-recording--payment)
10. [Payment Recording](#10-payment-recording)
11. [Financial Balances](#11-financial-balance-tracking)
12. [Auto-Posting Configuration](#12-auto-posting-configuration)
13. [Journal Entry Structure](#13-journal-entry-structure)
14. [Approval & Authorization](#14-approval--authorization)
15. [Error Handling](#15-error-handling)
16. [Source Modules](#16-source-modules)
17. [Reporting](#17-reporting)
18. [Default Account Mapping](#18-default-account-mapping)
19. [File Reference](#19-file-reference)

---

## 1. Sales Revenue

**Trigger:** Sales log submitted by sales agent (`POST /api/sales/log`)

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Accounts Receivable | grand_total |
| Credit | Sales Revenue | grand_total - vat_amount |
| Credit | VAT Payable | vat_amount (if > 0) |

**Workflow:**

```
Sales Agent submits log
       ↓
Status: "submitted"
       ↓
Auto-post fires (non-blocking)
       ↓
Journal Entry created (source: "sales_log")
       ↓
Notifications sent to managers & org admins
```

**Auto-Posting Rule:**
- Flag: `accounting_settings.auto_post_sales`
- Posts immediately on submission
- Template: `src/lib/accounting/templates/sales.ts`

---

## 2. Payroll Accrual

**Trigger:** Manual trigger via `POST /api/accounting/payroll/auto-post` with target month

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Salary Expense | total_net + advance_deductions |
| Credit | Salary Payable | total_net + advance_deductions |
| Debit | Salary Payable | advance_deductions (if > 0) |
| Credit | Employee Advances | advance_deductions (if > 0) |

**Components Captured:**
- `base_salary`
- `total_allowances` (included in total_net)
- `total_deductions` (parsed from deductions_details JSON)
- `advance_deductions` (items containing "advance" or "سلفة")
- `employer_gosi` & `employee_gosi` (tracked in payslips table)

**Workflow:**

```
Payslips created (status: "draft")
       ↓
HR reviews & approves payslips
       ↓
Status: "approved"
       ↓
Admin triggers monthly auto-post
       ↓
All approved payslips aggregated
       ↓
Single Journal Entry created (entry_date: 28th of month)
       ↓
Source: "payroll"
```

**Deduction Parsing Logic:**
- Stored in `payslips.deductions_details` as JSON array
- Advance detection: checks if label contains "advance" (case-insensitive) or "سلفة" (Arabic)
- Aggregated and offset against salary payable in GL entry

**Auto-Posting Rule:**
- Flag: `accounting_settings.auto_post_payroll`
- Requires all payslips to be in "approved" status
- Template: `src/lib/accounting/templates/payroll.ts`

---

## 3. Employee Advances

**Trigger:** Advance request approved or partially approved (`PATCH /api/advance-requests`)

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Employee Advances Receivable | approved_amount |
| Credit | Bank/Cash Account | approved_amount |

**Workflow:**

```
Employee submits advance request (with signature)
       ↓
Status: "pending"
       ↓
HR admin/manager reviews
       ↓
Decision: approved / partial_approved / rejected
       ↓
If approved:
  ├── Financial balance record created (status: "unpaid")
  ├── Auto-post fires (non-blocking)
  ├── Journal Entry created (source: "advance")
  └── Notification sent to employee
       ↓
Deductions applied via subsequent payroll cycles
       ↓
Financial balance → "paid" when fully recovered
```

**Auto-Posting Rule:**
- Flag: `accounting_settings.auto_post_advances`
- Posts immediately upon approval (non-blocking)
- Stores `journal_entry_id` reference in `advance_requests` table
- Template: `src/lib/accounting/templates/advance.ts`

---

## 4. Asset Capitalization & Depreciation

### 4A. Asset Capitalization

**Trigger:** `POST /api/accounting/assets/capitalize` (employee asset assigned with purchase price)

**Account Mapping:**

| Direction | Account | Amount | Condition |
|-----------|---------|--------|-----------|
| Debit | Fixed Assets | purchase_price | Always |
| Credit | Bank/Cash | purchase_price | If paid_immediately = true |
| Credit | Accounts Payable | purchase_price | If paid_immediately = false |

**Workflow:**

```
Asset assigned to employee with purchase price
       ↓
Capitalization triggered
       ↓
Journal Entry created (source: "asset_capitalization")
       ↓
capitalized_journal_id stored in employee_assets table
```

### 4B. Monthly Depreciation

**Trigger:** Batch job `POST /api/accounting/assets/run-depreciation` with target month

**Depreciation Calculation (Straight-Line):**

```
Monthly Depreciation = (purchase_price - salvage_value) / useful_life_months
```

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Depreciation Expense | monthly_depreciation_amount |
| Credit | Accumulated Depreciation | monthly_depreciation_amount |

**Workflow:**

```
Admin triggers monthly depreciation batch
       ↓
All active assets with purchase_price > 0 selected
       ↓
Per-asset depreciation calculated
       ↓
Single combined Journal Entry for all assets
       ↓
last_depreciation_date updated on each asset
       ↓
Source: "asset_depreciation"
```

**Auto-Posting Rule:**
- Flag: `accounting_settings.auto_post_assets`
- One combined JE for all depreciation in the period
- Schema fields: `purchase_price`, `useful_life_months`, `salvage_value`, `depreciation_method`

---

## 5. End of Service Benefits (EOSB)

### 5A. Monthly EOSB Accrual

**Trigger:** Batch job `POST /api/accounting/eosb/run-accrual` with target month

**EOSB Calculation Logic (Saudi Labor Law):**

```
Daily Rate = Base Salary / 30

Full Service Entitlement:
  Years 1-5:  15 days per year
  Year 5+:   15 days (first 5 years) + 30 days per additional year
  Formula:    (5 × 15) + ((years - 5) × 30) days × daily_rate

Resignation (Reduced):
  < 2 years:   0 (no benefit)
  2-5 years:   1/3 of calculated amount
  5-10 years:  2/3 of calculated amount
  > 10 years:  Full amount

Termination / End of Contract:
  Full calculated amount
```

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | EOSB Expense | monthly_accrual |
| Credit | EOSB Provision | monthly_accrual |

*monthly_accrual = current_month_EOSB - previous_month_EOSB*

**Workflow:**

```
Admin triggers monthly EOSB accrual batch
       ↓
All active employees with hiring_date selected
       ↓
Per-employee EOSB calculated based on tenure
       ↓
Monthly increment = current_total - last_cumulative
       ↓
Recorded in eosb_accruals table
       ↓
Combined Journal Entry (entry_date: 28th of month)
       ↓
Source: "eosb"
```

**Tracking (eosb_accruals table):**
- `years_of_service`, `daily_rate`
- `monthly_accrual`, `cumulative_accrual`
- `journal_entry_id` reference
- UNIQUE constraint prevents duplicate accruals per employee/month

### 5B. EOSB Settlement

**Trigger:** Employee terminated via `POST /api/accounting/eosb/settle`

**Account Mapping:**

| Direction | Account | Amount | Condition |
|-----------|---------|--------|-----------|
| Debit | EOSB Provision | min(accruedAmount, settlementAmount) | If accrued > 0 |
| Debit | EOSB Expense | settlementAmount - accruedAmount | If settlement > accrued |
| Credit | Bank/Cash | settlementAmount | Always |

**Workflow:**

```
Employee termination processed
       ↓
Settlement amount calculated based on termination_type
       ↓
Compared against cumulative accrual
       ↓
Difference (if any) charged to EOSB Expense
       ↓
Accrued portion reversed from EOSB Provision
       ↓
Payment issued from Bank/Cash
       ↓
Source: "eosb_settlement"
```

**Auto-Posting Rule:**
- Flag: `accounting_settings.auto_post_eosb`
- Applies to both monthly accrual and settlement

---

## 6. Leave Encashment

**Trigger:** `POST /api/accounting/leave-encashment` (typically at termination or leave payout)

**Calculation:**

```
Encashment Amount = vacation_remaining_days × (base_salary / 30)
```

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Leave Encashment Expense | encashment_amount |
| Credit | Salary Payable | encashment_amount |

*Note: Leave Encashment Expense defaults to Salary Expense account if `default_leave_encashment_id` not set.*

**Workflow:**

```
Leave encashment requested (usually at termination)
       ↓
Employee's base_salary and vacation_remaining looked up
       ↓
Encashment calculated
       ↓
Journal Entry created with leave days in description
       ↓
Source: "leave_encashment"
```

---

## 7. GOSI Payment

**Trigger:** Manual entry via `POST /api/accounting/gosi/record-payment` with month and amount

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | GOSI Payable | total_amount |
| Credit | Bank/Cash | total_amount |

**Workflow:**

```
GOSI contributions accrued during payroll posting
  ├── employee_gosi (employee contribution)
  └── employer_gosi (employer contribution)
       ↓
Actual payment made to GOSI authority
       ↓
Admin records payment manually
       ↓
Journal Entry created (source: "gosi_payment")
```

---

## 8. Invoice Issuance

**Trigger:** Invoice status changes to "issued" via `POST/PATCH /api/accounting/invoices`

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Accounts Receivable | total_amount |
| Credit | Sales Revenue | total_amount - vat_amount |
| Credit | VAT Payable | vat_amount (if > 0) |

*Revenue recognized by line item - each line can have its own `revenue_account_id`. Lines using the same account are aggregated.*

**Workflow:**

```
Invoice created (status: "draft")
       ↓
Line items added with amounts, VAT, account mappings
       ↓
Invoice issued (status: "issued")
       ↓
Journal Entry created automatically
       ↓
journal_entry_id stored on invoice record
       ↓
Source: "invoice"
```

---

## 9. Expense Recording & Payment

### 9A. Expense Accrual

**Trigger:** Expense approved via `POST/PATCH /api/accounting/expenses`

**Account Mapping:**

| Direction | Account | Amount | Condition |
|-----------|---------|--------|-----------|
| Debit | Expense Category | amount_before_vat | Always |
| Debit | VAT Recoverable | vat_amount | If VAT > 0 |
| Credit | Accounts Payable | total_amount | If not paid immediately |
| Credit | Bank/Cash | total_amount | If paid immediately |

**Workflow:**

```
Expense created (status: "draft")
       ↓
Submitted for approval (status: "pending_approval")
       ↓
Finance manager approves (status: "approved")
       ↓
Journal Entry created
       ↓
Source: "expense"
```

### 9B. Expense Payment

**Trigger:** Payment recorded for approved expense via `/api/accounting/payments`

**Account Mapping:**

| Direction | Account | Amount |
|-----------|---------|--------|
| Debit | Accounts Payable | payment_amount |
| Credit | Bank/Cash | payment_amount |

**Status Lifecycle:**

```
draft → pending_approval → approved → paid
```

---

## 10. Payment Recording

**Unified template covering all payment types:**

| Payment Type | Direction | Debit | Credit |
|--------------|-----------|-------|--------|
| customer_receipt | Inbound | Bank/Cash | Accounts Receivable |
| vendor_payment | Outbound | Accounts Payable | Bank/Cash |
| payroll_payment | Outbound | Salary Payable | Bank/Cash |
| employee_advance | Outbound | Employee Advances | Bank/Cash |
| manual | Flexible | Custom | Custom |

**Workflow:**

```
Payment submitted with type & counterpart
       ↓
Account mappings resolved based on payment type
       ↓
Journal Entry created
       ↓
Source: "payment_{type}"
```

---

## 11. Financial Balance Tracking

Tracks employee-level financial obligations across time.

**Balance Types:**
- `deficit` - Overpayment / negative balance
- `loan` - Long-term employee loan
- `advance_payment` - Approved advance request

**Status:**
- `unpaid` - Balance outstanding
- `paid` - Fully settled

**Lifecycle:**

```
Advance approved → balance created (status: "unpaid")
       ↓
Deductions applied each payroll cycle
       ↓
Balance reduced progressively
       ↓
Fully recovered → status: "paid"
```

---

## 12. Auto-Posting Configuration

**Flags in `accounting_settings` table:**

| Flag | Controls | Default |
|------|----------|---------|
| `auto_post_sales` | Sales revenue posting on log submission | true |
| `auto_post_payroll` | Payroll accrual posting | true |
| `auto_post_advances` | Advance disbursement posting on approval | true |
| `auto_post_assets` | Asset capitalization & depreciation | true |
| `auto_post_eosb` | EOSB accrual & settlement | true |

**Behavior When Disabled:**
- Business operations proceed normally
- No GL entries created automatically
- Manual journal entries can still be posted
- Can be re-enabled and historical postings triggered manually

---

## 13. Journal Entry Structure

**Journal Entry (`accounting_journal_entries`):**

| Field | Description |
|-------|-------------|
| `entry_no` | Sequential (e.g., JE-000001) |
| `entry_date` | Transaction date |
| `status` | draft / pending_approval / posted / reversed / cancelled |
| `source_module` | Origin system (payroll, sales_log, etc.) |
| `source_id` | Reference to source record |
| `total_debit` | Must equal total_credit |
| `total_credit` | Must equal total_debit |
| `currency` | SAR (Saudi Riyal) |
| `created_by` | Audit: who created |
| `approved_by` | Audit: who approved |
| `posted_by` | Audit: who posted |
| `reversed_by` | Audit: who reversed |

**Journal Lines (`accounting_journal_lines`):**

| Field | Description |
|-------|-------------|
| `account_id` | GL account reference |
| `debit` | Debit amount (never both debit & credit) |
| `credit` | Credit amount (never both debit & credit) |
| `description` | Line-level detail |
| `cost_center_id` | Optional allocation |
| `employee_id` | Context tracking |
| `department_id` | Context tracking |
| `location_id` | Context tracking |

---

## 14. Approval & Authorization

**Journal Entry Status Flow:**

```
draft
  ↓ (submit for approval)
pending_approval
  ↓ (finance manager approves)
posted (immutable - cannot be edited)
  ↓ (if error discovered)
reversed (creates reversing entry, original stays intact)

draft → cancelled (if never submitted)
```

**Role Permissions:**

| Action | Roles |
|--------|-------|
| View | admin, finance_manager, accountant, finance_viewer |
| Manage (create/edit) | admin, finance_manager, accountant |
| Post | admin, finance_manager, accountant |
| Settings | admin, finance_manager |

---

## 15. Error Handling

**Non-Blocking Auto-Post Pattern:**

All auto-posting operations are non-blocking - business operations continue regardless of GL posting success.

```
Business action triggers auto-post
       ↓
Attempt GL entry creation
       ↓
Success → journal_entry_id stored on source record
       ↓
Failure → logged to accounting_source_postings (status: "failed")
         Business action still succeeds
         Can be retried manually later
```

**Failure Tracking (`accounting_source_postings`):**
- Records all auto-post attempts
- Status: "success" or "failed"
- Error details captured for debugging
- If logging itself fails, silently ignored (truly non-blocking)

---

## 16. Source Modules

Every journal entry tracks its origin for audit trail:

| Source Module | Origin |
|--------------|--------|
| `sales_log` | Sales revenue recognition |
| `payroll` | Monthly payroll accrual |
| `advance` | Advance disbursement |
| `asset_capitalization` | Fixed asset purchase |
| `asset_depreciation` | Monthly depreciation batch |
| `eosb` | EOSB monthly accrual |
| `eosb_settlement` | EOSB terminal settlement |
| `leave_encashment` | Unused leave payout |
| `gosi_payment` | Social insurance payment |
| `invoice` | Customer invoice issuance |
| `expense` | Expense accrual |
| `expense_paid` | Expense payment |
| `payment_customer_receipt` | Cash inbound |
| `payment_vendor_payment` | Vendor cash outbound |
| `payment_payroll_payment` | Salary payment |
| `payment_employee_advance` | Advance disbursement payment |
| `payment_manual` | Manual journal entry |
| `manual` | User-created journal entry |

---

## 17. Reporting

**Available Financial Reports:**

| Report | Description |
|--------|-------------|
| Trial Balance | All account balances at a point in time |
| General Ledger | Detailed transactions per account |
| Balance Sheet | Assets, Liabilities, Equity snapshot |
| P&L Statement | Revenue vs Expenses for a period |
| Cash Flow Statement | Cash inflows and outflows |
| AR Aging | Outstanding receivables by age |
| AP Aging | Outstanding payables by age |
| Employee Advances | Outstanding employee balances |
| Payroll Cost | Salary & benefits expense breakdown |
| VAT Report | VAT collected vs recoverable |
| Cost Center P&L | Profit/Loss by cost center |
| Budget Variance | Actual vs budgeted amounts |

**Cost Center Dimensions:**
- Department
- Location
- Project
- Sales Company
- Branch
- Channel
- Custom

**Financial Transactions Unified View (`financial_transactions` table):**
- Aggregates all GL postings
- Classifies by `transaction_type` (invoice_issued, salary_accrual, etc.)
- Classifies by `direction` (inflow, outflow, obligation, adjustment)
- Enables cross-module reporting

---

## 18. Default Account Mapping

All default accounts configured in `accounting_settings`:

| Setting Key | Purpose |
|-------------|---------|
| `default_cash_account_id` | Cash on hand |
| `default_bank_account_id` | Primary bank account |
| `default_accounts_receivable_id` | Customer receivables |
| `default_accounts_payable_id` | Vendor payables |
| `default_sales_revenue_id` | Sales income |
| `default_vat_payable_id` | VAT output (collected) |
| `default_vat_receivable_id` | VAT input (recoverable) |
| `default_salary_expense_id` | Salary costs |
| `default_salary_payable_id` | Salaries owed to employees |
| `default_employee_advances_id` | Advances receivable from employees |
| `default_asset_account_id` | Fixed assets |
| `default_depreciation_expense_id` | Depreciation costs |
| `default_accumulated_depreciation_id` | Contra-asset for depreciation |
| `default_gosi_payable_id` | GOSI contributions owed |
| `default_gosi_expense_id` | GOSI employer costs |
| `default_eosb_expense_id` | EOSB periodic expense |
| `default_eosb_provision_id` | EOSB liability provision |
| `default_leave_encashment_id` | Leave payout expense |
| `default_allowances_expense_id` | Employee allowances |

---

## 19. File Reference

| Component | Path |
|-----------|------|
| Auto-posting Engine | `src/lib/accounting/auto-posting.ts` |
| Posting Engine (Core) | `src/lib/accounting/posting-engine.ts` |
| Sales Template | `src/lib/accounting/templates/sales.ts` |
| Payroll Template | `src/lib/accounting/templates/payroll.ts` |
| Advance Template | `src/lib/accounting/templates/advance.ts` |
| Expense Template | `src/lib/accounting/templates/expense.ts` |
| Invoice Template | `src/lib/accounting/templates/invoice.ts` |
| Payment Template | `src/lib/accounting/templates/payment.ts` |
| Accounting Service | `src/lib/services/accounting.ts` |
| Main API Route | `src/app/api/accounting/[...segments]/route.ts` |
| Advance Requests API | `src/app/api/advance-requests/route.ts` |
| Sales Log API | `src/app/api/sales/log/route.ts` |
| Reports Library | `src/lib/accounting/reports/` |
| Financial Reporting Schema | `db/schema_v43_financial_reporting.sql` |
| Auto-posting Schema | `db/schema_v44_auto_financial_flows.sql` |

---

## Summary: All Financial Impacts at a Glance

| # | Financial Impact | Trigger | Debit | Credit | Auto-post | Blocking |
|---|------------------|---------|-------|--------|-----------|----------|
| 1 | Sales Revenue | Sales log submitted | AR | Sales Rev + VAT | Yes | No |
| 2 | Payroll Accrual | Month-end batch | Salary Exp | Salary Pay | Yes | No |
| 3 | Advance Disbursement | Advance approved | Emp Advances | Bank/Cash | Yes | No |
| 4a | Asset Capitalize | Asset assigned | Fixed Assets | Bank/AP | Yes | No |
| 4b | Asset Depreciation | Monthly batch | Depr Exp | Accum Depr | Yes | No |
| 5a | EOSB Accrual | Monthly batch | EOSB Exp | EOSB Provision | Yes | No |
| 5b | EOSB Settlement | Employee terminated | EOSB Prov + Exp | Bank/Cash | Yes | No |
| 6 | Leave Encashment | On-demand / termination | Leave Exp | Salary Pay | Manual | No |
| 7 | GOSI Payment | Manual recording | GOSI Payable | Bank/Cash | Manual | No |
| 8 | Invoice Issuance | Invoice issued | AR | Sales Rev + VAT | On status change | No |
| 9 | Expense Recording | Expense approved | Exp Cat + VAT | AP / Bank | On approval | No |
| 10 | Payment Recording | Payment submitted | Varies by type | Bank/Cash | On submit | No |
