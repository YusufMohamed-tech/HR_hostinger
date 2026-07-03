# Technical Blueprint — Field Agent Management
## Tatwir Talent HRMS — SIM Distribution Module

> **Status:** Pre-development reference  
> **Based on codebase snapshot:** v46 (schema_v46_promoter_kiosk)  
> **Author:** Msaratech Dev Team

---

## 1. Architecture Overview

This feature slots into the existing system as a new sub-module under the `sales` feature flag. It introduces one new role (`Field_Agent`), one new kiosk route group, five new DB tables, and extends the existing `src/app/(app)/sales/` section with agent and stock management pages.

**Pattern parity:**

| Existing pattern | This feature mirrors it |
|---|---|
| `Promoter` role + `(kiosk)/promoter/` | `Field_Agent` role + `(kiosk)/agent/` |
| `PromoterScreens.tsx` (one file, all screens) | `AgentScreens.tsx` + `FieldAgentAdminScreens.tsx` |
| `src/lib/services/promoter.ts` | `src/lib/services/field-agents.ts` |
| `api/sales/promoter/[[...segments]]/route.ts` | `api/sales/agents/[[...segments]]/route.ts` |
| `requirePromoterAccess()` | `requireFieldAgentAccess()` |

---

## 2. New Role

### 2.1 TypeScript — `src/types/index.ts`

Add `"Field_Agent"` to the `Role` union:

```ts
// before
"Superadmin" | "Admin" | "Employee" | ... | "Promoter" | ...

// after
"Superadmin" | "Admin" | "Employee" | ... | "Promoter" | "Field_Agent" | ...
```

### 2.2 DB Enum — `org_role`

```sql
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'field_agent';
```

### 2.3 Role mapping — `src/lib/rbac.ts`

In `roleFromOrgRole()`:
```ts
case "field_agent": return "Field_Agent";
```

In `getDefaultPathForRole()`:
```ts
case "Field_Agent": return "/agent";
```

In `canAccessPath()` — add a new branch:
```ts
if (role === "Field_Agent") {
  return (
    normalizedPath.startsWith("/agent") ||
    normalizedPath.startsWith("/api/sales/agents") ||
    normalizedPath.startsWith("/attendance") ||
    normalizedPath.startsWith("/api/attendance") ||
    normalizedPath.startsWith("/notifications") ||
    normalizedPath.startsWith("/settings")
  );
}
```

Extend existing Sales/Sales_Manager API protection:
```ts
if (normalizedPath.startsWith("/api/sales/agents")) {
  return ["Admin", "Sales_Manager", "Field_Agent"].includes(role);
}
```

---

## 3. Database Schema

**File to create:** `db/schema_v47_field_agents.sql`

Follows all existing conventions:
- UUID PKs via `gen_random_uuid()`
- `organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
- `created_at` / `updated_at` with `touch_updated_at()` trigger
- RLS enabled on all tables
- Money columns as `numeric CHECK (value >= 0)`

### 3.1 `field_agents`

Stores agent profile data. Links to `org_members` for auth.

```sql
CREATE TABLE public.field_agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           text NOT NULL,
  phone               text NOT NULL,
  national_id         text NOT NULL,
  region              text,
  commission_rate     numeric NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  joined_at           date NOT NULL DEFAULT CURRENT_DATE,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

ALTER TABLE public.field_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view agents"
  ON public.field_agents FOR SELECT
  USING (organization_id = public.current_org_id());

CREATE POLICY "managers can manage agents"
  ON public.field_agents FOR ALL
  USING (
    organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager')
  );

CREATE TRIGGER trg_field_agents_updated_at
  BEFORE UPDATE ON public.field_agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### 3.2 `sim_units`

One row per physical SIM card. This is the core inventory table.

