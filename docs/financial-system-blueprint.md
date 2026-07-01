# Financial System Refactor & Reporting Module Blueprint

## Scope

Refactor the financial model around the 15 operational actions and build a comprehensive reporting module on top of it.

---

## Part 1: Financial Model Refactor

### 1.1 Unified Transaction Ledger

**Problem:** Financial operations are scattered across `advance_requests`, `payslips`, `sales_logs`, `accounting_expenses`, `accounting_payments`, `accounting_invoices` — each with its own status workflow. Reporting queries must join 6+ tables to get a complete financial picture.

**Solution:** Introduce a `financial_transactions` view (or materialized view) that normalizes all 15 operational actions into a single queryable structure.

```sql
CREATE VIEW financial_transactions AS
SELECT
  id, org_id, transaction_date, transaction_type,
  direction,        -- 'inflow' | 'outflow' | 'obligation' | 'adjustment'
  amount,
  currency,
  status,           -- 'pending' | 'posted' | 'reversed'
  source_module,    -- 'payroll' | 'invoice' | 'expense' | 'advance' | 'sales' | 'asset' | 'journal'
  source_id,
  counterparty_type, -- 'employee' | 'customer' | 'vendor'
  counterparty_id,
  account_id,
  cost_center_id,
  journal_entry_id,
  created_at
FROM (
  -- UNION ALL of normalized rows from each source table
);
```

**Migration:** Non-breaking. Existing tables stay. The view aggregates them.

---

### 1.2 Operational Action Classification

Each of the 15 actions maps to a `transaction_type`:

| # | Action | transaction_type | direction |
|---|--------|-----------------|-----------|
| 1 | Record customer payment | `customer_receipt` | inflow |
| 2 | Submit sales log | `sales_revenue` | inflow |
| 3 | Approve employee advance | `advance_disbursement` | outflow |
| 4 | Generate payslip | `salary_accrual` | obligation |
| 5 | Record payroll payment | `payroll_payment` | outflow |
| 6 | Approve expense | `expense_accrual` | obligation |
| 7 | Pay expense | `expense_payment` | outflow |
| 8 | Record vendor payment | `vendor_payment` | outflow |
| 9 | Issue invoice | `invoice_issued` | obligation |
| 10 | Create financial balance | `balance_created` | obligation |
| 11 | Post journal entry | `journal_posted` | adjustment |
| 12 | Reverse journal entry | `journal_reversed` | adjustment |
| 13 | Record salary change | `salary_adjustment` | adjustment |
| 14 | Register asset | `asset_acquisition` | outflow |
| 15 | Assign/return asset | `asset_movement` | adjustment |

---

### 1.3 Posting Pipeline Refactor

**Current state:** Each module (invoice, expense, payroll) has its own journal-entry creation logic duplicated inline.

**Target state:** Single `PostingEngine` service that all modules call:

```
src/lib/accounting/
├── posting-engine.ts      -- Single entry point for all GL postings
├── templates/
│   ├── invoice.ts         -- Posting template: issue invoice
│   ├── expense.ts         -- Posting template: approve expense
│   ├── payroll.ts         -- Posting template: payroll entry
│   ├── payment.ts         -- Posting template: record payment
│   ├── advance.ts         -- Posting template: advance disbursement
│   └── sales.ts           -- Posting template: sales log → revenue
├── validation.ts          -- Balance validation, period checks
├── numbering.ts           -- Auto-numbering (unchanged)
└── reports/               -- New reporting module (Part 2)
```

Each template exports:
```ts
interface PostingTemplate {
  buildLines(source: SourceData, settings: AccountingSettings): JournalLine[];
  validate(source: SourceData): ValidationResult;
}
```

**Benefits:**
- Single place to enforce debit=credit
- Consistent audit trail
- Easy to add new posting types
- Testable in isolation

---

### 1.4 Period Control

**Add:** `accounting_periods` enforcement (table exists but not enforced).

- Block posting to closed periods
- Period-end closing process (locks period, carries forward balances)
- Opening balance entries auto-generated on period close

---

### 1.5 Currency Handling (Future-Ready)

**Add column:** `currency` (default 'SAR') to journal lines for multi-currency readiness. No conversion logic now — just store it.

---

