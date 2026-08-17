# Blueprint: Accounting Module — Technical Implementation Plan

> Status: Ready for Engineering Review
>
> Date: 2026-08-17
>
> Baseline: Branch `main` at commit `8935656` (feat: require manual journal cost centers)
>
> Source Plan: `docs/ACCOUNTING_EDITS_DETAILED_IMPLEMENTATION_PLAN.md`
>
> Scope: Full technical specification for requirements R1–R10

---

## 0. Current System State (Verified)

### 0.1 Migration Chain Status

| Item | Actual State |
|------|-------------|
| `db/migrations.manifest.json` | 172 entries, ends at `schema_v170_banking_statement_lifecycle` |
| `src/lib/schema-version.json` | Points to `schema_v169_manual_journal_cost_centers` |
| Latest migration | `db/schema_v170_banking_statement_lifecycle.sql` (staged, uncommitted) |
| Gap | schema-version lags manifest by 1 (v170 not yet registered as head) |

**Action:** Update `schema-version.json` to v170 after v170 is applied to all environments.

### 0.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App Router                     │
├─────────────────────────────────────────────────────────┤
│  UI Pages                  │  API Routes                 │
│  src/app/(app)/accounting/ │  src/app/api/accounting/    │
│  src/app/(app)/banking/    │    [...segments]/route.ts   │
│                            │  src/app/api/banking/       │
│                            │    [...segments]/route.ts   │
├─────────────────────────────────────────────────────────┤
│  Components                │  Services (Client)          │
│  src/components/accounting/│  src/lib/services/          │
│    AccountingScreens.tsx   │    accounting.ts (1376 ln)  │
│    AccountingPrimitives.tsx│    banking.ts (230 ln)      │
│    AccountCombobox.tsx     │                             │
│    EntityManagement.tsx    │                             │
├─────────────────────────────────────────────────────────┤
│  Business Logic            │  Server Logic               │
│  src/lib/accounting/       │  src/lib/server/accounting/ │
│    posting.ts              │    context.ts               │
│    posting-engine.ts       │    entities.ts              │
│    auto-posting.ts         │                             │
│    validation.ts           │                             │
│    permissions.ts          │                             │
│    numbering.ts            │                             │
│    account-taxonomy.ts     │                             │
│    reports.ts              │                             │
│    reports/**              │                             │
├─────────────────────────────────────────────────────────┤
│  Types                     │  Database                   │
│  src/types/accounting.ts   │  PostgreSQL via Supabase    │
│  (1643 lines, 50+ ifaces) │  80+ tables, RPC functions  │
│                            │  RLS policies per org       │
└─────────────────────────────────────────────────────────┘
```

### 0.3 Key File Reference

| Category | File | Lines | Role |
|----------|------|-------|------|
| API Dispatcher | `src/app/api/accounting/[...segments]/route.ts` | 2863 | All accounting routes |
| API Dispatcher | `src/app/api/banking/[...segments]/route.ts` | 642 | All banking routes |
| UI Monolith | `src/components/accounting/AccountingScreens.tsx` | ~3000 | Dashboard, CRUD screens, reports |
| Service Client | `src/lib/services/accounting.ts` | 1376 | 130+ client-side API wrappers |
| Service Client | `src/lib/services/banking.ts` | 230 | Banking API wrappers |
| Permissions | `src/lib/accounting/permissions.ts` | 92 | Role/action gate |
| Entity Context | `src/lib/server/accounting/context.ts` | 155 | Entity resolution (fail-open) |
| Validation | `src/lib/accounting/validation.ts` | — | Journal line validation |
| Reports | `src/lib/accounting/reports.ts` | — | Core report generators |
| Reports/CashFlow | `src/lib/accounting/reports/statements/cash-flow.ts` | — | Cash flow statement |
| Types | `src/types/accounting.ts` | 1643 | All TypeScript interfaces |
| Taxonomy | `src/lib/accounting/account-taxonomy.ts` | — | Account type/subtype maps |

### 0.4 Database Tables (Key)

| Table | Purpose | Entity-Aware |
|-------|---------|:---:|
| `accounting_accounts` | Chart of Accounts | column exists, nullable |
| `accounting_journal_entries` | GL journal headers | column exists, nullable |
| `accounting_journal_lines` | GL journal lines | via header |
| `accounting_customers` | Customer master | No |
| `accounting_vendors` | Vendor master | No |
| `accounting_parties` | Unified party (v117) | column exists, nullable |
| `accounting_invoices` | Customer invoices | No |
| `accounting_expenses` | Expense claims | No |
| `accounting_payments` | Payment records | No |
| `accounting_cost_centers` | Cost centers | No |
| `accounting_settings` | Org-level config | No (single row/org) |
| `accounting_legal_entities` | Legal entities (v112) | — (is the entity) |
| `accounting_books` | Accounting books (v112) | Yes |
| `accounting_user_scopes` | User-entity access (v112) | Yes |
| `banking_accounts` | Bank accounts (v165) | No |
| `banking_statements` | Bank statements (v165) | No |
| `banking_statement_lines` | Statement transactions (v165) | No |
| `banking_reconciliations` | Reconciliation sessions (v165) | No |

### 0.5 Current Permission Model

From `src/lib/accounting/permissions.ts`:

```typescript
type AccountingAction = "view" | "manage" | "post" | "settings" | "payroll" | "sales" | "reports"

// Role capabilities:
// finance_manager: canView, canManage, canPost, canManageSettings
// accountant:      canView, canManage
// finance_viewer:  canView
```

### 0.6 Critical Gaps Confirmed

1. **Entity context is fail-open**: `getUserAllowedEntities()` returns ALL entities when user has no scopes
2. **No entity filtering on reads**: Most queries filter only by `organization_id`
3. **Banking has no entity/version/audit**: Direct writes, no optimistic locking (v170 adds lifecycle but not fully wired)
4. **Party model limited**: `accounting_parties.party_type` is single-value enum, no multi-role support
5. **AR/AP not linked to party accounts**: Invoices/expenses use org-default AR/AP, not party-specific
6. **No netting mechanism**: No tables or logic for AR/AP offset
7. **Income statement flat**: `getProfitLoss` returns rows without hierarchical sections
8. **Cash flow opening boundary**: Uses `dateTo=dateFrom` which may include first-day transactions
9. **Export is scattered**: CSV-only, no unified mechanism, formula injection risk
10. **Cost center not enforced**: v169 adds RPC enforcement for manual journals; UI/API validation needed

---

## 1. Phase 0 — Migration Chain Fix & Baseline

### 1.1 Tasks

| # | Task | File(s) | Acceptance |
|---|------|---------|-----------|
| 0.1 | Update schema-version to v170 | `src/lib/schema-version.json` | Points to `schema_v170_banking_statement_lifecycle` with valid checksum |
| 0.2 | Run `scripts/test-database-migrations.mjs` | — | Green pass, no orphan SQL files |
| 0.3 | Verify v170 applied in staging | — | `banking_statements.version` column exists |
| 0.4 | Baseline data audit queries | New: `scripts/accounting-data-audit.sql` | Reports NULL entities, unmapped accounts, orphan parties |

### 1.2 Migration Numbering

All new migrations start at **v171**. Assigned numbers:

| ID | Logical Name | Phase |
|----|-------------|-------|
| v171 | `accounting_identity_status_hardening` | 1 |
| v172 | `accounting_entity_scope_enforcement` | 2 |
| v173 | `accounting_entity_settings_numbering` | 2 |
| v174 | `accounting_coa_subtype_statement_group` | 3 |
| v175 | `accounting_unified_party_roles` | 4 |
| v176 | `accounting_open_items` | 4 |
| v177 | `accounting_party_netting` | 5 |
| v178 | `banking_statement_commands_v2` | 6 |
| v179 | `accounting_report_export_support` | 8 |

---

## 2. Phase 1 — Identity, Status & Permissions (R3)

### 2.1 Root Cause: A.Gaafar Bug

**Location:** `db/schema_v98_atomic_sales_accounting_customer_link.sql` — function `accounting_save_customer`

**Bug:** `profile.account_status = 'Active'` (case-sensitive) vs seed data writes `'active'`

**Fix applied in:** `db/schema_v167_accounting_customer_status_normalization.sql` (already in manifest)

**Remaining work:**

1. Verify all other RPCs that check `account_status` use case-insensitive comparison
2. Add diagnostic endpoint for admin troubleshooting

### 2.2 Migration v171: `accounting_identity_status_hardening`

```sql
-- Ensure all status checks are case-insensitive
-- Scan and fix any remaining RPCs that compare account_status literally

-- Add diagnostic function (read-only, admin-only)
CREATE OR REPLACE FUNCTION accounting_diagnose_user_access(
  p_organization_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'auth_user_exists', EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id),
    'profile_exists', EXISTS(SELECT 1 FROM profiles WHERE user_id = p_user_id),
    'account_status', (SELECT lower(btrim(coalesce(account_status,''))) FROM profiles WHERE user_id = p_user_id),
    'org_member', EXISTS(SELECT 1 FROM org_members WHERE user_id = p_user_id AND org_id = p_organization_id),
    'member_role', (SELECT role FROM org_members WHERE user_id = p_user_id AND org_id = p_organization_id),
    'entity_scopes_count', (SELECT count(*) FROM accounting_user_scopes WHERE user_id = p_user_id AND organization_id = p_organization_id AND is_active = true),
    'accounting_feature_active', true
  ) INTO v_result;
  RETURN v_result;
END;
$$;
```

### 2.3 Permission Hardening

**File:** `src/lib/accounting/permissions.ts`

Extend from 7 coarse actions to granular capabilities:

```typescript
// New capability model (additive to existing)
export type AccountingCapability =
  | 'accounting:read'
  | 'reports:export'
  | 'journals:prepare'
  | 'journals:post'
  | 'master_data:edit_contacts'
  | 'master_data:manage_coa'
  | 'control_accounts:assign'
  | 'party_netting:prepare'
  | 'party_netting:approve'
  | 'bank_statement:edit'
  | 'bank_statement:recall_approved'
  | 'bank_statement:archive'
  | 'permissions:manage';

export function resolveCapabilities(role: string): AccountingCapability[] {
  switch (role) {
    case 'finance_manager':
      return [/* all capabilities */];
    case 'accountant':
      return ['accounting:read', 'reports:export', 'journals:prepare',
              'master_data:edit_contacts', 'party_netting:prepare',
              'bank_statement:edit'];
    case 'finance_viewer':
      return ['accounting:read', 'reports:export'];
    default:
      return [];
  }
}
```

**New API endpoint:** `GET /api/accounting/permissions/me`
- Returns capabilities computed server-side from user's actual role + explicit grants
- UI consumes this instead of hard-coded role checks

### 2.4 Finance Team API Hardening

**File:** `src/app/api/accounting/team/route.ts`

- Use `requireTenantContext` centrally
- Lock `grant`/`revoke` to `permissions:manage` capability
- Add `X-Accounting-Entity-Id` header requirement

### 2.5 Acceptance Criteria

- [ ] `finance_manager` with `account_status = 'active'` (lowercase) can add customer
- [ ] `inactive`/`suspended` user rejected at outer guard AND RPC consistently
- [ ] `GET /api/accounting/permissions/me` returns accurate capabilities
- [ ] `grant`/`revoke` blocked for users without `permissions:manage`
- [ ] Regression test: reproduce old case-sensitive failure, verify fix

---

## 3. Phase 2 — Legal Entity Context & Isolation (R8)

### 3.1 Server-Side: Fail-Closed Context

**File:** `src/lib/server/accounting/context.ts`

Current behavior (UNSAFE):
```typescript
// getUserAllowedEntities returns ALL entities when no scopes exist
// resolveAccountingEntityContext falls back silently
```

Target behavior:
```typescript
export async function resolveAccountingEntityContext(
  organizationId: string,
  userId: string,
  role: string,
  requestedEntityId?: string
): Promise<ResolvedAccountingContext | { error: string; status: number }> {
  const scopes = await getActiveScopes(organizationId, userId);

  if (scopes.length === 0) {
    return { error: 'no_entity_scope', status: 403 };
  }

  const allowedEntityIds = scopes.map(s => s.legal_entity_id);

  if (requestedEntityId && !allowedEntityIds.includes(requestedEntityId)) {
    return { error: 'entity_scope_denied', status: 403 };
  }

  const entityId = requestedEntityId || getDefaultEntity(scopes);
  // ... resolve book, currency, etc.
}
```

### 3.2 Client-Side: Entity Provider

**New file:** `src/providers/AccountingEntityProvider.tsx`

```typescript
interface AccountingEntityContextValue {
  currentEntity: AccountingLegalEntity | null;
  currentBook: AccountingBook | null;
  functionalCurrency: string;
  allowedEntities: AccountingLegalEntity[];
  switchEntity: (entityId: string) => Promise<void>;
  isLoading: boolean;
}
```

**New file:** `src/components/accounting/entities/AccountingEntitySwitcher.tsx`

- Renders in `src/components/layout/Header.tsx` next to user avatar
- Searchable dropdown when > 3 entities
- Shows entity name + currency badge
- Warns on dirty form before switch
- Hidden if user has single entity (shows name read-only)

### 3.3 Entity Header Injection

**File:** `src/lib/services/accounting.ts`

Add entity header to all requests:
```typescript
// Centralized in apiFetch or a wrapper
function accountingFetch<T>(path: string, options?: RequestInit) {
  const entityId = getActiveEntityId(); // from provider/store
  return apiFetch<T>(path, {
    ...options,
    headers: {
      ...options?.headers,
      'X-Accounting-Entity-Id': entityId,
    },
  });
}
```

### 3.4 Migration v172: `accounting_entity_scope_enforcement`

```sql
-- Add legal_entity_id to tables that lack it
ALTER TABLE accounting_customers
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE accounting_vendors
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE accounting_invoices
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE accounting_expenses
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE accounting_payments
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE accounting_cost_centers
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE banking_accounts
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE banking_statements
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid
    REFERENCES accounting_legal_entities(id) ON DELETE SET NULL;

