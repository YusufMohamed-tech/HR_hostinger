# Accounting Module Phase 2 - Implementation Blueprint

**Date:** 2026-08-03
**Status:** Proposed
**Module:** Accounting & Finance

---

## Table of Contents

1. [Feature 1: Customer & Vendor Permissions](#feature-1-customer--vendor-permissions)
2. [Feature 2: Cost Center Column in General Ledger](#feature-2-cost-center-column-in-general-ledger)
3. [Feature 3: Banking Module](#feature-3-banking-module)
4. [Feature 4: Configurable Ledger/Journal Types](#feature-4-configurable-ledgerjournal-types)
5. [Feature 5: Searchable Account Selection](#feature-5-searchable-account-selection)
6. [Feature 6: Journal Entry Attachments](#feature-6-journal-entry-attachments)
7. [Migration Summary](#migration-summary)
8. [Implementation Order & Dependencies](#implementation-order--dependencies)

---

## Feature 1: Customer & Vendor Permissions

### Objective

Grant dedicated permissions for creating, editing, viewing, and deleting Customers and Vendors, separate from the general accounting access.

### Current State

- Customers/Vendors pages exist at `/accounting/customers` and `/accounting/vendors`
- Access controlled by `requireAccountingAccess("manage")` which bundles all write operations together
- Roles with access: `finance_manager`, `accountant`, `super_admin`, `admin`
- No granular permission for party management vs journal posting

### Database Changes

**Migration:** `db/schema_v162_customer_vendor_permissions.sql`

```sql
-- Add granular permission actions to the accounting permissions system
-- Extend the accounting_permissions concept with party-specific actions

CREATE TABLE IF NOT EXISTS accounting_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  permission text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, role, permission)
);

ALTER TABLE accounting_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON accounting_role_permissions
  FOR ALL USING (org_id = current_org_id());

-- Seed default permissions matching current behavior
INSERT INTO accounting_role_permissions (org_id, role, permission)
SELECT o.id, r.role, p.permission
FROM organizations o
CROSS JOIN (VALUES
  ('super_admin'), ('admin'), ('finance_manager'), ('accountant')
) AS r(role)
CROSS JOIN (VALUES
  ('customers:view'), ('customers:create'), ('customers:edit'), ('customers:delete'),
  ('vendors:view'), ('vendors:create'), ('vendors:edit'), ('vendors:delete')
) AS p(permission)
ON CONFLICT DO NOTHING;

-- Grant view-only to finance_viewer and sales roles
INSERT INTO accounting_role_permissions (org_id, role, permission)
SELECT o.id, r.role, p.permission
FROM organizations o
CROSS JOIN (VALUES ('finance_viewer'), ('sales'), ('sales_manager')) AS r(role)
CROSS JOIN (VALUES ('customers:view'), ('vendors:view')) AS p(permission)
ON CONFLICT DO NOTHING;
```

### Backend Changes

**File:** `src/lib/accounting/permissions.ts`

Add new permission actions:

```typescript
type PartyAction =
  | "customers:view"
  | "customers:create"
  | "customers:edit"
  | "customers:delete"
  | "vendors:view"
  | "vendors:create"
  | "vendors:edit"
  | "vendors:delete";

export async function requirePartyAccess(action: PartyAction): Promise<TenantAuthContext> {
  const ctx = await requireTenantContext({ capabilities: [] });
  
  const { data } = await supabase
    .from("accounting_role_permissions")
    .select("permission")
    .eq("org_id", ctx.orgId)
    .eq("role", ctx.role)
    .eq("permission", action)
    .single();

  if (!data) {
    throw new ForbiddenError(`Missing permission: ${action}`);
  }

  return ctx;
}
```

**File:** `src/app/api/accounting/[...segments]/route.ts`

Update the customer/vendor command handlers to use `requirePartyAccess`:

```typescript
// Before dispatching customer commands:
case "customers":
  if (method === "GET") await requirePartyAccess("customers:view");
  if (method === "POST") await requirePartyAccess("customers:create");
  if (method === "PATCH") await requirePartyAccess("customers:edit");
  if (method === "DELETE") await requirePartyAccess("customers:delete");
  break;

case "vendors":
  if (method === "GET") await requirePartyAccess("vendors:view");
  if (method === "POST") await requirePartyAccess("vendors:create");
  if (method === "PATCH") await requirePartyAccess("vendors:edit");
  if (method === "DELETE") await requirePartyAccess("vendors:delete");
  break;
```

### Frontend Changes

**File:** `src/app/(app)/accounting/customers/page.tsx`

- Conditionally render Create/Edit/Delete buttons based on user permissions
- Fetch user permissions on page load via `/api/accounting/permissions/me`

**New API endpoint:** `/api/accounting/permissions/me`

Returns the current user's accounting permissions list for client-side UI gating.

### Settings UI

**File:** `src/app/(app)/accounting/settings/permissions/page.tsx` (new)

- Admin-facing page to configure which roles get which party permissions
- Table: Roles (rows) x Permissions (columns) with toggle switches
- Only accessible to `super_admin`, `admin`, `finance_manager`

---

## Feature 2: Cost Center Column in General Ledger

### Objective

Add a dedicated Cost Center column to the General Ledger report, allowing users to filter and group by cost center for improved financial analysis.

### Current State

- Cost centers exist in `accounting_cost_centers` table (from schema_v113)
- Journal lines already have a `cost_center_id` column
- `aggregateByCostCenter()` helper exists in `src/lib/accounting/reports/core/ledger-query.ts`
- The GL report page does NOT display cost center as a visible column

### Database Changes

No schema changes required -- data model already supports cost centers on journal lines.

### Backend Changes

**File:** `src/lib/accounting/reports/core/ledger-query.ts`

Update `queryLedger` to JOIN cost center names:

```typescript
// Add to the select query in queryLedger:
const query = supabase
  .from("accounting_journal_lines")
  .select(`
    *,
    account:accounting_accounts(code, name_ar, name_en),
    cost_center:accounting_cost_centers(code, name_ar, name_en)
  `)
  .eq("org_id", orgId)
  .eq("status", "posted");
```

**File:** `src/lib/accounting/reports.ts`

Update `getGeneralLedger` response shape to include cost center:

```typescript
interface GeneralLedgerLine {
  // ...existing fields
  cost_center_code: string | null;
  cost_center_name: string | null;
}
```

Add cost center filter parameter:

```typescript
interface GeneralLedgerParams {
  // ...existing
  cost_center_id?: string;
  group_by_cost_center?: boolean;
}
```

### Frontend Changes

**File:** `src/app/(app)/accounting/reports/general-ledger/page.tsx`

1. **Add Cost Center column to the table:**

```tsx
<TableHead>مركز التكلفة / Cost Center</TableHead>
// ...
<TableCell>{line.cost_center_name || "—"}</TableCell>
```

2. **Add Cost Center filter dropdown:**

```tsx
<Select value={costCenterId} onValueChange={setCostCenterId}>
  <SelectTrigger><SelectValue placeholder="All Cost Centers" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="all">الكل / All</SelectItem>
    {costCenters.map(cc => (
      <SelectItem key={cc.id} value={cc.id}>
        {cc.code} - {cc.name_ar}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

3. **Add Group-by-Cost-Center toggle:**

When enabled, inserts subtotal rows per cost center with debit/credit sums.

### CSV Export

**File:** `src/lib/accounting/reports/export/csv.ts`

Add `cost_center_code` and `cost_center_name` columns to the GL CSV export template.

---

## Feature 3: Banking Module

### Objective

Build a dedicated Banking Module that supports:
- Bank account management
- Bank statement import (CSV, MT940, CAMT.053)
- Transaction matching and reconciliation
- Bank reconciliation reports

### Database Changes

**Migration:** `db/schema_v163_banking_module.sql`

```sql
-- Bank Accounts
CREATE TABLE IF NOT EXISTS banking_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  iban text,
  swift_code text,
  currency text NOT NULL DEFAULT 'SAR',
  linked_account_id uuid REFERENCES accounting_accounts(id),
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  opening_balance_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(org_id, account_number)
);

ALTER TABLE banking_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON banking_accounts
  FOR ALL USING (org_id = current_org_id());

-- Bank Statements (imported files)
CREATE TABLE IF NOT EXISTS banking_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES banking_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_balance numeric(18,2) NOT NULL,
  closing_balance numeric(18,2) NOT NULL,
  file_path text,
  file_name text,
  import_format text NOT NULL DEFAULT 'csv', -- csv, mt940, camt053
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported', 'in_progress', 'reconciled')),
  transaction_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  UNIQUE(org_id, bank_account_id, statement_date)
);

ALTER TABLE banking_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON banking_statements
  FOR ALL USING (org_id = current_org_id());

-- Bank Statement Lines (individual transactions)
CREATE TABLE IF NOT EXISTS banking_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL REFERENCES banking_statements(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  value_date date,
  description text NOT NULL,
  reference text,
  amount numeric(18,2) NOT NULL, -- positive = credit, negative = debit
  running_balance numeric(18,2),
  transaction_type text, -- transfer, cheque, fee, interest, etc.
  payee text,
  match_status text NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'manually_matched', 'excluded')),
  matched_journal_line_id uuid REFERENCES accounting_journal_lines(id),
  matched_at timestamptz,
  matched_by uuid REFERENCES auth.users(id),
  match_confidence numeric(3,2), -- 0.00 to 1.00 for auto-match
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE banking_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON banking_statement_lines
  FOR ALL USING (org_id = current_org_id());

CREATE INDEX idx_banking_lines_statement ON banking_statement_lines(statement_id);
CREATE INDEX idx_banking_lines_match ON banking_statement_lines(match_status);
CREATE INDEX idx_banking_lines_date ON banking_statement_lines(org_id, transaction_date);

-- Reconciliation Sessions
CREATE TABLE IF NOT EXISTS banking_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES banking_accounts(id),
  statement_id uuid REFERENCES banking_statements(id),
  reconciliation_date date NOT NULL,
  statement_balance numeric(18,2) NOT NULL,
  ledger_balance numeric(18,2) NOT NULL,
  difference numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed', 'approved')),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE banking_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON banking_reconciliations
  FOR ALL USING (org_id = current_org_id());
```

### Backend Changes

**New directory:** `src/lib/banking/`

```
src/lib/banking/
  index.ts              -- module exports
  accounts.ts           -- CRUD for bank accounts
  import/
    csv-parser.ts       -- CSV statement parser (configurable column mapping)
    mt940-parser.ts     -- SWIFT MT940 format parser
    camt053-parser.ts   -- ISO 20022 CAMT.053 XML parser
    normalizer.ts       -- Normalize parsed data to banking_statement_lines shape
  matching/
    auto-match.ts       -- Rule-based automatic matching engine
    match-rules.ts      -- Configurable matching rules (amount, date, reference)
    suggestions.ts      -- Suggest potential matches for unmatched lines
  reconciliation.ts     -- Reconciliation session management
  reports.ts            -- Bank reconciliation report generation
```

**Auto-Match Engine** (`src/lib/banking/matching/auto-match.ts`):

```typescript
interface MatchRule {
  field: "amount" | "reference" | "date" | "description";
  strategy: "exact" | "fuzzy" | "range";
  weight: number; // 0-1 contribution to confidence score
}

const DEFAULT_RULES: MatchRule[] = [
  { field: "amount", strategy: "exact", weight: 0.4 },
  { field: "date", strategy: "range", weight: 0.2 },   // +/- 3 days
  { field: "reference", strategy: "fuzzy", weight: 0.3 },
  { field: "description", strategy: "fuzzy", weight: 0.1 },
];

export async function autoMatchStatement(
  orgId: string,
  statementId: string,
  options?: { confidenceThreshold?: number; rules?: MatchRule[] }
): Promise<{ matched: number; unmatched: number }>;
```

**Statement Import Flow:**

1. User uploads file via `/api/banking/statements/import`
2. Server detects format (CSV/MT940/CAMT.053) based on content/extension
3. Parser extracts transactions into normalized format
4. Lines inserted into `banking_statement_lines`
5. Auto-match engine runs, matching lines above confidence threshold
6. Remaining unmatched lines presented for manual matching

**API Routes:** `src/app/api/banking/[...segments]/route.ts`

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/banking/accounts` | List bank accounts |
| POST | `/api/banking/accounts` | Create bank account |
| PATCH | `/api/banking/accounts/:id` | Update bank account |
| DELETE | `/api/banking/accounts/:id` | Deactivate bank account |
| POST | `/api/banking/statements/import` | Import statement file |
| GET | `/api/banking/statements` | List statements |
| GET | `/api/banking/statements/:id` | Get statement with lines |
| POST | `/api/banking/statements/:id/auto-match` | Run auto-matching |
| POST | `/api/banking/statements/:id/match` | Manual match line to journal |
| POST | `/api/banking/statements/:id/unmatch` | Unmatch a line |
| POST | `/api/banking/statements/:id/exclude` | Exclude a line |
| GET | `/api/banking/reconciliations` | List reconciliations |
| POST | `/api/banking/reconciliations` | Start reconciliation |
| PATCH | `/api/banking/reconciliations/:id` | Update/complete reconciliation |
| GET | `/api/banking/reconciliations/:id/report` | Generate reconciliation report |

### Frontend Changes

**New pages:**

```
src/app/(app)/banking/
  page.tsx                              -- Dashboard: accounts overview + recent statements
  accounts/
    page.tsx                            -- Bank accounts list
    new/page.tsx                        -- Create bank account form
    [id]/page.tsx                       -- Bank account detail + statement history
  statements/
    page.tsx                            -- Statements list
    import/page.tsx                     -- Import wizard (upload, preview, confirm)
    [id]/page.tsx                       -- Statement detail with matching UI
  reconciliation/
    page.tsx                            -- Reconciliation list
    [id]/page.tsx                       -- Reconciliation workspace
  reports/
    page.tsx                            -- Bank reconciliation report
```

**Statement Matching UI** (key component):

Two-panel layout:
- **Left panel:** Bank statement lines (date, description, amount, status)
- **Right panel:** System journal entries (filtered by bank account, date range)
- **Actions:** Click to match, drag-and-drop matching, bulk auto-match button
- **Status indicators:** Green (matched), Yellow (suggested), Red (unmatched), Gray (excluded)

**Reconciliation Report:**

| Section | Content |
|---------|---------|
| Header | Bank name, account, period, preparer |
| Balance per Bank | Closing balance from statement |
| Add: Outstanding Deposits | System deposits not yet on statement |
| Less: Outstanding Cheques | System payments not yet on statement |
| Adjusted Bank Balance | Calculated |
| Balance per Books | Ledger balance for linked account |
| Add/Less: Adjustments | Unrecorded bank charges, interest, errors |
| Adjusted Book Balance | Should equal Adjusted Bank Balance |
| Difference | Must be zero for approved reconciliation |

### Permissions

Add to `src/lib/accounting/permissions.ts`:

```typescript
type BankingAction = "banking:view" | "banking:manage" | "banking:import" | "banking:reconcile" | "banking:approve";
```

Default access: `finance_manager` (all), `accountant` (view, manage, import, reconcile), `finance_viewer` (view only).

### Navigation

Add "Banking" section to the accounting sidebar in `src/components/accounting/AccountingLayout.tsx` (or equivalent):

```
Banking
  ├── Dashboard
  ├── Bank Accounts
  ├── Statements
  ├── Reconciliation
  └── Reports
```

---

## Feature 4: Configurable Ledger/Journal Types

### Objective

Allow organizations to define multiple journal types (e.g., General Journal, Sales Journal, Purchase Journal, Cash Receipts, Cash Payments, Payroll Journal), each with its own naming convention and independent auto-numbering sequence.

### Current State

- Journal entries use a single `journal_number` field with format `JV-YYYYMM-XXXX`
- Auto-numbering handled by PostgreSQL sequence or application logic in `createJournalEntry`
- No concept of journal "type" beyond the template used during posting

### Database Changes

**Migration:** `db/schema_v164_journal_types.sql`

```sql
-- Journal Types Configuration
CREATE TABLE IF NOT EXISTS accounting_journal_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,           -- e.g., 'GJ', 'SJ', 'PJ', 'CR', 'CP', 'PY'
  name_ar text NOT NULL,
  name_en text,
  description text,
  prefix text NOT NULL,         -- e.g., 'GJ', 'SJ', 'PJ'
  number_format text NOT NULL DEFAULT '{PREFIX}-{YYYY}{MM}-{SEQ}',
  -- Tokens: {PREFIX}, {YYYY}, {YY}, {MM}, {DD}, {SEQ}, {SEQ:N} (N = zero-pad width)
  sequence_reset text NOT NULL DEFAULT 'monthly'
    CHECK (sequence_reset IN ('never', 'yearly', 'monthly')),
  current_sequence integer NOT NULL DEFAULT 0,
  sequence_year integer,        -- year of current sequence (for yearly/monthly reset)
  sequence_month integer,       -- month of current sequence (for monthly reset)
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  allowed_roles text[] DEFAULT '{}', -- empty = all roles with journal access
  requires_approval boolean NOT NULL DEFAULT false,
  auto_post boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, code)
);

ALTER TABLE accounting_journal_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON accounting_journal_types
  FOR ALL USING (org_id = current_org_id());

-- Add journal_type_id to journal entries
ALTER TABLE accounting_journal_entries
  ADD COLUMN IF NOT EXISTS journal_type_id uuid REFERENCES accounting_journal_types(id);

-- Function to generate next journal number
CREATE OR REPLACE FUNCTION accounting_next_journal_number(
  p_org_id uuid,
  p_type_id uuid,
  p_date date DEFAULT CURRENT_DATE
) RETURNS text AS $$
DECLARE
  v_type accounting_journal_types%ROWTYPE;
  v_seq integer;
  v_result text;
  v_year integer := EXTRACT(YEAR FROM p_date);
  v_month integer := EXTRACT(MONTH FROM p_date);
BEGIN
  SELECT * INTO v_type FROM accounting_journal_types
    WHERE id = p_type_id AND org_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal type not found';
  END IF;

  -- Reset sequence if period changed
  IF v_type.sequence_reset = 'monthly' AND
     (v_type.sequence_year IS DISTINCT FROM v_year OR
      v_type.sequence_month IS DISTINCT FROM v_month) THEN
    v_seq := 1;
    UPDATE accounting_journal_types SET
      current_sequence = 1, sequence_year = v_year, sequence_month = v_month,
      updated_at = now()
    WHERE id = p_type_id;
  ELSIF v_type.sequence_reset = 'yearly' AND
        v_type.sequence_year IS DISTINCT FROM v_year THEN
    v_seq := 1;
    UPDATE accounting_journal_types SET
      current_sequence = 1, sequence_year = v_year, sequence_month = v_month,
      updated_at = now()
    WHERE id = p_type_id;
  ELSE
    v_seq := v_type.current_sequence + 1;
    UPDATE accounting_journal_types SET
      current_sequence = v_seq, updated_at = now()
    WHERE id = p_type_id;
  END IF;

  -- Format the number
  v_result := v_type.number_format;
  v_result := REPLACE(v_result, '{PREFIX}', v_type.prefix);
  v_result := REPLACE(v_result, '{YYYY}', LPAD(v_year::text, 4, '0'));
  v_result := REPLACE(v_result, '{YY}', LPAD((v_year % 100)::text, 2, '0'));
  v_result := REPLACE(v_result, '{MM}', LPAD(v_month::text, 2, '0'));
  v_result := REPLACE(v_result, '{DD}', LPAD(EXTRACT(DAY FROM p_date)::text, 2, '0'));
  v_result := REPLACE(v_result, '{SEQ}', LPAD(v_seq::text, 4, '0'));
  -- Handle {SEQ:N} pattern for custom padding
  v_result := REGEXP_REPLACE(v_result, '\{SEQ:(\d+)\}',
    LPAD(v_seq::text, COALESCE(SUBSTRING(v_result FROM '\{SEQ:(\d+)\}')::int, 4), '0'));

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Seed default journal types for existing orgs
INSERT INTO accounting_journal_types (org_id, code, name_ar, name_en, prefix, number_format, is_default)
SELECT o.id, 'GJ', 'قيد يومية عام', 'General Journal', 'JV', '{PREFIX}-{YYYY}{MM}-{SEQ}', true
FROM organizations o
ON CONFLICT (org_id, code) DO NOTHING;
```

### Backend Changes

**New file:** `src/lib/accounting/journal-types.ts`

```typescript
export interface JournalType {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  prefix: string;
  number_format: string;
  sequence_reset: "never" | "yearly" | "monthly";
  current_sequence: number;
  is_default: boolean;
  is_active: boolean;
  allowed_roles: string[];
  requires_approval: boolean;
  auto_post: boolean;
}

export async function getJournalTypes(orgId: string): Promise<JournalType[]>;
export async function createJournalType(orgId: string, data: CreateJournalTypeInput): Promise<JournalType>;
export async function updateJournalType(id: string, data: Partial<JournalType>): Promise<JournalType>;
export async function getNextJournalNumber(orgId: string, typeId: string, date: Date): Promise<string>;
```

**Update:** `src/lib/accounting/posting.ts`

Modify `createJournalEntry` to:
1. Accept optional `journal_type_id` parameter
2. If not provided, use the org's default journal type
3. Call `accounting_next_journal_number` RPC for the journal number instead of generating inline

### Frontend Changes

**Journal Entry Form** (`src/app/(app)/accounting/journal-entries/new/page.tsx`):

Add Journal Type selector at the top of the form:

```tsx
<div className="space-y-2">
  <Label>نوع القيد / Journal Type</Label>
  <Select value={journalTypeId} onValueChange={setJournalTypeId}>
    <SelectTrigger><SelectValue /></SelectTrigger>
    <SelectContent>
      {journalTypes.map(jt => (
        <SelectItem key={jt.id} value={jt.id}>
          {jt.code} - {jt.name_ar}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  <p className="text-sm text-muted-foreground">
    Next number: {previewNumber}
  </p>
</div>
```

**Settings Page** (`src/app/(app)/accounting/settings/journal-types/page.tsx`):

- List all journal types with code, name, prefix, format preview
- Create/Edit dialog with:
  - Code (e.g., GJ, SJ, PJ)
  - Name (Arabic + English)
  - Prefix
  - Number format (with token picker: {PREFIX}, {YYYY}, {MM}, {SEQ})
  - Sequence reset policy (Never, Yearly, Monthly)
  - Options: Requires Approval, Auto-Post
  - Allowed roles (multi-select)
- Preview of generated number shown in real-time as format is edited

---

## Feature 5: Searchable Account Selection

### Objective

Replace the current dropdown-only account selection in Journal Entries with a searchable combobox that supports typing account names or codes, with instant filtering and keyboard navigation.

### Current State

- Account selection uses a standard `<Select>` dropdown from the component library
- Works fine for small chart of accounts but becomes unwieldy with 100+ accounts
- No type-ahead or search functionality

### Frontend Changes

**New component:** `src/components/accounting/AccountCombobox.tsx`

```tsx
interface AccountComboboxProps {
  value: string | null;
  onValueChange: (accountId: string, account: AccountingAccount) => void;
  accounts: AccountingAccount[];
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: string[];          // Accounts already selected in other lines
  filterByType?: AccountType[];   // Restrict to certain account types
}
```

**Behavior:**

1. **Idle state:** Shows selected account as `{code} - {name_ar}` or placeholder
2. **On click/focus:** Opens popover with search input + scrollable list
3. **Search logic:** Filters accounts matching ANY of:
   - Account code starts with input (e.g., "110" matches "1101", "1102")
   - Account name (Arabic) contains input
   - Account name (English) contains input
   - Fuzzy match on combined code + name
4. **Grouping:** Accounts grouped by parent category (Assets, Liabilities, etc.)
5. **Keyboard navigation:**
   - `ArrowDown/Up` to navigate results
   - `Enter` to select highlighted
   - `Escape` to close without selecting
   - Typing immediately filters
6. **Recently used:** Top section shows 5 most recently used accounts for this user
7. **Performance:** Virtualized list for orgs with 500+ accounts (use `@tanstack/react-virtual`)

**Implementation approach using existing UI primitives:**

```tsx
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export function AccountCombobox({ value, onValueChange, accounts, ... }: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return accounts;
    const lower = search.toLowerCase();
    return accounts.filter(a =>
      a.code.startsWith(search) ||
      a.name_ar.includes(search) ||
      (a.name_en && a.name_en.toLowerCase().includes(lower))
    );
  }, [accounts, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}>
          {selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name_ar}` : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="ابحث بالاسم أو الرقم... / Search by name or code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {filtered.map(account => (
            <div
              key={account.id}
              className="px-3 py-2 cursor-pointer hover:bg-muted"
              onClick={() => { onValueChange(account.id, account); setOpen(false); }}
            >
              <span className="font-mono text-sm">{account.code}</span>
              <span className="mr-2">{account.name_ar}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

**Integration points:**

1. `src/app/(app)/accounting/journal-entries/new/page.tsx` - Replace account dropdowns in line items
2. `src/app/(app)/accounting/journal-entries/[id]/page.tsx` - Edit mode account selection
3. Any other form that uses account selection (posting templates, budget setup)

### Backend Changes

**New API:** `GET /api/accounting/accounts/search?q={query}&limit=20`

Server-side search for cases where the full account list is too large to send to the client:

```typescript
export async function GET(request: NextRequest) {
  const ctx = await requireAccountingAccess("view");
  const q = request.nextUrl.searchParams.get("q") || "";
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "20"), 50);

  const { data } = await supabase
    .from("accounting_accounts")
    .select("id, code, name_ar, name_en, account_type, parent_id, is_active")
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .or(`code.ilike.${q}%,name_ar.ilike.%${q}%,name_en.ilike.%${q}%`)
    .order("code")
    .limit(limit);

  return NextResponse.json({ data });
}
```

### User Experience

- For orgs with < 200 accounts: preload all accounts client-side, filter locally
- For orgs with 200+ accounts: use server-side search with debounced input (300ms)
- Store "recently used accounts" in localStorage per user/org

---

## Feature 6: Journal Entry Attachments

### Objective

Allow users to attach supporting documents (invoices, receipts, contracts, bank slips) to each Journal Entry for auditing and documentation purposes.

### Current State

- File upload infrastructure exists (`src/lib/server/file-storage-core.ts`, `src/lib/server/upload-security.ts`)
- S3-compatible storage configured (Hostinger or Supabase Storage)
- Existing buckets: `balance-attachments`, `task-attachments`, `chat-attachments`, etc.
- Signed URL access control in place
- No attachment support on journal entries

### Database Changes

**Migration:** `db/schema_v165_journal_attachments.sql`

```sql
-- Journal Entry Attachments
CREATE TABLE IF NOT EXISTS accounting_journal_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,         -- storage path (bucket/key)
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  description text,                -- optional user description
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  checksum_sha256 text
);

ALTER TABLE accounting_journal_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON accounting_journal_attachments
  FOR ALL USING (org_id = current_org_id());

CREATE INDEX idx_journal_attachments_entry
  ON accounting_journal_attachments(journal_entry_id);

-- Storage bucket (if using Supabase Storage)
INSERT INTO storage.buckets (id, name, public)
VALUES ('journal-attachments', 'journal-attachments', false)
ON CONFLICT DO NOTHING;
```

### Backend Changes

**Storage bucket:** `journal-attachments`

**File path convention:** `{org_id}/journals/{journal_entry_id}/{uuid}_{sanitized_filename}`

**API endpoints** (add to accounting catch-all route):

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/accounting/journals/:id/attachments` | List attachments for entry |
| POST | `/api/accounting/journals/:id/attachments` | Upload attachment(s) |
| DELETE | `/api/accounting/journals/:id/attachments/:attachmentId` | Remove attachment |
| GET | `/api/accounting/journals/:id/attachments/:attachmentId/url` | Get signed download URL |

**Upload handler:**

```typescript
async function handleAttachmentUpload(journalEntryId: string, formData: FormData, ctx: TenantAuthContext) {
  const files = formData.getAll("files") as File[];

  const results = [];
  for (const file of files) {
    // Security validation
    const inspection = await inspectUpload(file, {
      maxSizeBytes: 10 * 1024 * 1024, // 10MB per file
      allowedExtensions: ["pdf", "jpg", "jpeg", "png", "gif", "doc", "docx", "xls", "xlsx", "csv"],
    });

    if (!inspection.safe) {
      throw new ValidationError(`File rejected: ${inspection.reason}`);
    }

    // Upload to storage
    const key = `${ctx.orgId}/journals/${journalEntryId}/${crypto.randomUUID()}_${sanitize(file.name)}`;
    await uploadToStorage("journal-attachments", key, file);

    // Record in database
    const { data } = await supabase
      .from("accounting_journal_attachments")
      .insert({
        org_id: ctx.orgId,
        journal_entry_id: journalEntryId,
        file_name: file.name,
        file_path: key,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: ctx.userId,
        checksum_sha256: inspection.checksum,
      })
      .select()
      .single();

    results.push(data);
  }

  return results;
}
```

**Access control:**

- Upload: requires `requireAccountingAccess("manage")` + journal must be in `draft` or `posted` status
- Download: requires `requireAccountingAccess("view")`
- Delete: requires `requireAccountingAccess("manage")` + journal must be in `draft` status (cannot delete attachments from posted entries)

### Frontend Changes

**New component:** `src/components/accounting/JournalAttachments.tsx`

```tsx
interface JournalAttachmentsProps {
  journalEntryId: string;
  attachments: JournalAttachment[];
  canUpload: boolean;
  canDelete: boolean;
  onAttachmentsChange: () => void; // refresh callback
}
```

**Features:**

1. **Upload zone:**
   - Drag-and-drop area with file picker fallback
   - Multi-file upload support
   - Progress indicator per file
   - File type icons (PDF, image, spreadsheet, document)
   - Max 10MB per file, max 20 files per journal entry

2. **Attachment list:**
   - File name, size, upload date, uploader name
   - Thumbnail preview for images
   - Click to download (via signed URL)
   - Delete button (with confirmation dialog, only for drafts)

3. **Inline preview:**
   - PDF: embedded viewer in dialog
   - Images: lightbox view
   - Others: download only

**Integration into Journal Entry pages:**

`src/app/(app)/accounting/journal-entries/[id]/page.tsx`:

```tsx
<Tabs defaultValue="details">
  <TabsList>
    <TabsTrigger value="details">تفاصيل القيد / Entry Details</TabsTrigger>
    <TabsTrigger value="attachments">
      المرفقات / Attachments ({attachments.length})
    </TabsTrigger>
  </TabsList>
  <TabsContent value="details">{/* existing entry detail */}</TabsContent>
  <TabsContent value="attachments">
    <JournalAttachments
      journalEntryId={entry.id}
      attachments={attachments}
      canUpload={entry.status === "draft" || entry.status === "posted"}
      canDelete={entry.status === "draft"}
      onAttachmentsChange={refetch}
    />
  </TabsContent>
</Tabs>
```

`src/app/(app)/accounting/journal-entries/new/page.tsx`:

- Allow attaching files during entry creation (upload after initial save, before posting)
- Show "Save as Draft to attach files" hint if entry not yet saved

---

## Migration Summary

| Order | Migration File | Feature |
|-------|---------------|---------|
| 1 | `db/schema_v162_customer_vendor_permissions.sql` | Customer/Vendor permissions |
| 2 | `db/schema_v163_banking_module.sql` | Banking module tables |
| 3 | `db/schema_v164_journal_types.sql` | Configurable journal types |
| 4 | `db/schema_v165_journal_attachments.sql` | Journal entry attachments |

**Note:** Feature 2 (Cost Center column) and Feature 5 (Searchable accounts) require no schema changes.

---

## Implementation Order & Dependencies

### Phase 1 (No dependencies, can be done in parallel)

| # | Feature | Effort | Risk |
|---|---------|--------|------|
| 2 | Cost Center column in GL | 2-3 days | Low |
| 5 | Searchable account selection | 3-4 days | Low |
| 6 | Journal entry attachments | 4-5 days | Low |

### Phase 2 (Moderate complexity)

| # | Feature | Effort | Risk |
|---|---------|--------|------|
| 1 | Customer/Vendor permissions | 3-4 days | Medium |
| 4 | Configurable journal types | 5-6 days | Medium |

### Phase 3 (High complexity, depends on Phase 2)

| # | Feature | Effort | Risk |
|---|---------|--------|------|
| 3 | Banking module | 12-15 days | High |

### Dependency Graph

```
Phase 1 (parallel):
  Feature 2 ──┐
  Feature 5 ──┼── No blockers
  Feature 6 ──┘

Phase 2 (after Phase 1 complete):
  Feature 1 ──── Needed before banking permissions
  Feature 4 ──── Needed before banking auto-journals

Phase 3:
  Feature 3 ──── Depends on: Feature 1 (permissions pattern),
                              Feature 4 (journal types for bank journals),
                              Feature 6 (attachment pattern for statement files)
```

### Total Estimated Effort

- **Phase 1:** 9-12 days (parallel execution: ~5 days wall-clock)
- **Phase 2:** 8-10 days (parallel execution: ~6 days wall-clock)
- **Phase 3:** 12-15 days
- **Total:** 23-30 days (~25 days wall-clock with parallelization)

---

## Testing Strategy

| Feature | Unit Tests | Integration Tests | E2E |
|---------|-----------|-------------------|-----|
| Permissions | Permission resolver logic | API auth checks | Role-based UI visibility |
| Cost Center GL | Aggregation functions | Report query with CC filter | Column renders, filter works |
| Banking Module | Parsers (CSV, MT940), match engine | Import + auto-match flow | Full import-to-reconciliation |
| Journal Types | Number generation, sequence reset | RPC function correctness | Type selection + preview |
| Account Search | Filter logic, fuzzy match | Server-side search API | Type-ahead UX |
| Attachments | Upload security, path sanitization | Upload + download + signed URLs | Drag-drop, preview, delete |

---

## Rollback Strategy

Each feature is behind its own migration and can be independently reverted:

1. **Database:** Each migration uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` -- forward-only by default. For rollback, prepare corresponding `DROP` scripts.
2. **Code:** Feature-flag each feature via `organization_features` table. Disable flag to hide UI without removing code.
3. **API:** Catch-all route pattern means new endpoints don't affect existing ones.

---

## Security Considerations

| Feature | Concern | Mitigation |
|---------|---------|------------|
| Permissions | Privilege escalation | Server-side permission check on every mutation; UI is cosmetic only |
| Banking Import | Malicious file upload | File inspection via `upload-security.ts`, extension blocklist, size limits |
| Banking Matching | Data leakage across orgs | RLS on all banking tables, org_id check in every query |
| Attachments | Path traversal, malware | Sanitized file paths, magic-byte validation, optional malware scan |
| Account Search | SQL injection via search | Parameterized queries via Supabase client (never raw string interpolation) |
| Journal Types | Sequence race conditions | `FOR UPDATE` lock in `accounting_next_journal_number` function |
