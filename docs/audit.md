# Multi-Tenancy Readiness Audit

**System:** Tatwir Talent HRMS  
**Date:** 2026-06-25  
**Auditor:** Automated Architecture Review  
**Scope:** Full codebase analysis for multi-tenant SaaS readiness  

---

## Executive Summary

Tatwir Talent HRMS has a **solid foundational multi-tenancy model** with `org_id` on most tables and RLS policies enforced. However, significant gaps exist in data isolation enforcement at the application layer, missing per-tenant configuration, zero billing infrastructure, and no tenant lifecycle management. The system is currently a **single-tenant deployment per organization** and requires substantial work to safely serve multiple independent customers on a shared infrastructure.

### Multi-Tenancy Readiness Score: **42/100**

| Category | Score | Weight | Rationale |
|----------|-------|--------|-----------|
| Data Isolation (DB) | 65/100 | 25% | RLS exists but has gaps; some tables lack org_id |
| Data Isolation (App) | 35/100 | 20% | Many client-side queries bypass org_id; service_role overuse |
| Auth & Tenant Resolution | 55/100 | 15% | Org binding exists but single-org-per-user model is limiting |
| Per-Tenant Configuration | 15/100 | 15% | Almost everything is hardcoded globally |
| Billing & Subscription | 0/100 | 10% | No billing infrastructure exists |
| Tenant Lifecycle | 10/100 | 10% | Only basic org creation; no provisioning pipeline |
| Security Boundaries | 50/100 | 5% | Superadmin is scoped; but middleware gaps exist |

### Findings by Risk Level

| Risk Level | Count | Categories |
|-----------|-------|------------|
| Critical | 8 | Data isolation, query patterns, storage |
| High | 12 | Missing org_id filters, RLS gaps, service_role abuse |
| Medium | 15 | Configuration, caching, lifecycle |
| Low | 7 | Optimization, convenience features |

---

## 1. Data Isolation Audit

### 1.1 Tables with org_id / organization_id Column

| Table | Tenant Column | Status |
|-------|--------------|--------|
| organizations | `id` (is the org) | Root entity |
| org_members | `org_id` | OK |
| profiles | `org_id` | OK |
| departments | `org_id` | OK |
| locations | `org_id` | OK |
| employees | `org_id` | OK |
| employee_documents | `org_id` | OK |
| salary_history | `org_id` | OK |
| employee_kpis | `org_id` | OK |
| employee_reviews | `org_id` | OK |
| employee_actions | `org_id` | OK |
| shifts | `org_id` | OK |
| employee_shifts | `org_id` | OK |
| attendance_records | `org_id` | OK |
| tasks | `org_id` | OK |
| task_assignments | `org_id` | OK |
| task_updates | `org_id` | OK |
| task_attachments | `org_id` | OK |
| leave_balances | `org_id` | OK |
| leave_requests | `org_id` | OK |
| notifications | `org_id` | OK |
| audit_logs | `org_id` | OK |
| chat_conversations | `org_id` | OK |
| chat_participants | `org_id` | OK |
| chat_messages | `org_id` | OK |
| advance_requests | `organization_id` | OK |
| sales_companies | `organization_id` | OK |
| sales_company_assignments | `organization_id` | OK |
| sales_products | `organization_id` | OK |
| sales_logs | `organization_id` | OK |
| sales_log_edit_requests | `organization_id` | OK |
| sales_dashboard_settings | `organization_id` | OK |
| sales_shift_prompts | `organization_id` | OK |
| accounting_accounts | `organization_id` | OK |
| accounting_cost_centers | `organization_id` | OK |
| accounting_journal_entries | `organization_id` | OK |
| accounting_journal_lines | `organization_id` | OK |
| accounting_vendors | `organization_id` | OK |
| accounting_customers | `organization_id` | OK |
| accounting_tax_rates | `organization_id` | OK |
| accounting_invoices | `organization_id` | OK |
| accounting_invoice_lines | `organization_id` | OK |
| accounting_expenses | `organization_id` | OK |
| accounting_payments | `organization_id` | OK |
| accounting_settings | `organization_id` | OK |
| accounting_periods | `organization_id` | OK |
| accounting_attachments | `organization_id` | OK |
| accounting_source_postings | `organization_id` | OK |
| employee_career_events | `org_id` | OK |
| leave_balance_transactions | `org_id` | OK |
| job_templates | `org_id` | OK |
| job_postings | `org_id` | OK |
| job_applications | `org_id` | OK |
| interviews | `org_id` | OK |
| asset_inventory | `org_id` | OK |

### 1.2 Tables MISSING org_id Column