-- Backfill function (assigns default entity)
CREATE OR REPLACE FUNCTION accounting_backfill_entity_ids(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_default_entity_id uuid;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_default_entity_id
  FROM accounting_legal_entities
  WHERE organization_id = p_org_id AND is_default = true
  LIMIT 1;

  IF v_default_entity_id IS NULL THEN
    RAISE EXCEPTION 'No default entity for org %', p_org_id;
  END IF;

  UPDATE accounting_customers SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_counts := v_counts || jsonb_build_object('customers', ROW_COUNT);

  UPDATE accounting_vendors SET legal_entity_id = v_default_entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;
  v_counts := v_counts || jsonb_build_object('vendors', ROW_COUNT);

  -- ... repeat for invoices, expenses, payments, cost_centers, banking_accounts, banking_statements

  RETURN v_counts;
END;
$$;
```

### 3.5 Migration v173: `accounting_entity_settings_numbering`

```sql
-- Entity-scoped settings
CREATE TABLE IF NOT EXISTS accounting_entity_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES accounting_legal_entities(id) ON DELETE CASCADE,
  book_id uuid REFERENCES accounting_books(id) ON DELETE SET NULL,
  default_ar_account_id uuid REFERENCES accounting_accounts(id),
  default_ap_account_id uuid REFERENCES accounting_accounts(id),
  default_cash_account_id uuid REFERENCES accounting_accounts(id),
  default_bank_account_id uuid REFERENCES accounting_accounts(id),
  default_revenue_account_id uuid REFERENCES accounting_accounts(id),
  default_expense_account_id uuid REFERENCES accounting_accounts(id),
  default_vat_output_account_id uuid REFERENCES accounting_accounts(id),
  default_vat_input_account_id uuid REFERENCES accounting_accounts(id),
  invoice_prefix text DEFAULT 'INV',
  expense_prefix text DEFAULT 'EXP',
  journal_prefix text DEFAULT 'JV',
  payment_prefix text DEFAULT 'PAY',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, legal_entity_id, COALESCE(book_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- Entity-scoped document counters
ALTER TABLE accounting_document_counters
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES accounting_legal_entities(id),
  ADD COLUMN IF NOT EXISTS book_id uuid REFERENCES accounting_books(id);

-- Update uniqueness to include entity
DROP INDEX IF EXISTS idx_accounting_doc_counters_unique;
CREATE UNIQUE INDEX idx_accounting_doc_counters_unique
  ON accounting_document_counters(
    organization_id,
    COALESCE(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_key,
    prefix
  );
```

### 3.6 API Route Changes

**File:** `src/app/api/accounting/[...segments]/route.ts`

Add entity context resolution at the top of each handler:

```typescript
// After auth check
const entityHeader = request.headers.get('X-Accounting-Entity-Id');
const entityCtx = await resolveAccountingEntityContext(
  auth.orgId, auth.user.id, auth.role, entityHeader || undefined
);
if ('error' in entityCtx) {
  return NextResponse.json({ error: entityCtx.error }, { status: entityCtx.status });
}
// Pass entityCtx.legalEntityId to all queries and commands
```

### 3.7 Acceptance Criteria

- [ ] User with no scopes gets 403 (not all entities)
- [ ] Request with unauthorized entity_id returns 403
- [ ] Entity switcher updates all dependent queries
- [ ] Journal entry created in Entity A cannot reference Account from Entity B
- [ ] Document numbering is independent per entity
- [ ] Trial Balance returns only selected entity's data
- [ ] Deep link to record in different entity returns 403/404

---

## 4. Phase 3 — Chart of Accounts Classification (R1)

### 4.1 Account Taxonomy

**File:** `src/lib/accounting/account-taxonomy.ts` (already exists, extend it)

```typescript
export const ACCOUNT_SUBTYPE_TAXONOMY: Record<string, string[]> = {
  asset: ['cash', 'bank', 'receivable', 'related_party_receivable',
          'inventory', 'prepaid', 'current_asset', 'fixed_asset', 'other_asset'],
  liability: ['payable', 'related_party_payable', 'accrual', 'tax_payable',
              'current_liability', 'long_term_liability', 'other_liability'],
  equity: ['capital', 'retained_earnings', 'reserves', 'current_year_result'],
  revenue: ['sales_revenue', 'commission_revenue', 'service_revenue', 'other_income'],
  expense: ['cost_of_revenue', 'operating_expense', 'depreciation_expense',
            'finance_cost', 'other_expense'],
};

export const STATEMENT_GROUP_MAP: Record<string, string> = {
  sales_revenue: 'revenue',
  commission_revenue: 'revenue',
  service_revenue: 'revenue',
  other_income: 'other_income',
  cost_of_revenue: 'cost_of_revenue',
  operating_expense: 'operating_expense',
  depreciation_expense: 'operating_expense',
  finance_cost: 'other_expense',
  other_expense: 'other_expense',
};
```

### 4.2 Migration v174: `accounting_coa_subtype_statement_group`

```sql
-- v168 already added subtype column; this migration adds enforcement and statement_group

-- Ensure statement_group, control_type, is_posting_account exist (from v113)
-- and add CHECK constraint for statement_group values:
ALTER TABLE accounting_accounts
  DROP CONSTRAINT IF EXISTS chk_statement_group_values;

ALTER TABLE accounting_accounts
  ADD CONSTRAINT chk_statement_group_values
  CHECK (statement_group IS NULL OR statement_group IN (
    'revenue', 'cost_of_revenue', 'operating_expense',
    'other_income', 'other_expense', 'excluded_from_income_statement'
  ));

-- Validation function for subtype-type consistency
CREATE OR REPLACE FUNCTION accounting_validate_account_subtype(
  p_type text, p_subtype text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_type
    WHEN 'asset' THEN p_subtype IN ('cash','bank','receivable','related_party_receivable','inventory','prepaid','current_asset','fixed_asset','other_asset')
    WHEN 'liability' THEN p_subtype IN ('payable','related_party_payable','accrual','tax_payable','current_liability','long_term_liability','other_liability')
    WHEN 'equity' THEN p_subtype IN ('capital','retained_earnings','reserves','current_year_result')
    WHEN 'revenue' THEN p_subtype IN ('sales_revenue','commission_revenue','service_revenue','other_income')
    WHEN 'expense' THEN p_subtype IN ('cost_of_revenue','operating_expense','depreciation_expense','finance_cost','other_expense')
    ELSE false
  END;
END;
$$;

ALTER TABLE accounting_accounts
  ADD CONSTRAINT chk_subtype_type_consistency
  CHECK (subtype IS NULL OR accounting_validate_account_subtype(type, subtype));

-- Seed Related Party accounts per entity (idempotent)
-- These will be created by a setup command, not hardcoded here
```

### 4.3 UI Changes

**File:** `src/components/accounting/AccountingScreens.tsx` (Account dialog section)

Add dependent dropdown:
1. Type select (existing)
2. **New:** Subtype select — options filtered by selected type from `ACCOUNT_SUBTYPE_TAXONOMY`
3. Normal balance (auto-filled based on type, editable by finance_manager with reason)

**New file:** `src/components/accounting/accounts/AccountDialog.tsx`

Extract account create/edit dialog from `AccountingScreens.tsx` into standalone component:
- Type dropdown with Arabic/English labels
- Subtype dropdown (dependent on type, using taxonomy)
- Statement group dropdown (for revenue/expense types)
- Control type dropdown (customer/vendor/bank/none)
- Is posting account toggle
- Normal balance auto-set with override

### 4.4 API Changes

**File:** `src/app/api/accounting/[...segments]/route.ts`

In the account save handler:
```typescript
// Validate subtype against type
if (body.subtype && !isSupportedAccountSubtypeForType(body.type, body.subtype)) {
  return NextResponse.json(
    { error: 'invalid_subtype', message_ar: 'التصنيف الفرعي غير متوافق مع نوع الحساب' },
    { status: 422 }
  );
}
```

Fix `accounts/search` route ordering — currently unreachable due to `accounts/:id` matching first.

### 4.5 Acceptance Criteria

- [ ] Cannot save `related_party_receivable` with `type=liability`
- [ ] Subtype dropdown resets on type change
- [ ] Normal balance defaults correctly (debit for asset/expense, credit for liability/equity/revenue)
- [ ] Account list shows subtype column
- [ ] `accounts/search` API endpoint is accessible
- [ ] Existing accounts without subtype still display correctly

---

## 5. Phase 4 — Unified Party & Open Items (R4 + R6)

### 5.1 Migration v175: `accounting_unified_party_roles`

```sql
-- Party roles table (allows same party to be customer AND vendor)
CREATE TABLE IF NOT EXISTS accounting_party_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES accounting_parties(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer', 'vendor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, party_id, role)
);

ALTER TABLE accounting_party_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY party_roles_org ON accounting_party_roles FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

-- Financial profiles per entity (AR/AP accounts per entity per party)
CREATE TABLE IF NOT EXISTS accounting_party_financial_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES accounting_legal_entities(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES accounting_parties(id) ON DELETE CASCADE,
  ar_account_id uuid REFERENCES accounting_accounts(id),
  ap_account_id uuid REFERENCES accounting_accounts(id),
  payment_terms_days integer DEFAULT 30,
  credit_limit numeric(20,2),
  currency_code text NOT NULL DEFAULT 'SAR',
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, legal_entity_id, party_id)
);

ALTER TABLE accounting_party_financial_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY party_profiles_org ON accounting_party_financial_profiles FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

-- Add is_related_party flag to accounting_parties
ALTER TABLE accounting_parties
  ADD COLUMN IF NOT EXISTS is_related_party boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_party_type text;

-- Drop single party_type constraint, keep for legacy reads but allow multi-role via party_roles
-- (party_type remains as the "primary" type for backwards compat)
```

### 5.2 Migration v176: `accounting_open_items`

```sql
-- Canonical open items table (source of truth for outstanding balances)
CREATE TABLE IF NOT EXISTS accounting_open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES accounting_legal_entities(id) ON DELETE CASCADE,
  book_id uuid REFERENCES accounting_books(id),
  party_id uuid NOT NULL REFERENCES accounting_parties(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('receivable', 'payable')),
  source_type text NOT NULL CHECK (source_type IN (
    'customer_invoice', 'vendor_expense', 'vendor_bill',
    'credit_note', 'debit_note', 'nontrade', 'opening_balance'
  )),
  source_id uuid NOT NULL,
  document_no text,
  document_date date NOT NULL,
  due_date date,
  account_id uuid NOT NULL REFERENCES accounting_accounts(id),
  currency_code text NOT NULL DEFAULT 'SAR',
  original_amount numeric(20,2) NOT NULL CHECK (original_amount > 0),
  settled_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  outstanding_amount numeric(20,2) NOT NULL GENERATED ALWAYS AS (original_amount - settled_amount) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'partially_settled', 'settled', 'reversed', 'cancelled'
  )),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, source_type, source_id, side),
  CHECK (settled_amount <= original_amount)
);