```sql
CREATE TYPE public.sim_status AS ENUM (
  'in_stock',
  'with_agent',
  'sold',
  'returned'
);

CREATE TABLE public.sim_units (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  iccid               text NOT NULL,
  sim_type            text NOT NULL DEFAULT 'prepaid',  -- prepaid | postpaid | data | corporate
  price               numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  status              public.sim_status NOT NULL DEFAULT 'in_stock',
  current_agent_id    uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  assigned_at         timestamptz,
  sold_at             timestamptz,
  sold_by_agent_id    uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  sold_price          numeric CHECK (sold_price >= 0),
  customer_name       text,
  added_by            uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, iccid)
);

ALTER TABLE public.sim_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members view sim units"
  ON public.sim_units FOR SELECT
  USING (organization_id = public.current_org_id());

CREATE POLICY "managers manage sim units"
  ON public.sim_units FOR ALL
  USING (
    organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager')
  );

-- Agents can only see their own SIMs (SELECT only)
CREATE POLICY "agents view own sims"
  ON public.sim_units FOR SELECT
  USING (
    organization_id = public.current_org_id()
    AND public.current_role() = 'field_agent'
    AND current_agent_id = (
      SELECT id FROM public.field_agents
      WHERE user_id = auth.uid() AND organization_id = public.current_org_id()
    )
  );

CREATE TRIGGER trg_sim_units_updated_at
  BEFORE UPDATE ON public.sim_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### 3.3 `sim_transfers`

Append-only audit log of every SIM movement (stock → agent, agent → sold, agent → returned).

```sql
CREATE TYPE public.sim_transfer_type AS ENUM (
  'assign_to_agent',    -- stock → agent
  'return_to_stock',    -- agent → stock
  'sold',               -- agent → customer
  'initial_import'      -- bulk import into stock
);

CREATE TABLE public.sim_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sim_unit_id         uuid NOT NULL REFERENCES public.sim_units(id) ON DELETE CASCADE,
  transfer_type       public.sim_transfer_type NOT NULL,
  from_agent_id       uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  to_agent_id         uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  performed_by        uuid NOT NULL REFERENCES auth.users(id),
  notes               text,
  transfer_date       timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
  -- no updated_at: append-only
);

ALTER TABLE public.sim_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members view transfers"
  ON public.sim_transfers FOR SELECT
  USING (organization_id = public.current_org_id());

CREATE POLICY "managers insert transfers"
  ON public.sim_transfers FOR INSERT
  WITH CHECK (
    organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager')
  );

-- Agents can insert their own sale transfers
CREATE POLICY "agents insert sale transfers"
  ON public.sim_transfers FOR INSERT
  WITH CHECK (
    organization_id = public.current_org_id()
    AND public.current_role() = 'field_agent'
    AND transfer_type = 'sold'
  );
```

### 3.4 `agent_cash_collections`

Records every cash collection event from an agent.

```sql
CREATE TABLE public.agent_cash_collections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  amount              numeric NOT NULL CHECK (amount > 0),
  payment_method      text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer')),
  collected_by        uuid NOT NULL REFERENCES auth.users(id),
  collection_date     date NOT NULL DEFAULT CURRENT_DATE,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_cash_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers view collections"
  ON public.agent_cash_collections FOR SELECT
  USING (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager'));

CREATE POLICY "managers insert collections"
  ON public.agent_cash_collections FOR INSERT
  WITH CHECK (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager'));

-- Agents view own collections
CREATE POLICY "agents view own collections"
  ON public.agent_cash_collections FOR SELECT
  USING (
    organization_id = public.current_org_id()
    AND public.current_role() = 'field_agent'
    AND agent_id = (
      SELECT id FROM public.field_agents
      WHERE user_id = auth.uid() AND organization_id = public.current_org_id()
    )
  );

CREATE TRIGGER trg_agent_cash_collections_updated_at
  BEFORE UPDATE ON public.agent_cash_collections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### 3.5 `agent_sim_requests`

Agent requests new SIM stock from management.

```sql
CREATE TABLE public.agent_sim_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  quantity            integer NOT NULL CHECK (quantity > 0),
  sim_type            text,
  notes               text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'delivered')),
  reviewed_by         uuid REFERENCES auth.users(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_sim_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers view all requests"
  ON public.agent_sim_requests FOR SELECT
  USING (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager'));

CREATE POLICY "managers update requests"
  ON public.agent_sim_requests FOR UPDATE
  USING (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager'));

-- Agents manage own requests
CREATE POLICY "agents manage own requests"
  ON public.agent_sim_requests FOR ALL
  USING (
    organization_id = public.current_org_id()
    AND agent_id = (
      SELECT id FROM public.field_agents
      WHERE user_id = auth.uid() AND organization_id = public.current_org_id()
    )
  );

CREATE TRIGGER trg_agent_sim_requests_updated_at
  BEFORE UPDATE ON public.agent_sim_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### 3.6 `agent_commissions`

Computed commission record per sale. Written when a `sold` transfer is created.

```sql
CREATE TABLE public.agent_commissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES public.field_agents(id) ON DELETE CASCADE,
  sim_unit_id         uuid NOT NULL REFERENCES public.sim_units(id) ON DELETE CASCADE,
  sale_price          numeric NOT NULL CHECK (sale_price >= 0),
  commission_rate     numeric NOT NULL CHECK (commission_rate >= 0),
  commission_amount   numeric NOT NULL CHECK (commission_amount >= 0),
  is_paid             boolean NOT NULL DEFAULT false,
  paid_at             timestamptz,
  paid_by             uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sim_unit_id)  -- one commission row per SIM
);