## Part 2: Financial Reporting Module

### 2.1 Architecture

```
src/lib/accounting/reports/
├── index.ts                 -- Report registry & dispatcher
├── core/
│   ├── ledger-query.ts      -- Base GL query builder (date range, account filter, cost center)
│   ├── period-utils.ts      -- Period comparison helpers (MoM, YoY, QoQ)
│   ├── aggregator.ts        -- Sum/group/subtotal engine
│   └── formatter.ts         -- Number formatting, Arabic/English labels
├── statements/
│   ├── trial-balance.ts     -- Enhanced with comparative periods
│   ├── balance-sheet.ts     -- Enhanced with prior period comparison
│   ├── profit-loss.ts       -- Enhanced with budget variance & comparatives
│   ├── cash-flow.ts         -- NEW: Operating/Investing/Financing
│   └── equity-changes.ts    -- NEW: Statement of changes in equity
├── operational/
│   ├── ar-aging.ts          -- Receivables aging (30/60/90/120+)
│   ├── ap-aging.ts          -- Payables aging (30/60/90/120+)
│   ├── expense-analysis.ts  -- By category, cost center, vendor, trend
│   ├── revenue-analysis.ts  -- By customer, product, channel, trend
│   ├── payroll-summary.ts   -- By department, cost center, month
│   └── advance-tracking.ts  -- Outstanding, recovered, overdue
├── management/
│   ├── cost-center-pnl.ts   -- P&L per cost center / department
│   ├── budget-variance.ts   -- Budget vs actual (requires budget module)
│   ├── kpi-dashboard.ts     -- Key financial indicators
│   └── cash-position.ts     -- Daily cash position & forecast
└── export/
    ├── csv.ts               -- CSV export (exists, enhance)
    ├── pdf.ts               -- PDF generation
    └── excel.ts             -- XLSX export with formatting
```

---

### 2.2 Report Specifications

#### A. Cash Flow Statement (NEW)

**Method:** Indirect method from GL postings.

| Section | Source |
|---------|--------|
| Operating | Net income + non-cash adjustments (depreciation) + working capital changes (AR, AP, inventory) |
| Investing | Asset acquisitions, disposals |
| Financing | Equity changes, loans |

**Classification rule:** Map accounts to cash-flow categories via new `cash_flow_category` column on `accounting_accounts`.

---

#### B. Comparative Financial Statements (ENHANCED)

All core statements (P&L, Balance Sheet, Trial Balance) get:
- Current period vs prior period
- Current period vs same period last year
- Variance (amount and %)
- Trend (up/down indicator)

**API change:**
```
GET /api/accounting/reports/profit-loss?date_from=2026-01-01&date_to=2026-06-30&compare=prior_period
GET /api/accounting/reports/balance-sheet?as_of=2026-06-28&compare=prior_year
```

---

#### C. KPI Dashboard (NEW)

Real-time financial health indicators:

| KPI | Formula |
|-----|---------|
| Current Ratio | Current Assets / Current Liabilities |
| Quick Ratio | (Cash + AR) / Current Liabilities |
| Gross Profit Margin | (Revenue - COGS) / Revenue × 100 |
| Net Profit Margin | Net Profit / Revenue × 100 |
| AR Days (DSO) | (AR / Revenue) × Days in Period |
| AP Days (DPO) | (AP / Expenses) × Days in Period |
| Burn Rate | Monthly Operating Expenses |
| Runway | Cash Balance / Burn Rate |
| Revenue Growth | (Current - Prior) / Prior × 100 |
| Payroll-to-Revenue Ratio | Payroll Cost / Revenue × 100 |

---

#### D. Cost Center P&L (NEW)

Profit & Loss broken down by cost center (department, branch, project).

- Revenue allocated by cost_center_id on invoice lines
- Expenses allocated by cost_center_id on expense records and journal lines
- Shared costs allocated proportionally (configurable allocation rules)

---

#### E. AR/AP Aging (ENHANCED)

Current aging exists but is basic. Enhance with:
- Buckets: Current, 1-30, 31-60, 61-90, 90+ days
- Drill-down to individual invoices/expenses
- Aging trend over last 6 months
- Collection rate metrics

---

#### F. Expense Analysis (NEW)