ALTER TABLE accounting_open_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_items_org ON accounting_open_items FOR ALL
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

CREATE INDEX idx_open_items_party ON accounting_open_items(party_id, side, status);
CREATE INDEX idx_open_items_due ON accounting_open_items(due_date) WHERE status IN ('open', 'partially_settled');
```

### 5.3 Party UI Components

**New files:**

| File | Purpose |
|------|---------|
| `src/components/accounting/parties/CounterpartyList.tsx` | Unified party list with role badges |
| `src/components/accounting/parties/CounterpartyForm.tsx` | Create/edit party with role checkboxes |
| `src/components/accounting/parties/PartyFinancialProfile.tsx` | AR/AP account selection per entity |
| `src/components/accounting/parties/ControlAccountSelect.tsx` | Filtered account dropdown (AR type only for AR, AP type only for AP) |
| `src/components/accounting/parties/PartyOpenItemsTable.tsx` | Open items for a party |

**ControlAccountSelect filter logic:**
```typescript
// AR dropdown: active + posting + same entity + type=asset + subtype in (receivable, related_party_receivable) + control_type=customer
// AP dropdown: active + posting + same entity + type=liability + subtype in (payable, related_party_payable) + control_type=vendor
```

### 5.4 API Routes

| Method | Route | Capability |
|--------|-------|-----------|
| GET | `/api/accounting/parties` | `accounting:read` |
| POST | `/api/accounting/parties` | `master_data:edit_contacts` |
| PATCH | `/api/accounting/parties/:id` | `master_data:edit_contacts` (contact fields) / `control_accounts:assign` (AR/AP) |
| GET | `/api/accounting/parties/:id/open-items` | `accounting:read` |
| GET | `/api/accounting/parties/:id/financial-profile` | `accounting:read` |
| PATCH | `/api/accounting/parties/:id/financial-profile` | `control_accounts:assign` |

### 5.5 Legacy Compatibility

During transition, `/accounting/customers` and `/accounting/vendors` pages remain as filtered views:
- Customers = parties with role `customer`
- Vendors = parties with role `vendor`

New party creation atomically creates:
1. `accounting_parties` row
2. `accounting_party_roles` row(s)
3. `accounting_party_financial_profiles` row
4. Legacy `accounting_customers` / `accounting_vendors` row (linked via `linked_customer_id`/`linked_vendor_id`)

### 5.6 Acceptance Criteria

- [ ] Same party can be both customer and vendor
- [ ] AR account dropdown shows only receivable-type accounts
- [ ] AP account dropdown shows only payable-type accounts
- [ ] Related party defaults to related_party_receivable/payable accounts
- [ ] Finance Manager only can change AR/AP assignment
- [ ] Open items table shows correct outstanding amounts
- [ ] Legacy customer/vendor pages still work

---

## 6. Phase 5 — AR/AP Netting (R4 continued)

### 6.1 Migration v177: `accounting_party_netting`

```sql
-- Netting header
CREATE TABLE IF NOT EXISTS accounting_party_nettings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES accounting_legal_entities(id) ON DELETE CASCADE,
  book_id uuid REFERENCES accounting_books(id),
  netting_no text NOT NULL,
  party_id uuid NOT NULL REFERENCES accounting_parties(id),
  netting_date date NOT NULL,
  currency_code text NOT NULL DEFAULT 'SAR',
  total_amount numeric(20,2) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'prepared', 'posted', 'reversed', 'cancelled'
  )),
  journal_entry_id uuid REFERENCES accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES accounting_journal_entries(id),
  reference text,
  reason text,
  notes text,
  prepared_by uuid REFERENCES auth.users(id),
  prepared_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, netting_no)
);