ALTER TABLE public.agent_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers view all commissions"
  ON public.agent_commissions FOR SELECT
  USING (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager'));

CREATE POLICY "managers manage commissions"
  ON public.agent_commissions FOR ALL
  USING (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'sales_manager'));

CREATE POLICY "agents view own commissions"
  ON public.agent_commissions FOR SELECT
  USING (
    organization_id = public.current_org_id()
    AND public.current_role() = 'field_agent'
    AND agent_id = (
      SELECT id FROM public.field_agents
      WHERE user_id = auth.uid() AND organization_id = public.current_org_id()
    )
  );

CREATE TRIGGER trg_agent_commissions_updated_at
  BEFORE UPDATE ON public.agent_commissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

---

## 4. TypeScript Types

**New file:** `src/types/field-agents.ts`

```ts
export type SimStatus = "in_stock" | "with_agent" | "sold" | "returned";
export type SimTransferType = "assign_to_agent" | "return_to_stock" | "sold" | "initial_import";
export type SimRequestStatus = "pending" | "approved" | "rejected" | "delivered";
export type PaymentMethod = "cash" | "bank_transfer";
export type AgentStatus = "active" | "suspended";

export interface FieldAgent {
  id: string;
  organization_id: string;
  user_id: string;
  full_name: string;
  phone: string;
  national_id: string;
  region: string | null;
  commission_rate: number;
  status: AgentStatus;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface SimUnit {
  id: string;
  organization_id: string;
  iccid: string;
  sim_type: string;
  price: number;
  status: SimStatus;
  current_agent_id: string | null;
  assigned_at: string | null;
  sold_at: string | null;
  sold_by_agent_id: string | null;
  sold_price: number | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimTransfer {
  id: string;
  organization_id: string;
  sim_unit_id: string;
  transfer_type: SimTransferType;
  from_agent_id: string | null;
  to_agent_id: string | null;
  performed_by: string;
  notes: string | null;
  transfer_date: string;
  created_at: string;
}

export interface AgentCashCollection {
  id: string;
  organization_id: string;
  agent_id: string;
  amount: number;
  payment_method: PaymentMethod;
  collected_by: string;
  collection_date: string;
  notes: string | null;
  created_at: string;
}

export interface AgentSimRequest {
  id: string;
  organization_id: string;
  agent_id: string;
  quantity: number;
  sim_type: string | null;
  notes: string | null;
  status: SimRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentCommission {
  id: string;
  organization_id: string;
  agent_id: string;
  sim_unit_id: string;
  sale_price: number;
  commission_rate: number;
  commission_amount: number;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
}

// Derived / aggregated shapes used by UI

export interface AgentBalance {
  total_sold_value: number;      // sum of sold_price for all sold SIMs by agent
  total_collected: number;       // sum of all cash collections
  outstanding: number;           // total_sold_value - total_collected
}

export interface AgentStockSummary {
  in_hand: number;               // SIMs with_agent
  sold_total: number;            // SIMs sold
  in_hand_value: number;
}

export interface AgentDashboardData {
  agent: FieldAgent;
  balance: AgentBalance;
  stock: AgentStockSummary;
  pending_requests: number;
  unpaid_commission: number;
}

export interface StockOverview {
  in_stock: number;
  with_agents: number;
  sold: number;
  returned: number;
  total_value_in_stock: number;
  by_agent: { agent_id: string; full_name: string; count: number }[];
}
```