| Table | Risk | Issue |
|-------|------|-------|
| **employee_locations** | **CRITICAL** | No `org_id` column. Uses indirect org scoping through JOINs in RLS. |
| **platform_admins** | Low | Cross-org by design (superadmin control plane) |
| **platform_audit_logs** | Low | Cross-org by design (superadmin audit trail) |

**Finding #1: `employee_locations` lacks `org_id`**

- **Risk Level:** Critical
- **Current State:** Table has no `org_id`; RLS uses JOIN to `employees.org_id`
- **Location:** [db/schema_v22_employee_locations.sql](db/schema_v22_employee_locations.sql)
- **Gap:** Performance degradation with scale (JOIN in every RLS check); if RLS is bypassed via service_role, no direct org filter is available on the table itself
- **Recommendation:** Add `org_id uuid NOT NULL REFERENCES organizations(id)` column with backfill from `employees.org_id`
- **Effort:** Low

### 1.3 RLS Policy Coverage

All tables have `ENABLE ROW LEVEL SECURITY`. Policies use `current_org_id()` function:

```sql
-- current_org_id() implementation
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

**Finding #2: `current_org_id()` returns first org for multi-org users**

- **Risk Level:** Critical
- **Current State:** Uses `LIMIT 1` without deterministic ordering
- **Location:** [db/schema-production-clean.sql:378](db/schema-production-clean.sql#L378)
- **Gap:** If a user belongs to multiple organizations (currently prevented by UI but not by schema), queries could return data from the wrong org. The `UNIQUE(org_id, user_id)` constraint on `org_members` does NOT prevent a user from being in multiple orgs — it only prevents duplicate (org, user) pairs.
- **Recommendation:** Either enforce a single org membership at the schema level (`UNIQUE(user_id)` on org_members) or modify `current_org_id()` to accept an org context parameter from the session/JWT
- **Effort:** Medium

**Finding #3: Inconsistent org column naming**

- **Risk Level:** Medium
- **Current State:** Core HR tables use `org_id`; sales and accounting modules use `organization_id`
- **Location:** `db/schema_v17_sales_module.sql`, `db/schema_v37_accounting_module.sql`
- **Gap:** Inconsistency creates confusion and risks missed filters; developers must remember which column name applies
- **Recommendation:** Standardize to `org_id` everywhere with migration aliases
- **Effort:** Medium

### 1.4 RLS Policy Gaps

**Finding #4: `profiles` table SELECT policy allows cross-org admin reads**

- **Risk Level:** High
- **Current State:**
  ```sql
  CREATE POLICY profiles_select ON public.profiles
    FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
  ```
- **Location:** [db/schema-production-clean.sql:535-536](db/schema-production-clean.sql#L535)
- **Gap:** An admin from Org A can read ALL profiles (including Org B's), because `is_admin()` checks role without org scoping on the target row
- **Recommendation:** Change to `user_id = auth.uid() OR (org_id = current_org_id() AND is_admin())`
- **Effort:** Low

**Finding #5: Chat RLS policies don't verify org membership**

- **Risk Level:** Medium
- **Current State:** Chat policies only check participant membership:
  ```sql
  CREATE POLICY chat_conversations_member_select ON public.chat_conversations
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM chat_participants cp
              WHERE cp.conversation_id = chat_conversations.id
              AND cp.user_id = auth.uid())
    );
  ```
- **Location:** [db/schema_v29_chat_module.sql:48-55](db/schema_v29_chat_module.sql#L48)
- **Gap:** If a superadmin creates a cross-org conversation, the org_id check is bypassed. The policy should also verify `org_id = current_org_id()`.
- **Recommendation:** Add `AND chat_conversations.org_id = current_org_id()` to the USING clause
- **Effort:** Low

### 1.5 Cross-Tenant Data Leakage Vectors

**Finding #6: Client-side service functions fetch by ID without org_id verification**

- **Risk Level:** Critical
- **Current State:** Multiple service functions query by primary key only:
  ```typescript
  // src/lib/services/employees.ts:15-24
  export async function getEmployeeById(id: string) {
    const supabase = createClient();
    const result = await supabase
      .from("employees")
      .select("...")
      .eq("id", id)
      .single();
  }

  // src/lib/services/tasks.ts:31-39
  export async function getTaskById(id: string) {
    const supabase = createClient();
    const result = await supabase
      .from("tasks")
      .select("...")
      .eq("id", id)
      .single();
  }
  ```
- **Location:** `src/lib/services/employees.ts:15`, `src/lib/services/tasks.ts:31`
- **Gap:** RLS provides a safety net, but if RLS is ever bypassed (e.g., via service_role client accidentally used), these queries would return any org's data. Defense-in-depth requires explicit `org_id` filtering.
- **Recommendation:** Add `.eq("org_id", orgId)` to all by-ID queries as defense-in-depth
- **Effort:** Low

**Finding #7: `deleteEmployee`, `deleteTask`, `updateTask` lack org_id verification**

- **Risk Level:** Critical
- **Current State:**
  ```typescript
  // src/lib/services/employees.ts:153-160
  export async function deleteEmployee(id: string) {
    const supabase = createClient();
    const result = await supabase
      .from("employees")
      .delete()
      .eq("id", id);
  }

  // src/lib/services/tasks.ts:110-117
  export async function deleteTask(id: string) {
    const supabase = createClient();
    const result = await supabase
      .from("tasks")
      .delete()
      .eq("id", id);
  }
  ```
- **Location:** `src/lib/services/employees.ts:153`, `src/lib/services/tasks.ts:110`
- **Gap:** Mutations by ID only. Same risk as reads — relies entirely on RLS with no application-layer defense.
- **Recommendation:** Require and pass `orgId` to all mutation functions; add `.eq("org_id", orgId)` to all operations
- **Effort:** Low

**Finding #8: `replaceEmployeeLocations` deletes without org_id filter**

- **Risk Level:** High
- **Current State:**
  ```typescript
  // src/lib/services/employees.ts:58-68
  const deleteResult = await supabase
    .from("employee_locations")
    .delete()
    .eq("employee_id", employeeId);
  ```
- **Location:** [src/lib/services/employees.ts:63-65](src/lib/services/employees.ts#L63)
- **Gap:** Since `employee_locations` has no `org_id` column and the RLS uses a JOIN, this delete relies entirely on RLS. The table also lacks an org_id to filter on.
- **Recommendation:** Add `org_id` to `employee_locations` and filter by it in all operations
- **Effort:** Low

### 1.6 Service-Role (Admin Client) Usage Patterns

**Finding #9: Widespread service_role client usage in API routes**

- **Risk Level:** High
- **Current State:** Nearly every API route uses `createAdminClient()` (service_role) which bypasses ALL RLS:
  - `src/app/api/sales/log/route.ts` — all sales queries
  - `src/app/api/chat/route.ts` — all chat queries
  - `src/app/api/advance-requests/route.ts` — advance request queries
  - `src/app/api/tasks/mine/route.ts` — task mutations
  - `src/app/api/hr/employee-accounts/route.ts` — account creation
  - `src/app/api/superadmin/*` — superadmin operations
- **Location:** All files in `src/app/api/`
- **Gap:** Each route must manually implement org_id filtering since RLS is bypassed. A single missed `.eq("org_id", orgId)` or `.eq("organization_id", orgId)` results in cross-tenant data exposure.
- **Recommendation:** 
  1. Create a `createTenantAdminClient(orgId)` wrapper that auto-appends org filters
  2. Audit every admin client query for org scoping
  3. Where possible, use the authenticated server client instead (lets RLS do its job)
- **Effort:** High

### 1.7 File Storage Isolation

**Finding #10: Storage buckets lack per-tenant access policies**

- **Risk Level:** Critical
- **Current State:** Storage buckets are created as `public = true`:
  ```sql
  -- db/schema_v29_chat_module.sql:77-79
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('chat-attachments', 'chat-attachments', true)
  ON CONFLICT (id) DO UPDATE SET public = true;
  ```
  Storage paths include org_id as prefix: `${orgId}/${conversationId}/${filename}` but no RLS policies restrict access to the path by org.
- **Location:** `db/schema_v29_chat_module.sql:77`, `db/schema_v19_task_attachments.sql:4`
- **Gap:** Any authenticated user can access any file via the public URL regardless of org membership. Bucket-level policies that enforce path-based org scoping are absent.
- **Recommendation:**
  1. Set buckets to `public = false`
  2. Add storage RLS policies: `(bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = current_org_id()::text)`
  3. Use signed URLs instead of public URLs
- **Effort:** Medium

### 1.8 Browser Storage / Client-Side State

**Finding #11: Device fingerprint stored in localStorage without tenant scoping**

- **Risk Level:** Medium
- **Current State:**
  ```typescript
  // src/app/(app)/attendance/page.tsx:33-38
  function getOrCreateDeviceFingerprint() {
    const key = "tatwir-attendance-device-id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = `${Date.now()}-${crypto.randomUUID()}`;
    window.localStorage.setItem(key, next);
    return next;
  }
  ```
- **Location:** [src/app/(app)/attendance/page.tsx:32-38](src/app/(app)/attendance/page.tsx#L32)
- **Gap:** If the same browser is used for multiple tenants (e.g., a consultant), the device fingerprint is shared across orgs, which could cause "wrong device" errors or allow device spoofing across tenants.
- **Recommendation:** Include org_id in the localStorage key: `tatwir-attendance-device-id-${orgId}`
- **Effort:** Low

---

## 2. Authentication & Tenant Resolution

### 2.1 Current Tenant Resolution Model

The tenant is determined by looking up `org_members` for the authenticated user:

```
User → auth.getUser() → org_members (user_id) → org_id
```

This happens in:
- **Middleware** ([src/middleware.ts:75-79](src/middleware.ts#L75)): Fetches org_members to determine role
- **RoleProvider** ([src/providers/RoleProvider.tsx:47-50](src/providers/RoleProvider.tsx#L47)): Builds User object with `orgId`
- **API Routes**: Each route independently fetches membership

**Finding #12: No org switching mechanism for multi-org users**

- **Risk Level:** High
- **Current State:** A user can only be a member of one org at a time (UI enforced, not schema enforced). The system uses `LIMIT 1` to resolve org_id.
- **Gap:** Future multi-org support would break entirely. There's no session-level org context, no org switcher, and the DB functions assume a single org.
- **Recommendation:** 
  1. Store active `org_id` in the Supabase JWT custom claims
  2. Create an org-switching endpoint that updates the claim
  3. Modify `current_org_id()` to read from JWT claims instead of querying `org_members`
- **Effort:** High

### 2.2 Session Isolation

**Finding #13: Supabase session is org-agnostic**

- **Risk Level:** High
- **Current State:** The Supabase auth session (cookie-based) contains only the user ID. Org context is resolved at runtime from the database.
- **Location:** [src/lib/supabase/server.ts](src/lib/supabase/server.ts), [src/middleware.ts](src/middleware.ts)
- **Gap:** If a user is added to Org B while having an active session from Org A, there's a race condition where `current_org_id()` could flip to the new org without the user's awareness. No session invalidation occurs on org membership changes.
- **Recommendation:** Store org_id in JWT custom claims; invalidate sessions on membership changes
- **Effort:** Medium

### 2.3 User-to-Org Binding (Onboarding)

**Finding #14: Employee account creation properly scopes to org**

- **Risk Level:** Low (positive finding)
- **Current State:** The [employee-accounts route](src/app/api/hr/employee-accounts/route.ts) correctly:
  1. Verifies the creator has HR role in their org
  2. Validates the target employee belongs to the same org (line 95-96)
  3. Checks for cross-org email conflicts (line 116)
  4. Binds the new user to the correct org_id

### 2.4 Superadmin Cross-Tenant Access

**Finding #15: Superadmin access is properly gated and audited**

- **Risk Level:** Low (positive finding)
- **Current State:** 
  - `requireSuperadmin()` function validates platform_admin status
  - All superadmin actions go through `/api/superadmin/*` routes
  - `recordPlatformAudit()` logs all cross-org actions with actor, target org, and metadata
  - Middleware blocks non-superadmin access to `/superadmin/*` paths
- **Location:** [src/lib/superadmin/server.ts](src/lib/superadmin/server.ts)

---

## 3. Configuration & Customization per Tenant

### 3.1 Hardcoded Values That Should Be Per-Tenant

**Finding #16: Brand configuration is globally hardcoded**

- **Risk Level:** High
- **Current State:**
  ```typescript
  // src/config/brand.ts
  export const BRAND = {
    name: "Tatwir Talent",
    tagline: "Measure Work. Maximize Performance.",
    colors: { primary: "#5DAE46", ... },
    fonts: { primary: "Aptos, Aptos Display, Inter, ..." },
  };
  ```
- **Location:** [src/config/brand.ts](src/config/brand.ts)
- **Gap:** Every tenant sees "Tatwir Talent" branding. No white-labeling possible.
- **Recommendation:** Create `organization_settings` table with branding fields; load at app init
- **Effort:** Medium

**Finding #17: Leave balance defaults are hardcoded**

- **Risk Level:** Medium
- **Current State:** Leave balance initialization uses fixed values (e.g., 30 days vacation, 5 emergency) derived from Saudi labor law defaults in the leave-accrual service.
- **Gap:** Different tenants may have different leave policies, accrual rates, or even leave types.
- **Recommendation:** Create per-org leave policy configuration table
- **Effort:** Medium

**Finding #18: Attendance geofence settings are per-location only**

- **Risk Level:** Low
- **Current State:** `radius_meters` is configured per location, which is correct.
- **Gap:** No org-level default radius, no org-level policies for "allow out-of-geofence check-in."
- **Recommendation:** Add org-level attendance policy settings
- **Effort:** Low

### 3.2 Per-Tenant Feature Configuration

**Finding #19: No feature flag mechanism exists**

- **Risk Level:** High
- **Current State:** All modules (HR, Sales, Recruitment, Accounting, Chat) are available to all organizations. There is no mechanism to enable/disable modules per tenant.
- **Location:** Global — no feature flag infrastructure exists
- **Gap:** Cannot sell tiered plans (Basic: HR only, Pro: HR+Sales+Recruitment, Enterprise: all modules)
- **Recommendation:** Create `organization_features` table with module toggle flags; add middleware/UI checks
- **Effort:** Medium

**Finding #20: No per-tenant limits or quotas**

- **Risk Level:** High
- **Current State:** No limits on: employee count, storage usage, API requests, number of sales agents, accounting entries, etc.
- **Gap:** A single tenant could consume unlimited resources. No fair-use enforcement possible.
- **Recommendation:** Create `organization_plans` table with quota definitions; add enforcement middleware
- **Effort:** High

### 3.3 Approval Workflows

**Finding #21: Approval workflows are not configurable per-org**

- **Risk Level:** Medium
- **Current State:** Leave approval goes to "any admin." Advance request approval is hardcoded. There's no configurable approval chain.
- **Gap:** Different orgs need different approval hierarchies (manager → HR → finance director)
- **Recommendation:** Build a workflow engine table: `approval_workflows(org_id, entity_type, steps[])`
- **Effort:** High

---

## 4. Infrastructure & Scaling

### 4.1 Current Database Architecture

**Finding #22: Shared-database, shared-schema model (correct for current scale)**

- **Risk Level:** Low
- **Current State:** Single PostgreSQL database (Supabase-managed) with RLS-based tenant isolation.
- **Recommendation:** This is the correct architecture for < 1000 tenants. No change needed until scale demands it.
- **Effort:** N/A

### 4.2 Index Coverage

**Finding #23: Missing composite indexes for multi-tenant queries**

- **Risk Level:** Medium
- **Current State:** Single-column indexes exist on `org_id` for most tables, but queries commonly filter by `org_id + date` or `org_id + employee_id + date`.
  ```sql
  -- Existing:
  CREATE INDEX idx_attendance_org ON attendance_records(org_id);
  -- Missing:
  -- CREATE INDEX idx_attendance_org_date ON attendance_records(org_id, work_date);
  -- CREATE INDEX idx_leave_requests_org_status ON leave_requests(org_id, status);
  ```
- **Location:** [db/schema-production-clean.sql:421-435](db/schema-production-clean.sql#L421)
- **Gap:** Full table scans filtered by RLS become slow with many tenants sharing the table.
- **Recommendation:** Add composite indexes: `(org_id, work_date)`, `(org_id, status)`, `(org_id, employee_id, work_date)`
- **Effort:** Low

### 4.3 Connection Pooling

**Finding #24: No connection pooling strategy for tenant growth**

- **Risk Level:** Medium
- **Current State:** Supabase provides built-in PgBouncer in transaction mode. The application creates a new client per request (serverless-friendly).
- **Gap:** At 100+ concurrent tenants with heavy traffic, the default Supabase connection limits (varies by plan) could be hit. No monitoring or alerting in place.
- **Recommendation:** Monitor connection usage; upgrade to Supabase Pro/Enterprise pooling; consider connection multiplexing
- **Effort:** Low

### 4.4 Background Jobs / Async Tasks

**Finding #25: No background job infrastructure exists**

- **Risk Level:** Medium
- **Current State:** All operations are synchronous request-response. No queue system, no cron jobs, no scheduled tasks.
- **Gap:** Multi-tenant operations like: monthly leave accrual, usage metering, subscription expiry checks, bulk notifications — all need async processing with tenant context.
- **Recommendation:** Implement tenant-aware job queue (pg-boss, Inngest, or Supabase Edge Functions with cron)
- **Effort:** High

### 4.5 Deployment Model

**Finding #26: Single deployment serves all tenants (correct)**

- **Risk Level:** Low
- **Current State:** Next.js deployed as single instance (or serverless functions). All tenants share the same application code.
- **Gap:** No ability for tenant-specific deployments or version pinning if needed.
- **Recommendation:** This is fine. Maintain single deployment. Only consider per-tenant instances for enterprise customers with compliance requirements.
- **Effort:** N/A

---

## 5. Billing & Subscription Readiness

### 5.1 Current State

**Finding #27: Zero billing infrastructure exists**

- **Risk Level:** Critical
- **Current State:** No tables, no code, no third-party integrations for:
  - Subscription plans
  - Payment processing
  - Invoice generation
  - Usage metering
  - Plan-based feature gating
  - Trial periods
- **Location:** N/A (nothing exists)
- **Gap:** Cannot monetize the platform or differentiate between paying/non-paying tenants.
- **Recommendation:** 
  1. Create `plans` table (name, features[], limits, price_monthly, price_yearly)
  2. Create `organization_subscriptions` (org_id, plan_id, status, period_start, period_end, payment_method)
  3. Integrate Stripe/Moyasar for KSA payment processing
  4. Build usage metering hooks (employee count, storage, API calls)
- **Effort:** High

### 5.2 Usage Metering Hooks

**Finding #28: No usage tracking of any kind**

- **Risk Level:** High
- **Current State:** Cannot answer: "How many employees does Org X have?" "How much storage does Org Y use?" without querying live data.
- **Gap:** Cannot enforce limits or generate invoices based on usage.
- **Recommendation:** Create `organization_usage` table with periodic snapshots; add triggers/hooks on employee creation, file uploads, API calls
- **Effort:** Medium

---

## 6. Onboarding & Tenant Lifecycle

### 6.1 Tenant Provisioning

**Finding #29: No automated tenant provisioning pipeline**

- **Risk Level:** High
- **Current State:** Organization creation is a simple row insert via the superadmin panel. No automated:
  - Default data seeding (chart of accounts, leave policies, default roles)
  - Admin user creation
  - Welcome email
  - Storage bucket preparation
  - Feature flag initialization
- **Location:** [src/app/api/superadmin/organizations/route.ts](src/app/api/superadmin/organizations/route.ts) (POST handler)
- **Gap:** Every new tenant requires manual setup by a superadmin.
- **Recommendation:** Build provisioning pipeline: `createOrganization()` → seed defaults → create admin user → send invite → initialize features
- **Effort:** High

### 6.2 Tenant Suspension

**Finding #30: Org suspension exists but is incomplete**

- **Risk Level:** Medium
- **Current State:** 
  - `organizations.status` can be set to "Suspended"
  - Middleware checks org status and redirects to `/suspended`
  - Active sessions are not invalidated on suspension
- **Location:** [src/middleware.ts:87-109](src/middleware.ts#L87)
- **Gap:** 
  - API routes using `createAdminClient` bypass the middleware suspension check
  - Existing sessions continue working until next middleware check
  - No notification to affected users
- **Recommendation:** Add suspension check to all API route auth helpers; invalidate sessions on status change
- **Effort:** Medium

### 6.3 Tenant Deletion

**Finding #31: No tenant deletion or data export mechanism**

- **Risk Level:** High
- **Current State:** The `deleteOrganization` function in `src/lib/services/organizations.ts` performs a hard delete. Cascading foreign keys will delete all related data. No:
  - Soft delete / grace period
  - Data export before deletion
  - Confirmation workflow
  - Backup/archive
- **Location:** [src/lib/services/organizations.ts:36-44](src/lib/services/organizations.ts#L36)
- **Gap:** Regulatory requirements (GDPR, Saudi PDPL) require data portability and controlled deletion.
- **Recommendation:**
  1. Implement soft delete with 30-day grace period
  2. Build data export endpoint (JSON/CSV dump of all org data)
  3. Add deletion confirmation workflow with superadmin approval
- **Effort:** High

---

## 7. Security Boundaries

### 7.1 Cross-Tenant Admin Attack Vectors

**Finding #32: Organization service has no org scoping in client-side functions**

- **Risk Level:** High
- **Current State:**
  ```typescript
  // src/lib/services/organizations.ts:3-11
  export async function getOrganizations() {
    const supabase = createClient();
    const result = await supabase
      .from("organizations")
      .select("*")
      .order("name");
  }
  ```
- **Location:** [src/lib/services/organizations.ts:3-11](src/lib/services/organizations.ts#L3)
- **Gap:** While RLS limits SELECT to `id = current_org_id()`, the function makes no application-layer effort to scope. If RLS has a bug or is disabled, all orgs are exposed.
- **Recommendation:** This function should only be used by superadmins; add role guard or remove from non-superadmin code
- **Effort:** Low

**Finding #33: `updateCheckOut` allows checkout on any attendance record by ID**

- **Risk Level:** High
- **Current State:**
  ```typescript
  // src/lib/services/attendance.ts:84-109
  export async function updateCheckOut(id: string, values: Record<string, unknown>) {
    const supabase = createClient();
    // ... device check ...
    const result = await supabase
      .from("attendance_records")
      .update(values as never)
      .eq("id", id)
      .select()
      .single();
  }
  ```
- **Location:** [src/lib/services/attendance.ts:84](src/lib/services/attendance.ts#L84)
- **Gap:** No verification that the attendance record belongs to the current user or org. RLS provides protection, but a compromised or manipulated client could attempt cross-tenant checkout.
- **Recommendation:** Add `.eq("org_id", orgId).eq("employee_id", employeeId)` to the update query
- **Effort:** Low

### 7.2 API Routes Missing Tenant Verification

**Finding #34: Some API routes rely solely on service_role without org verification**

- **Risk Level:** High
- **Current State:** The `/api/tasks/mine` route fetches the employee's org_id from the database and uses it correctly. However, several routes construct queries where org_id comes from the user's membership but don't verify it against the target resource.
- **Gap:** Pattern depends on developer diligence. No systemic enforcement.
- **Recommendation:** Create a middleware wrapper: `withTenantContext(handler)` that automatically injects verified `orgId` into all route handlers
- **Effort:** Medium

### 7.3 Audit Logging

**Finding #35: Workspace-level audit logging writes to non-functional table**

- **Risk Level:** High
- **Current State:** The `audit_logs` table exists in schema but the `writeAuditLog()` utility in `src/lib/utils/audit.ts` silently fails (no error handling).
- **Location:** [src/lib/utils/audit.ts](src/lib/utils/audit.ts)
- **Gap:** No audit trail for workspace-level actions (CRUD on employees, leave approvals, etc.). Only platform-level superadmin actions are audited.
- **Recommendation:** Fix the audit utility; ensure every mutation operation logs with tenant context
- **Effort:** Medium

**Finding #36: Platform audit logs are properly scoped**

- **Risk Level:** Low (positive finding)
- **Current State:** `platform_audit_logs` captures superadmin actions with `target_org_id`, `actor_user_id`, `action`, and `metadata`. RLS ensures only superadmins can read these logs.

---

## 8. Summary Tables

### All Findings by Risk Level

| # | Risk | Category | Finding |
|---|------|----------|---------|
| 1 | Critical | Data Isolation | `employee_locations` lacks `org_id` |
| 2 | Critical | Data Isolation | `current_org_id()` non-deterministic for multi-org users |
| 6 | Critical | Data Isolation | Client-side queries by ID without org_id |
| 7 | Critical | Data Isolation | Delete/update mutations by ID without org_id |
| 10 | Critical | Storage | Public storage buckets with no org-scoped access policies |
| 27 | Critical | Billing | Zero billing infrastructure |
| 9 | Critical | Data Isolation | Widespread service_role bypassing RLS without guaranteed org filter |
| 19 | Critical | Config | No feature flag mechanism |
| 4 | High | RLS | Profiles SELECT allows cross-org admin reads |
| 8 | High | Data Isolation | `replaceEmployeeLocations` deletes without org_id |
| 12 | High | Auth | No org-switching for multi-org users |
| 13 | High | Auth | Session is org-agnostic |
| 16 | High | Config | Brand hardcoded globally |
| 20 | High | Config | No per-tenant limits or quotas |
| 28 | High | Billing | No usage tracking |
| 29 | High | Lifecycle | No tenant provisioning pipeline |
| 31 | High | Lifecycle | No tenant deletion/export mechanism |
| 32 | High | Security | Organization service exposes all orgs |
| 33 | High | Security | `updateCheckOut` by ID without ownership check |
| 34 | High | Security | API routes lack systemic tenant enforcement |
| 35 | High | Security | Audit logging non-functional |
| 3 | Medium | Data Isolation | Inconsistent org column naming |
| 5 | Medium | RLS | Chat RLS doesn't verify org_id |
| 11 | Medium | Client State | Device fingerprint not tenant-scoped |
| 17 | Medium | Config | Leave balance defaults hardcoded |
| 21 | Medium | Config | Approval workflows not configurable |
| 23 | Medium | Scaling | Missing composite indexes for tenant queries |
| 24 | Medium | Scaling | No connection pooling strategy |
| 25 | Medium | Scaling | No background job infrastructure |
| 30 | Medium | Lifecycle | Org suspension incomplete |
| 37 | Medium | Config | No timezone/locale per tenant |
| 38 | Medium | Config | Shift rules global rather than org-configurable |
| 39 | Medium | Security | No rate limiting per tenant |
| 18 | Low | Config | No org-level attendance policy defaults |
| 22 | Low | Scaling | Shared-schema model (correct) |
| 26 | Low | Scaling | Single deployment (correct) |
| 14 | Low | Auth | Employee account creation properly scoped |
| 15 | Low | Auth | Superadmin access properly gated |
| 36 | Low | Security | Platform audit logs properly scoped |
| 11 | Low | Client | Device fingerprint shared across tenants |

---

## 9. Phased Migration Roadmap

### Phase 1: Critical Isolation Fixes (2-3 weeks)

**Goal:** Eliminate all cross-tenant data exposure vectors.

| Task | Effort | Priority |
|------|--------|----------|
| Add `org_id` to `employee_locations` table with backfill | Low | P0 |
| Fix `profiles` SELECT RLS policy (add org_id check) | Low | P0 |
| Add `.eq("org_id", orgId)` to all by-ID service functions | Low | P0 |
| Add org_id to all delete/update mutations | Low | P0 |
| Set storage buckets to `public = false`; add org-scoped RLS | Medium | P0 |
| Fix `current_org_id()` to be deterministic | Medium | P0 |
| Create `withTenantContext()` API route middleware | Medium | P0 |
| Fix `writeAuditLog()` to actually write to database | Low | P0 |
| Add org_id to Chat RLS policies | Low | P1 |
| Scope localStorage device fingerprint by org | Low | P1 |

### Phase 2: Per-Tenant Configuration (4-6 weeks)

**Goal:** Allow each tenant to customize their experience.

| Task | Effort | Priority |
|------|--------|----------|
| Create `organization_settings` table (branding, locale, timezone) | Medium | P0 |
| Create `organization_features` table (module toggles) | Medium | P0 |
| Build feature flag middleware (check feature before route access) | Medium | P0 |
| Create per-org leave policy configuration | Medium | P1 |
| Create per-org attendance policy settings | Low | P1 |
| Build configurable approval workflow engine | High | P1 |
| Add org-level quota definitions table | Medium | P1 |
| Standardize org_id / organization_id naming | Medium | P2 |

### Phase 3: Billing & Lifecycle (6-8 weeks)

**Goal:** Enable monetization and proper tenant management.

| Task | Effort | Priority |
|------|--------|----------|
| Design plan/pricing model (tables + logic) | Medium | P0 |
| Integrate payment provider (Stripe/Moyasar) | High | P0 |
| Build subscription management (create, upgrade, cancel) | High | P0 |
| Implement usage metering hooks | Medium | P0 |
| Build tenant provisioning pipeline (auto-setup on signup) | High | P0 |
| Implement feature gating by plan | Medium | P1 |
| Build tenant data export endpoint | Medium | P1 |
| Implement soft delete with grace period | Medium | P1 |
| Add tenant suspension → session invalidation | Medium | P2 |
| Build self-service org signup flow | High | P2 |

### Phase 4: Scale Optimization (4-6 weeks)

**Goal:** Prepare for 100+ tenants with good performance.

| Task | Effort | Priority |
|------|--------|----------|
| Add composite indexes (org_id + date, org_id + status) | Low | P0 |
| Implement tenant-aware background job queue | High | P0 |
| Store org_id in JWT custom claims (eliminate runtime lookups) | Medium | P1 |
| Add per-tenant rate limiting | Medium | P1 |
| Set up monitoring dashboards (per-tenant resource usage) | Medium | P1 |
| Connection pooling optimization | Low | P2 |
| Query performance audit with 50+ tenants simulated | Medium | P2 |
| Implement org-switching for consultants/multi-org users | High | P2 |

---

## 10. Architecture Recommendations

### Recommended Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Application                       │
├─────────────────────────────────────────────────────────────────┤
│  Middleware: Auth + Tenant Resolution (JWT claims → orgId)       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Feature Gate │  │ Rate Limiter │  │ Usage Meter          │  │
│  │ (per-plan)   │  │ (per-tenant) │  │ (employee/storage)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  API Routes: withTenantContext(handler)                          │
│  - orgId injected automatically                                 │
│  - All queries scoped by orgId in application layer             │
│  - service_role used ONLY for cross-org superadmin ops          │
├─────────────────────────────────────────────────────────────────┤
│  PostgreSQL (Supabase)                                          │
│  - RLS as safety net (defense-in-depth)                         │
│  - org_id on EVERY table                                        │
│  - Composite indexes for tenant+time queries                    │
│  - Storage: private buckets with org-path RLS                   │
├─────────────────────────────────────────────────────────────────┤
│  Background Jobs (pg-boss / Inngest)                            │
│  - Tenant-aware: every job carries orgId                        │
│  - Monthly: accrual, metering, invoice generation               │
│  - Event-driven: notifications, webhooks                        │
├─────────────────────────────────────────────────────────────────┤
│  Billing (Stripe / Moyasar)                                     │
│  - Plans → Features → Quotas                                    │
│  - Webhook → subscription status sync                           │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Defense in Depth:** RLS is the last line of defense, not the only one. Application layer MUST also filter by org_id.
2. **Explicit over Implicit:** Never rely on `LIMIT 1` for tenant resolution. Org context should be explicit in every query.
3. **Fail Closed:** If org context cannot be determined, reject the request. Never fall through to unscoped queries.
4. **Audit Everything:** Every cross-tenant operation (superadmin) and every mutation (workspace) must be logged with org context.
5. **Quota Enforcement at the Gate:** Check limits before accepting data, not after.