-- Netting lines (allocations)
CREATE TABLE IF NOT EXISTS accounting_party_netting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_id uuid NOT NULL REFERENCES accounting_party_nettings(id) ON DELETE CASCADE,
  open_item_id uuid NOT NULL REFERENCES accounting_open_items(id),
  side text NOT NULL CHECK (side IN ('receivable', 'payable')),
  allocated_amount numeric(20,2) NOT NULL CHECK (allocated_amount > 0),
  account_id uuid NOT NULL REFERENCES accounting_accounts(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  document_no text
);

CREATE INDEX idx_netting_lines_item ON accounting_party_netting_lines(open_item_id);

-- Atomic netting command
CREATE OR REPLACE FUNCTION execute_party_netting_command(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
-- Validates: same party, same entity, same currency
-- Locks open items FOR UPDATE
-- Checks allocated <= outstanding for each item
-- Verifies sum(receivable allocations) = sum(payable allocations) = total_amount
-- Creates journal entry: Dr AP account(s) / Cr AR account(s)
-- Updates open_items.settled_amount and status
-- Records audit event
-- Returns netting record with journal_entry_id
$$;
```

### 6.2 Netting Workflow

```
1. Select party (must have BOTH customer + vendor roles)
2. Load AR open items (outstanding > 0) + AP open items (outstanding > 0)
3. User selects items from both sides
4. System calculates: netting_amount = min(sum_selected_AR, sum_selected_AP)
5. User can adjust allocations (not exceed outstanding per item)
6. Preview shows:
   - Dr AP Account(s) [specific accounts from open items]
   - Cr AR Account(s) [specific accounts from open items]
   - Residual per item
7. Accountant saves as "prepared"
8. Finance Manager approves → executes atomic command → posts journal
```

### 6.3 UI Components

**New files:**

| File | Purpose |
|------|---------|
| `src/components/accounting/netting/PartyNettingWorkbench.tsx` | Main netting workflow screen |
| `src/components/accounting/netting/NettingJournalPreview.tsx` | Shows Dr/Cr preview before posting |
| `src/components/accounting/netting/NettingHistory.tsx` | History of nettings for a party |

### 6.4 API Routes

| Method | Route | Capability |
|--------|-------|-----------|
| GET | `/api/accounting/party-nettings` | `accounting:read` |
| POST | `/api/accounting/party-nettings` | `party_netting:prepare` |
| PATCH | `/api/accounting/party-nettings/:id` | `party_netting:prepare` |
| POST | `/api/accounting/party-nettings/:id/post` | `party_netting:approve` |
| POST | `/api/accounting/party-nettings/:id/reverse` | `party_netting:approve` |

### 6.5 Acceptance Criteria

- [ ] Netting 100 AR vs 60 AP → journal for 60, AR residual 40, AP residual 0
- [ ] Many-to-many allocation works (multiple AR items vs multiple AP items)
- [ ] Concurrent netting on same open item prevented by row locks
- [ ] Different party/entity/currency rejected with clear error
- [ ] Reversal restores open item balances atomically
- [ ] No cash movement created
- [ ] AR/AP aging matches after netting

---

## 7. Phase 6 — Bank Statement Commands (R2)

### 7.1 Current State (After v170)

`db/schema_v170_banking_statement_lifecycle.sql` adds:
- `version` column to `banking_statements`
- `recalled_at`, `recalled_by`, `recall_reason` columns
- `archived_at`, `archived_by`, `archive_reason` columns
- Status expanded to include `cancelled`
- `execute_banking_statement_command` RPC function

`src/lib/banking/statement-actions.ts` adds:
- `getBankStatementActionCapabilities()` — state-based action availability
- Input normalization for edit/recall

### 7.2 Migration v178: `banking_statement_commands_v2`

Extends v170 with entity awareness:

```sql
-- Add entity to banking tables
ALTER TABLE banking_accounts
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES accounting_legal_entities(id);

ALTER TABLE banking_statements
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES accounting_legal_entities(id),
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

ALTER TABLE banking_reconciliations
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES accounting_legal_entities(id),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Prevent duplicate statement imports
CREATE UNIQUE INDEX IF NOT EXISTS idx_banking_statements_content_hash
  ON banking_statements(organization_id, bank_account_id, content_hash)
  WHERE content_hash IS NOT NULL AND status != 'cancelled';
```

### 7.3 State Machine

```
imported ──────→ in_progress ──────→ reconciled
    │                 │                    │
    │                 │ (recall)           │ (recall, FM only)
    │                 ▼                    ▼
    │            imported              in_progress → imported
    │
    ▼ (archive/delete)
cancelled/archived
```

**Action permissions:**

| Action | imported | in_progress | reconciled | cancelled |
|--------|:--------:|:-----------:|:----------:|:---------:|
| View | all | all | all | all |
| Edit metadata | accountant+ | — | — | — |
| Start matching | accountant+ | — | — | — |
| Recall | — | accountant+ | FM only | — |
| Archive/Delete | accountant+ (no matches) | — | — | — |

### 7.4 UI Changes

**File:** `src/app/(app)/banking/statements/page.tsx`

Replace single "View" button with action menu:
```typescript
// Actions computed from server-returned capabilities
const actions = getBankStatementActionCapabilities(statement, userCapabilities);
// Renders: View, Edit, Recall, Archive — each enabled/disabled per state
```

Add confirmation dialogs:
- Recall: "This will unlink all matches. Reason required."
- Archive: "This statement will be hidden from active views."

### 7.5 Acceptance Criteria

- [ ] Accountant cannot recall approved/reconciled statement
- [ ] Cannot archive statement with active matches
- [ ] Replaying same `command_id` is idempotent
- [ ] Version conflict returns 409
- [ ] All recalls/archives visible in audit log with actor + reason
- [ ] Archived statements hidden from default list but accessible in audit view

---

## 8. Phase 7 — Cost Center Enforcement (R9)

### 8.1 Current State

`db/schema_v169_manual_journal_cost_centers.sql` already adds RPC-level enforcement for manual journals. The remaining work is UI and API validation.

### 8.2 UI Validation

**File:** `src/components/accounting/AccountingScreens.tsx` (journal entry form)

```typescript
// In journal line form row:
// When account_id is selected → cost_center_id becomes required
// Show inline error: "مركز التكلفة مطلوب" (Cost center required)
// Block Save Draft AND Send for Approval
```

Specific behavior:
- Label shows asterisk when account is selected
- Inline error on blur/submit if empty
- First empty row gets focus on submit attempt
- Clearing account clears the requirement

### 8.3 API Validation

**File:** `src/app/api/accounting/[...segments]/route.ts` (journal-entries POST/PATCH)

```typescript
// In journal entry create/update:
for (const line of body.lines) {
  if (line.account_id && !line.cost_center_id) {
    errors.push({
      field: `lines[${i}].cost_center_id`,
      message_ar: 'مركز التكلفة مطلوب عند اختيار الحساب',
      message_en: 'Cost center required when account is selected',
    });
  }
  // Verify cost center is active + same entity
  if (line.cost_center_id) {
    const cc = await getCostCenter(line.cost_center_id);
    if (!cc || !cc.is_active) {
      errors.push({ field: `lines[${i}].cost_center_id`, message_ar: 'مركز التكلفة غير نشط' });
    }
    if (cc && cc.legal_entity_id && cc.legal_entity_id !== entityCtx.legalEntityId) {
      errors.push({ field: `lines[${i}].cost_center_id`, message_ar: 'مركز التكلفة تابع لشركة أخرى' });
    }
  }
}
```

### 8.4 Scope Limitation

This enforcement applies ONLY to manual journals (source_module = 'manual'). Auto-posted journals from invoices, expenses, payroll, etc. are NOT affected — they may legitimately omit cost centers on AR/VAT/liability lines.

### 8.5 Acceptance Criteria

- [ ] Manual journal: selecting account without cost center blocks save
- [ ] Manual journal: inline error shows per line
- [ ] Cost center from different entity rejected
- [ ] Inactive cost center rejected
- [ ] Auto-posted journals (payroll, invoice) still succeed without cost center
- [ ] Reversal inherits cost centers from original
- [ ] Old drafts without cost center cannot be posted until filled

---

## 9. Phase 8 — Reports & Export (R7, R10)

### 9.1 Income Statement Redesign (R10)

**New file:** `src/components/accounting/reports/IncomeStatementReport.tsx`

View model structure:
```typescript
interface IncomeStatementSection {
  id: string;
  label_ar: string;
  label_en: string;
  rows: IncomeStatementRow[];
  total: number;
  expanded_by_default: boolean;
}

interface IncomeStatementRow {
  account_code: string;
  account_name_ar: string;
  account_name_en?: string;
  amount: number;
  children?: IncomeStatementRow[];
}

interface IncomeStatementResponse {
  sections: IncomeStatementSection[];  // Ordered: revenue, cost_of_revenue, operating_expense, other_income, other_expense
  gross_profit: number;      // revenue.total - cost_of_revenue.total
  operating_income: number;  // gross_profit - operating_expense.total
  net_profit: number;        // operating_income + other_income.total - other_expense.total
  period: { from: string; to: string };
  entity: { id: string; name_ar: string };
  currency: string;
}
```

**Server changes:** `src/lib/accounting/reports.ts` → `getProfitLoss`

Rewrite to:
1. Query posted journal lines for revenue/expense accounts in period + entity
2. Group by `statement_group` (primary) with `subtype` fallback
3. Build hierarchical sections using `parent_id` relationships
4. Calculate subtotals bottom-up (only `is_posting_account=true` contribute amounts)
5. Return structured response

**New file:** `src/components/accounting/reports/FinancialStatementSection.tsx`

Collapsible section component:
- `aria-expanded` / `aria-controls`
- Account codes in LTR within RTL page
- Negative values in parentheses
- Drill-down link to General Ledger

### 9.2 Cash Flow Correction (R7)

**File:** `src/lib/accounting/reports/statements/cash-flow.ts`

Fix opening balance calculation:
```typescript
// BEFORE (buggy): opening uses dateTo = dateFrom (includes first-day transactions)
// AFTER: opening uses dateTo = day before dateFrom
const openingDateTo = new Date(dateFrom);
openingDateTo.setDate(openingDateTo.getDate() - 1);
const openingCash = await sumCashAccounts(entityId, null, openingDateTo);

// Net change = movements in cash/bank accounts within [dateFrom, dateTo]
const netChange = await sumCashMovements(entityId, dateFrom, dateTo);

// Closing = opening + net (must reconcile)
const closingCash = openingCash + netChange;
const actualClosing = await sumCashAccounts(entityId, null, dateTo);
const reconciliationDiff = closingCash - actualClosing;
```

Move summary to bottom of report (after Operating/Investing/Financing sections).

### 9.3 Report Export System (R7)

**New file:** `src/lib/accounting/reports/registry.ts`

```typescript
interface ReportDefinition {
  id: string;
  title_ar: string;
  title_en: string;
  capability: AccountingCapability;
  supportedFormats: ('csv' | 'xlsx' | 'pdf')[];
  parameterSchema: z.ZodSchema;
  loader: (params: any, ctx: EntityContext) => Promise<any>;
  serializers: {
    csv?: (data: any) => string;
    xlsx?: (data: any) => Buffer;
    pdf?: (data: any) => Buffer;
  };
  filenamePattern: string; // e.g., '{report}_{entity}_{from}_{to}'
}

export const REPORT_REGISTRY: Record<string, ReportDefinition> = {
  'trial-balance': { /* ... */ },
  'general-ledger': { /* ... */ },
  'profit-loss': { /* ... */ },
  'balance-sheet': { /* ... */ },
  'cash-flow': { /* ... */ },
  'ar-aging': { /* ... */ },
  'ap-aging': { /* ... */ },
  'vat': { /* ... */ },
  // ... all reports
};
```

**New API endpoint:** `GET /api/accounting/reports/:reportId/export?format=csv|xlsx|pdf&...`

```typescript
// In route handler:
const report = REPORT_REGISTRY[reportId];
if (!report) return notFound();

// Check capability
if (!hasCapability(auth, report.capability)) return forbidden();

// Load data with same entity context
const data = await report.loader(params, entityCtx);

// Serialize
const serializer = report.serializers[format];
const content = await serializer(data);

// Return with proper headers
return new Response(content, {
  headers: {
    'Content-Type': MIME_TYPES[format],
    'Content-Disposition': `attachment; filename="${generateFilename(report, params, format)}"`,
  },
});
```

**CSV safety:** Neutralize cells starting with `=`, `+`, `-`, `@` (prepend with tab or single quote).

**New file:** `src/components/accounting/reports/ReportExportMenu.tsx`

```typescript
// Dropdown menu with CSV / Excel / PDF options
// Uses report registry to determine available formats
// Sends same filters/entity as current view
// Shows loading state per format
```

### 9.4 Acceptance Criteria

**Income Statement:**
- [ ] Sections appear in order: Revenue → Cost of Revenue → Gross Profit → Operating Expenses → Operating Income → Other Income → Other Expenses → Net Profit
- [ ] No raw field names or UUIDs shown
- [ ] Unmapped accounts shown as warning section
- [ ] Subtotals and formulas are correct
- [ ] Collapse/expand works with keyboard and screen reader

**Cash Flow:**
- [ ] Opening balance excludes first-day transactions
- [ ] Opening + Net = Closing (to the cent)
- [ ] Summary block at bottom, not top
- [ ] Reconciliation warning shown if difference exists

**Export:**
- [ ] Every report page has Export button
- [ ] CSV has UTF-8 BOM and Arabic headers
- [ ] No formula injection in CSV
- [ ] XLSX has RTL sheet, frozen headers, currency format
- [ ] PDF has Arabic font, entity name, period, generation time
- [ ] Export matches displayed data exactly

---

## 10. Phase 9 — Navigation (R5)

### 10.1 Navigation Manifest

**New file:** `src/components/accounting/navigation/finance-navigation.ts`

```typescript
export interface NavItem {
  id: string;
  label_ar: string;
  label_en: string;
  icon: string;
  path: string;
  capability?: AccountingCapability;
  children?: NavItem[];
}

export interface NavGroup {
  id: string;
  label_ar: string;
  label_en: string;
  items: NavItem[];
}

export const FINANCE_NAVIGATION: NavGroup[] = [
  {
    id: 'dashboard', label_ar: 'لوحة التحكم', label_en: 'Dashboard',
    items: [
      { id: 'main-dashboard', label_ar: 'الرئيسية', path: '/accounting', ... },
    ],
  },
  {
    id: 'customers', label_ar: 'العملاء', label_en: 'Customers',
    items: [
      { id: 'parties-customers', label_ar: 'الأطراف/العملاء', path: '/accounting/customers', ... },
      { id: 'invoices', label_ar: 'الفواتير', path: '/accounting/invoices', ... },
      { id: 'payments-in', label_ar: 'التحصيلات', path: '/accounting/payments?direction=in', ... },
      { id: 'netting', label_ar: 'تسوية AR/AP', path: '/accounting/netting', capability: 'party_netting:prepare', ... },
    ],
  },
  {
    id: 'vendors', label_ar: 'الموردون', label_en: 'Vendors',
    items: [
      { id: 'parties-vendors', label_ar: 'الموردون', path: '/accounting/vendors', ... },
      { id: 'expenses', label_ar: 'المصروفات', path: '/accounting/expenses', ... },
      { id: 'payments-out', label_ar: 'المدفوعات', path: '/accounting/payments?direction=out', ... },
    ],
  },
  {
    id: 'accounting', label_ar: 'المحاسبة', label_en: 'Accounting',
    items: [
      { id: 'journals', label_ar: 'القيود', path: '/accounting/journal-entries', ... },
      { id: 'coa', label_ar: 'دليل الحسابات', path: '/accounting/chart-of-accounts', ... },
      { id: 'cost-centers', label_ar: 'مراكز التكلفة', path: '/accounting/cost-centers', ... },
    ],
  },
  {
    id: 'banking', label_ar: 'البنوك', label_en: 'Banking',
    items: [
      { id: 'bank-accounts', label_ar: 'الحسابات البنكية', path: '/banking/accounts', ... },
      { id: 'statements', label_ar: 'الكشوف', path: '/banking/statements', ... },
      { id: 'reconciliation', label_ar: 'المطابقة', path: '/banking/reconciliation', ... },
    ],
  },
  {
    id: 'reports', label_ar: 'التقارير', label_en: 'Reports',
    items: [/* all report pages */],
  },
  {
    id: 'settings', label_ar: 'الإعدادات', label_en: 'Settings',
    items: [
      { id: 'entities', label_ar: 'الشركات', path: '/accounting/entity-setup', capability: 'settings', ... },
      { id: 'settings', label_ar: 'إعدادات المحاسبة', path: '/accounting/settings', capability: 'settings', ... },
      { id: 'team', label_ar: 'الفريق', path: '/accounting/team', capability: 'permissions:manage', ... },
    ],
  },
];
```

### 10.2 Top Navigation Component

**New file:** `src/components/accounting/navigation/AccountingWorkspaceNav.tsx`

- Renders as horizontal tab bar under the main Header
- Shows only on `/accounting/*` and `/banking/*` routes
- Each NavGroup is a dropdown trigger
- Active group + item highlighted
- RTL-first layout
- Responsive: horizontal scroll or "More" button on mobile
- Capability-filtered: items hidden if user lacks permission
- Keyboard navigable (arrow keys, Enter, Escape)

### 10.3 Layout Integration

**File:** `src/app/(app)/layout.tsx`

```typescript
// Add AccountingWorkspaceNav conditionally:
{isFinanceRoute && <AccountingWorkspaceNav />}
```

### 10.4 Acceptance Criteria

- [ ] All accounting + banking pages accessible from top nav
- [ ] Hidden items for users without capability
- [ ] Server-side route protection remains (nav hiding is UX only)
- [ ] Works on mobile with horizontal scroll
- [ ] RTL layout correct
- [ ] Keyboard navigation: Tab, Arrow, Enter, Escape all functional

---

## 11. Feature Flags & Rollout

### 11.1 Flags

| Flag | Controls | Default |
|------|----------|---------|
| `accounting_entity_enforcement` | Fail-closed context, entity header requirement | off |
| `unified_counterparties` | Party roles, financial profiles, new forms | off |
| `party_netting` | Netting workbench, open items | off |
| `banking_statement_commands` | Edit/Recall/Archive actions | off |
| `structured_income_statement` | New IS report format | off |
| `universal_report_export` | ReportExportMenu on all reports | off |
| `accounting_workspace_nav` | Top navigation tabs | off |

### 11.2 Rollout Order

```
Phase 1 (Permissions)     → No flag needed (security fix, always-on)
Phase 2 (Entity)          → accounting_entity_enforcement
Phase 3 (COA)             → No flag (additive schema, backward-compatible)
Phase 4 (Party)           → unified_counterparties
Phase 5 (Netting)         → party_netting (requires unified_counterparties)
Phase 6 (Banking)         → banking_statement_commands
Phase 7 (Cost Center)     → No flag (enforcement already in RPC, adding UI/API validation)
Phase 8 (Reports)         → structured_income_statement, universal_report_export
Phase 9 (Navigation)      → accounting_workspace_nav
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Area | File | Key Cases |
|------|------|-----------|
| Taxonomy | `tests/account-taxonomy.test.ts` | subtype-type validity, statement_group defaults |
| Netting math | `tests/party-netting-math.test.ts` | allocation residuals, many-to-many, over-allocation prevention |
| Cash flow | `tests/cash-flow-calc.test.ts` | exclusive boundary, opening+net=closing |
| CSV safety | `tests/csv-export-safety.test.ts` | formula injection neutralization |
| Permissions | `tests/accounting-permissions.test.ts` | capability resolution per role |
| Validation | `tests/journal-validation.test.ts` | cost center requirement per source module |

### 12.2 Integration Tests (Database)

| Area | Key Scenarios |
|------|--------------|
| Entity isolation | Cross-entity FK rejected; query returns only scoped data |
| Netting concurrency | Two concurrent nettings on same open item — one wins, one gets 409 |
| Bank state machine | Each transition validated; invalid transitions rejected |
| Numbering | Concurrent numbering across entities — no collision |
| Status normalization | lowercase/uppercase/mixed account_status all resolve correctly |

### 12.3 E2E Scenarios

1. A.Gaafar logs in → adds customer (no role change needed)
2. FM creates Related Party → assigns AR/AP → creates party
3. Issue customer invoice + approve vendor expense for same party
4. Full netting → verify GL + aging
5. Partial netting → verify residuals
6. Reverse netting → verify restoration
7. Switch entity → verify data isolation
8. Cross-entity access attempt → 403
9. Manual journal without cost center → blocked; with CC → succeeds
10. Bank statement: import → edit → start → recall → archive
11. Income statement: verify sections, totals, collapse/expand
12. Cash flow: verify bottom summary, opening excludes first day
13. Export all reports: CSV/XLSX/PDF format verification

---

## 13. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Entity selector without server enforcement | Phase 2 server changes MUST be live before UI selector is enabled |
| Split-brain banking models | v178 operates on `banking_*` only; `accounting_bank_*` marked read-only |
| Party model confusion (3 representations) | `accounting_parties` canonical; roles table for multi-role; legacy tables as compatibility facades |
| Global NOT NULL on cost center breaks auto-posting | Manual-only enforcement in Phase 7; global policy deferred |
| Income statement misclassification | Require `statement_group` mapping sign-off before enabling new report |
| Netting over-allocation | Row-level locks + version check + CHECK constraint on settled <= original |
| Export leaks cross-entity data | Export uses same entity context + loader as display |
| Recall deletes evidence | Soft lifecycle only; posted journals never deleted, only reversed |

---

## 14. Dependency Graph (Implementation Order)

```
Phase 0: Fix migration chain
    ↓
Phase 1: Identity/permissions hardening (R3)
    ↓
Phase 2: Entity context enforcement (R8)
    ↓                    ↓
Phase 3: COA/subtype    Phase 6: Bank commands (R2)
    ↓                    ↓
Phase 4: Unified party  Phase 7: Cost center (R9)
    ↓
Phase 5: AR/AP netting (R4+R6)
    ↓
Phase 8: Reports & Export (R7+R10)
    ↓
Phase 9: Navigation (R5)
```

Phases 6 and 7 can run in parallel with Phases 3-5 since they have no data dependencies on each other (only on Phase 2 entity context).

---

## 15. Estimated Effort

| Phase | Scope | Estimate |
|-------|-------|----------|
| 0 | Migration fix, baseline | 1-2 days |
| 1 | Identity/permissions | 3-4 days |
| 2 | Entity enforcement | 5-7 days |
| 3 | COA classification | 3-4 days |
| 4 | Unified party + open items | 7-10 days |
| 5 | AR/AP netting | 5-7 days |
| 6 | Bank commands | 3-4 days |
| 7 | Cost center | 2-3 days |
| 8 | Reports & export | 7-10 days |
| 9 | Navigation | 3-4 days |
| **Total** | | **~40-55 days** |

These are sequential estimates. With 2 engineers working parallel tracks (Phases 6+7 alongside 3+4+5), calendar time reduces to ~30-40 days.

---

## 16. Decisions Required Before Implementation

| # | Question | Recommendation | Impact if Deferred |
|---|----------|---------------|-------------------|
| 1 | AR/AP account codes per entity | CFO provides mapping | Blocks Phase 4 seed |
| 2 | Expense→statement_group mapping | CFO reviews workbook | Blocks Phase 8 IS report |
| 3 | Can accountant manage COA? | FM only (with explicit grant) | Affects Phase 3 capabilities |
| 4 | Netting: maker-checker or FM self-approve? | Maker-checker recommended | Affects Phase 5 workflow |
| 5 | Recall reconciled = reopen or revision? | Revision + reason | Affects Phase 6 command design |
| 6 | Export formats: all 3 from day 1? | Yes (CSV+XLSX+PDF) | Affects Phase 8 scope |
| 7 | Related party type taxonomy | IAS 24 categories | Affects Phase 4 schema |

---

## 17. Definition of Done

All requirements R1-R10 are complete when:

- [ ] Every financial write carries: org_id + entity_id + actor + version + idempotency key
- [ ] No direct browser mutation of authoritative tables (all via RPC commands)
- [ ] Accounts, parties, banking, reports are entity-isolated on the server
- [ ] A.Gaafar works with correct role, no special-case code
- [ ] AR/AP netting posts and reverses correctly, matches open items and GL
- [ ] Bank statement actions enforce state machine and permissions
- [ ] Manual journal requires cost center at all 3 layers (UI/API/DB)
- [ ] Income statement shows hierarchical sections matching GL
- [ ] Cash flow reconciles: opening + net = closing
- [ ] All reports have in-page export (CSV/XLSX/PDF)
- [ ] All tests pass (unit, integration, E2E)
- [ ] Migration verification green
- [ ] No unexplained Trial Balance / AR/AP / Cash variance after backfill
- [ ] CFO + Product Owner sign off UAT before general availability