---

## 5. Validation Schemas

**New file:** `src/lib/field-agents/schemas.ts`

```ts
import { z } from "zod";

export const createAgentSchema = z.object({
  full_name:       z.string().min(2),
  phone:           z.string().min(8),
  national_id:     z.string().min(5),
  region:          z.string().optional(),
  commission_rate: z.number().min(0).max(100),
  user_id:         z.string().uuid(),
});

export const assignSimsSchema = z.object({
  agent_id:  z.string().uuid(),
  sim_ids:   z.array(z.string().uuid()).min(1),
  notes:     z.string().optional(),
});

export const recordSaleSchema = z.object({
  sim_unit_id:   z.string().uuid(),
  sold_price:    z.number().min(0),
  customer_name: z.string().optional(),
});

export const collectCashSchema = z.object({
  agent_id:        z.string().uuid(),
  amount:          z.number().positive(),
  payment_method:  z.enum(["cash", "bank_transfer"]),
  collection_date: z.string(),
  notes:           z.string().optional(),
});

export const simRequestSchema = z.object({
  quantity: z.number().int().positive(),
  sim_type: z.string().optional(),
  notes:    z.string().optional(),
});

export const reviewRequestSchema = z.object({
  status:      z.enum(["approved", "rejected"]),
  review_note: z.string().optional(),
});

export const importSimsSchema = z.object({
  sims: z.array(z.object({
    iccid:    z.string().min(18).max(22),
    sim_type: z.string().default("prepaid"),
    price:    z.number().min(0),
  })).min(1),
});
```

---

## 6. Server Auth Guard

**New file:** `src/lib/server/field-agent-auth.ts`

Mirrors the pattern of `src/lib/server/promoter-auth.ts`.

```ts
import { requireTenantContext } from "./tenant-context";

const managerRoles = ["admin", "sales_manager"] as const;
const agentRoles   = ["field_agent"] as const;
const allRoles     = [...managerRoles, ...agentRoles] as const;

export async function requireFieldAgentAccess() {
  const ctx = await requireTenantContext({ feature: "sales" });
  if ("error" in ctx) return ctx;
  if (!allRoles.includes(ctx.role as typeof allRoles[number])) {
    return { error: ctx.forbidden() };
  }
  return { ...ctx, isManager: managerRoles.includes(ctx.role as typeof managerRoles[number]) };
}

export async function requireFieldAgentManager() {
  const ctx = await requireTenantContext({ feature: "sales" });
  if ("error" in ctx) return ctx;
  if (!managerRoles.includes(ctx.role as typeof managerRoles[number])) {
    return { error: ctx.forbidden() };
  }
  return ctx;
}
```

---

## 7. Service Layer

**New file:** `src/lib/services/field-agents.ts`

Mirrors `src/lib/services/promoter.ts` exactly — client-side, no Supabase direct calls.