- By category (account type)
- By vendor (top 10 + others)
- By cost center
- By month (trend line)
- Budget vs actual (when budget module added)

---

#### G. Revenue Analysis (NEW)

- By customer (top 10 + others)
- By product/service
- By sales channel (cost center type = sales_company)
- Monthly recurring vs one-time
- Growth rate

---

#### H. Payroll Summary (ENHANCED)

- Total cost by department
- Cost per employee (average)
- Payroll-to-revenue ratio
- Month-over-month growth
- Breakdown: base salary / allowances / deductions / net
- Advance recovery tracking integrated

---

### 2.3 Frontend - Report Viewer

**Visualization with Recharts** (already in package.json, not used in accounting):

| Report | Chart Type |
|--------|-----------|
| P&L Trend | Bar chart (revenue vs expenses by month) |
| Cash Flow | Stacked bar (operating/investing/financing) |
| KPI Dashboard | Stat cards + sparklines |
| AR/AP Aging | Stacked horizontal bar |
| Revenue Analysis | Line chart (trend) + pie (by customer) |
| Expense Analysis | Donut (by category) + bar (by month) |
| Cost Center P&L | Grouped bar chart |
| Payroll | Area chart (monthly trend) |

**New frontend pages:**
```
src/app/(app)/accounting/reports/
├── dashboard/page.tsx       -- KPI dashboard with charts
├── cash-flow/page.tsx       -- Cash flow statement
├── comparative/page.tsx     -- Side-by-side period comparison
├── cost-center/page.tsx     -- Cost center profitability
├── revenue/page.tsx         -- Revenue analysis
├── expense-analysis/page.tsx -- Expense breakdown
└── payroll-analysis/page.tsx -- Payroll insights
```

---

### 2.4 Export Capabilities

| Format | Use Case |
|--------|----------|
| CSV | Data export for spreadsheets |
| PDF | Formal financial statements for stakeholders |
| XLSX | Formatted reports with multiple sheets |

PDF generation using existing `@react-pdf/renderer` or server-side with puppeteer.

---

## Part 3: Database Changes

### 3.1 New Tables

```sql
-- Budget module (enables variance reporting)
CREATE TABLE accounting_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  status TEXT DEFAULT 'draft', -- draft, approved, closed
  created_by UUID REFERENCES org_members(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE accounting_budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES accounting_budgets(id),
  account_id UUID NOT NULL REFERENCES accounting_accounts(id),
  cost_center_id UUID REFERENCES accounting_cost_centers(id),
  month INT NOT NULL, -- 1-12
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT
);

-- Cash flow classification
ALTER TABLE accounting_accounts
  ADD COLUMN cash_flow_category TEXT; -- 'operating' | 'investing' | 'financing' | NULL
```

### 3.2 New Indexes

```sql
-- Speed up reporting queries
CREATE INDEX idx_journal_lines_date_account
  ON accounting_journal_lines(account_id, entry_date);

CREATE INDEX idx_journal_lines_cost_center
  ON accounting_journal_lines(cost_center_id) WHERE cost_center_id IS NOT NULL;

CREATE INDEX idx_journal_entries_posted
  ON accounting_journal_entries(org_id, entry_date) WHERE status = 'posted';

CREATE INDEX idx_invoices_status_date
  ON accounting_invoices(org_id, status, invoice_date);

CREATE INDEX idx_expenses_status_date
  ON accounting_expenses(org_id, status, expense_date);
```

### 3.3 Materialized View (Optional, for performance)

```sql
CREATE MATERIALIZED VIEW mv_account_balances AS
SELECT
  org_id, account_id,
  DATE_TRUNC('month', entry_date) AS period,
  SUM(debit) AS total_debit,
  SUM(credit) AS total_credit,
  SUM(debit - credit) AS net_movement
FROM accounting_journal_lines jl
JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
WHERE je.status IN ('posted', 'reversed')
GROUP BY org_id, account_id, DATE_TRUNC('month', entry_date);

-- Refresh nightly or on-demand after posting
```

---

## Part 4: API Design

### 4.1 New Endpoints