```ts
import type {
  FieldAgent, SimUnit, SimTransfer, AgentCashCollection,
  AgentSimRequest, AgentCommission, AgentDashboardData,
  StockOverview,
} from "@/types/field-agents";

type ApiResult<T> = { data: T | null; error: { message: string } | null };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.message ?? "خطأ في الطلب" } };
    return { data: json.data, error: null };
  } catch {
    return { data: null, error: { message: "خطأ في الاتصال" } };
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function qs(p?: Record<string, string | number | boolean | null | undefined>) {
  if (!p) return "";
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== "") s.set(k, String(v));
  }
  const t = s.toString();
  return t ? `?${t}` : "";
}

const BASE = "/api/sales/agents";

// Agents
export const getFieldAgents   = (p?: Record<string, string | number | boolean | null | undefined>) =>
  apiFetch<FieldAgent[]>(BASE + qs(p));
export const getFieldAgent    = (id: string) => apiFetch<FieldAgent>(`${BASE}/${id}`);
export const createFieldAgent = (body: Record<string, unknown>) =>
  apiFetch<FieldAgent>(BASE, jsonInit("POST", body));
export const updateFieldAgent = (id: string, body: Record<string, unknown>) =>
  apiFetch<FieldAgent>(`${BASE}/${id}`, jsonInit("PATCH", body));

// SIM inventory
export const getSimUnits      = (p?: Record<string, string | number | boolean | null | undefined>) =>
  apiFetch<SimUnit[]>(`${BASE}/sims` + qs(p));
export const importSims       = (body: Record<string, unknown>) =>
  apiFetch<{ imported: number }>(`${BASE}/sims/import`, jsonInit("POST", body));
export const assignSims       = (body: Record<string, unknown>) =>
  apiFetch<{ assigned: number }>(`${BASE}/sims/assign`, jsonInit("POST", body));
export const recordSale       = (body: Record<string, unknown>) =>
  apiFetch<SimUnit>(`${BASE}/sims/sell`, jsonInit("POST", body));

// Transfers
export const getSimTransfers  = (p?: Record<string, string | number | boolean | null | undefined>) =>
  apiFetch<SimTransfer[]>(`${BASE}/transfers` + qs(p));

// Cash collections
export const getCashCollections = (agentId: string) =>
  apiFetch<AgentCashCollection[]>(`${BASE}/${agentId}/collections`);
export const collectCash      = (body: Record<string, unknown>) =>
  apiFetch<AgentCashCollection>(`${BASE}/collect`, jsonInit("POST", body));

// SIM requests
export const getSimRequests   = (p?: Record<string, string | number | boolean | null | undefined>) =>
  apiFetch<AgentSimRequest[]>(`${BASE}/requests` + qs(p));
export const createSimRequest = (body: Record<string, unknown>) =>
  apiFetch<AgentSimRequest>(`${BASE}/requests`, jsonInit("POST", body));
export const reviewSimRequest = (id: string, body: Record<string, unknown>) =>
  apiFetch<AgentSimRequest>(`${BASE}/requests/${id}/review`, jsonInit("PATCH", body));

// Commissions
export const getCommissions   = (p?: Record<string, string | number | boolean | null | undefined>) =>
  apiFetch<AgentCommission[]>(`${BASE}/commissions` + qs(p));
export const markCommissionPaid = (id: string) =>
  apiFetch<AgentCommission>(`${BASE}/commissions/${id}/pay`, jsonInit("PATCH", {}));

// Dashboard / overview
export const getAgentDashboard  = () => apiFetch<AgentDashboardData>(`${BASE}/me/dashboard`);
export const getStockOverview   = () => apiFetch<StockOverview>(`${BASE}/stock/overview`);
```

---

## 8. API Routes

### 8.1 Route file

**New file:** `src/app/api/sales/agents/[[...segments]]/route.ts`

Uses the same catch-all segment-dispatch pattern as `api/sales/promoter/[[...segments]]/route.ts`.

```
Segments map:
  GET  /api/sales/agents                    → list agents         (manager)
  POST /api/sales/agents                    → create agent        (manager)
  GET  /api/sales/agents/[id]               → get agent           (manager)
  PATCH /api/sales/agents/[id]              → update agent        (manager)

  GET  /api/sales/agents/sims               → list SIMs           (manager)
  POST /api/sales/agents/sims/import        → bulk import SIMs    (manager)
  POST /api/sales/agents/sims/assign        → assign SIMs to agent (manager)
  POST /api/sales/agents/sims/sell          → record sale         (agent)

  GET  /api/sales/agents/transfers          → list transfers      (manager)

  GET  /api/sales/agents/[id]/collections   → agent collections   (manager)
  POST /api/sales/agents/collect            → record collection   (manager)

  GET  /api/sales/agents/requests           → list requests       (manager + agent)
  POST /api/sales/agents/requests           → create request      (agent)
  PATCH /api/sales/agents/requests/[id]/review → review request   (manager)

  GET  /api/sales/agents/commissions        → list commissions    (manager)
  PATCH /api/sales/agents/commissions/[id]/pay → mark paid        (manager)

  GET  /api/sales/agents/me/dashboard       → agent's own stats   (agent)
  GET  /api/sales/agents/stock/overview     → stock totals        (manager)
```

### 8.2 Key business logic inside handlers

**`POST /sims/sell`** — atomic operation:
1. Validate `recordSaleSchema`
2. Confirm `sim_unit.status === 'with_agent'` and `sim_unit.current_agent_id === auth.agent.id`
3. `UPDATE sim_units SET status='sold', sold_at=now(), sold_by_agent_id, sold_price, customer_name`
4. `INSERT sim_transfers` with `transfer_type='sold'`
5. Compute commission: `commission_amount = sold_price * (agent.commission_rate / 100)`
6. `INSERT agent_commissions`
7. Return updated `SimUnit`

**`POST /sims/assign`** — atomic operation:
1. Validate `assignSimsSchema`
2. Confirm all SIMs have `status='in_stock'`
3. `UPDATE sim_units SET status='with_agent', current_agent_id, assigned_at=now()` (batch)
4. `INSERT sim_transfers` rows for each SIM (batch)
5. Return `{ assigned: N }`

**`POST /collect`**:
1. Validate `collectCashSchema`
2. `INSERT agent_cash_collections`
3. Return inserted row

---

## 9. File Structure

All new files to create:

```
db/
  schema_v47_field_agents.sql                         ← all 6 tables + RLS + enums

src/
  types/
    field-agents.ts                                   ← all domain types

  lib/
    field-agents/
      schemas.ts                                      ← zod schemas
    server/
      field-agent-auth.ts                             ← requireFieldAgentAccess / requireFieldAgentManager
    services/
      field-agents.ts                                 ← client fetch functions

  app/
    api/
      sales/
        agents/
          [[...segments]]/
            route.ts                                  ← all API handlers

    (kiosk)/
      agent/
        page.tsx                                      ← renders <AgentKioskScreen />
        layout.tsx                                    ← reuse (kiosk)/layout.tsx pattern (AuthGuard only)

    (app)/
      sales/
        agents/
          page.tsx                                    ← renders <AgentListScreen />
        agents/[id]/
          page.tsx                                    ← renders <AgentDetailScreen />
        stock/
          page.tsx                                    ← renders <StockManagementScreen />

  components/
    field-agents/
      AgentScreens.tsx                               ← all (kiosk) agent screens
      FieldAgentAdminScreens.tsx                     ← all admin-side screens
```

### Files to modify:

| File | Change |
|---|---|
| `src/types/index.ts` | Add `"Field_Agent"` to `Role` union |
| `src/lib/rbac.ts` | `roleFromOrgRole`, `getDefaultPathForRole`, `canAccessPath` |
| `src/middleware.ts` | Feature flag check for `/agent` path prefix |
| `src/components/layout/Sidebar.tsx` | New nav sections for `Field_Agent` role + admin additions |

---

## 10. Sidebar Nav

**In `src/components/layout/Sidebar.tsx`** — add two blocks:

**Field_Agent role nav:**
```ts
if (role === "Field_Agent") {
  return [{
    title: "المندوب",
    links: [
      { name: "الرئيسية",       href: "/agent",              icon: LayoutDashboard },
      { name: "شرائحي",         href: "/agent/sims",         icon: SimCard },
      { name: "تسجيل مبيعة",   href: "/agent/sell",         icon: ShoppingCart },
      { name: "طلب شرائح",      href: "/agent/requests",     icon: PackagePlus },
      { name: "رصيدي",          href: "/agent/balance",      icon: Wallet },
      { name: "عمولاتي",        href: "/agent/commissions",  icon: BadgePercent },
    ],
  }, { title: "النظام", links: system }];
}
```

**Sales_Manager additions** — append after existing sales links:
```ts
{ name: "المندوبون",     href: "/sales/agents",  icon: Users,      indent: false },
{ name: "إدارة المخزون", href: "/sales/stock",   icon: Archive,    indent: false },
```