```
GET  /api/accounting/reports/cash-flow?date_from&date_to
GET  /api/accounting/reports/kpi-dashboard?as_of
GET  /api/accounting/reports/cost-center-pnl?date_from&date_to&cost_center_id
GET  /api/accounting/reports/revenue-analysis?date_from&date_to&group_by=(customer|product|channel|month)
GET  /api/accounting/reports/expense-analysis?date_from&date_to&group_by=(category|vendor|cost_center|month)
GET  /api/accounting/reports/payroll-analysis?date_from&date_to&group_by=(department|employee|month)
GET  /api/accounting/reports/budget-variance?budget_id&date_from&date_to
GET  /api/accounting/reports/comparative?report=(profit-loss|balance-sheet)&period&compare=(prior_period|prior_year)

POST /api/accounting/budgets              -- Create budget
PATCH /api/accounting/budgets/:id         -- Update budget lines
POST /api/accounting/budgets/:id/approve  -- Lock budget

POST /api/accounting/periods/:id/close    -- Close period
POST /api/accounting/reports/export       -- Export report as PDF/XLSX
```

### 4.2 Unified Report Response Shape

All reports return:

```ts
interface ReportResponse<T> {
  report_name: string;
  generated_at: string;
  period: { from: string; to: string } | { as_of: string };
  org_id: string;
  data: T;
  comparison?: T;          // Prior period data (when compare param used)
  variance?: VarianceData; // Amount & % change
  metadata: {
    currency: string;
    account_count: number;
    entry_count: number;
  };
}
```

---

## Part 5: Implementation Phases

### Phase 1: Foundation (Week 1-2)

| Task | Priority |
|------|----------|
| Create `PostingEngine` service with templates | High |
| Migrate inline posting logic to use engine | High |
| Add `cash_flow_category` to accounts table | Medium |
| Create reporting indexes | High |
| Build `ledger-query.ts` base query builder | High |
| Build `period-utils.ts` for comparatives | High |

### Phase 2: Core Reports (Week 3-4)

| Task | Priority |
|------|----------|
| Cash Flow Statement | High |
| Comparative P&L (with prior period) | High |
| Comparative Balance Sheet | High |
| KPI Dashboard calculations | High |
| Cost Center P&L | Medium |
| Enhanced AR/AP Aging | Medium |

### Phase 3: Operational Reports (Week 5-6)

| Task | Priority |
|------|----------|
| Revenue Analysis (by customer, product, month) | High |
| Expense Analysis (by category, vendor, month) | High |
| Payroll Analysis (by department, trend) | Medium |
| Advance Tracking enhanced | Low |
| Budget tables + CRUD API | Medium |

### Phase 4: Frontend & Visualization (Week 7-8)

| Task | Priority |
|------|----------|
| KPI Dashboard page with Recharts | High |
| P&L trend chart | High |
| Cash Flow chart | High |
| AR/AP aging visualization | Medium |
| Revenue/Expense charts | Medium |
| Report page navigation redesign | Medium |

### Phase 5: Export & Polish (Week 9-10)

| Task | Priority |
|------|----------|
| PDF export for statements | High |
| XLSX export with formatting | Medium |
| Budget vs Actual report | Medium |
| Materialized view for performance | Low |
| Period closing workflow | Medium |
| Financial transactions unified view | Low |

---

## Part 6: Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| View vs denormalized table | View first, materialize if slow | Non-breaking, always fresh data |
| Report computation | Server-side in Node | Keep logic near DB, cacheable |
| Charting library | Recharts (already installed) | No new dependency |
| PDF generation | Server-side puppeteer | Better Arabic support, consistent output |
| Budget module | Separate tables | Clean separation, optional feature |
| Period control | Enforce at PostingEngine level | Single enforcement point |
| Comparative logic | Query twice, diff in code | Simpler than complex SQL |
| Currency | Store column, no conversion | Future-ready without complexity |

---

## Part 7: Success Criteria

- [ ] All 15 operational actions route through PostingEngine
- [ ] Cash Flow Statement generates correctly from GL
- [ ] All core statements support comparative periods
- [ ] KPI Dashboard loads in < 2 seconds
- [ ] Reports exportable as PDF and XLSX
- [ ] Cost center profitability visible per department
- [ ] Budget vs actual variance report functional
- [ ] Period closing locks historical data
- [ ] All reports respect org_id tenant isolation
- [ ] Recharts visualizations on all report pages