---

## 11. Agent Kiosk Component Structure

**`src/components/field-agents/AgentScreens.tsx`**

Screen components (all `"use client"`):

| Component | Route | Description |
|---|---|---|
| `AgentKioskScreen` | `/agent` | Dashboard: SIM count, outstanding balance, commission |
| `AgentSimListScreen` | `/agent/sims` | List of SIMs in hand with ICCID + type |
| `AgentSellScreen` | `/agent/sell` | Record a sale — select SIM, enter price |
| `AgentRequestScreen` | `/agent/requests` | Submit + track stock requests |
| `AgentBalanceScreen` | `/agent/balance` | Financial breakdown: sold / collected / outstanding |
| `AgentCommissionsScreen` | `/agent/commissions` | Commission per sale + totals |

Data fetching pattern — same as `PromoterKioskScreen`:
```ts
useEffect(() => {
  getAgentDashboard().then(({ data }) => { if (data) setDashboard(data); });
}, []);
```

---

## 12. Admin Component Structure

**`src/components/field-agents/FieldAgentAdminScreens.tsx`**

| Component | Route | Description |
|---|---|---|
| `AgentListScreen` | `/sales/agents` | Table of all agents: name, region, SIMs in hand, balance, status |
| `AgentDetailScreen` | `/sales/agents/[id]` | Full agent profile: transactions, collections, commissions, performance |
| `StockManagementScreen` | `/sales/stock` | Stock overview + per-SIM list with filters; import/assign actions |
| `AssignSimsDialog` | — (modal) | Multi-select SIMs → choose agent → confirm |
| `CollectCashDialog` | — (modal) | Record cash collection from agent |
| `ReviewRequestDialog` | — (modal) | Approve/reject a SIM request |

---

## 13. Implementation Order

Execute in this sequence to avoid blockers:

```
Phase 1 — Foundation (no UI)
  1. db/schema_v47_field_agents.sql             ← run migration
  2. src/types/field-agents.ts                  ← types first
  3. src/lib/field-agents/schemas.ts            ← zod schemas
  4. src/types/index.ts                         ← add Field_Agent role
  5. src/lib/rbac.ts                            ← role mapping + route access
  6. src/middleware.ts                          ← /agent path + feature flag
  7. src/lib/server/field-agent-auth.ts         ← auth guard

Phase 2 — API
  8. src/app/api/sales/agents/[[...segments]]/route.ts

Phase 3 — Service
  9. src/lib/services/field-agents.ts

Phase 4 — Admin UI
  10. src/components/field-agents/FieldAgentAdminScreens.tsx
  11. src/app/(app)/sales/agents/page.tsx
  12. src/app/(app)/sales/agents/[id]/page.tsx
  13. src/app/(app)/sales/stock/page.tsx
  14. src/components/layout/Sidebar.tsx         ← add admin nav items

Phase 5 — Agent Kiosk
  15. src/components/field-agents/AgentScreens.tsx
  16. src/app/(kiosk)/agent/layout.tsx
  17. src/app/(kiosk)/agent/page.tsx
  18. src/components/layout/Sidebar.tsx         ← add Field_Agent nav
```

---

## 14. Open Questions (from BRD §8)

These answers will affect implementation before Phase 2:

| # | Question | Impact |
|---|---|---|
| Q2 | Commission: % of sale price or flat amount per SIM? | `agent_commissions` schema + calculation in `/sims/sell` handler |
| Q4 | Is `price` set per SIM in stock, or does agent enter it at sale time? | `recordSaleSchema` — `sold_price` required vs optional |
| Q3 | Can agent return a SIM to stock? | Add `POST /sims/return` handler + `return_to_stock` transfer type (already in schema, just needs the route) |
| Q6 | Max SIM cap per agent? | Add `max_sim_capacity` to `field_agents` table; enforce in `/sims/assign` handler |

---

*Blueprint v1.0 — matches codebase at schema v46*  
*Next step: client approves BRD → answer Q2/Q4 → start Phase 1*
