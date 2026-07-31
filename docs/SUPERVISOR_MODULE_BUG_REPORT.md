# Supervisor Module - Bug Report & Verification

**Module:** Supervisor (v138 + v139 + v140)  
**Date:** 2026-07-31  
**Scope:** Schema, Employee Creation, API routes (`/api/supervisor/*`), RLS policies

---

## Critical Bugs (FIXED)

### BUG-000: Cannot create employee with supervisor role - "Idempotency key" error

**File:** `db/schema_v122_product_inventory_foundation.sql` (lines 662-668)  
**Severity:** Critical / Blocker  
**Type:** Missing Role in Allow-list  
**Status:** FIXED in v140

**Root Cause:**  
The `link_employee_identity` SQL function has a hard-coded allow-list of roles. When v138 added the `'supervisor'` value to the `org_role` enum, this function was never updated. The creation flow is:

1. `begin_employee_onboarding` succeeds (employee record created)
2. Auth user is created in Supabase Auth
3. `link_employee_identity` is called with `p_role = 'supervisor'`
4. **FAILS** at the role check: `"Unsupported employee account role"`
5. On retry, `sessionStorage` holds the old command ID but the payload hash may differ -> "Idempotency key was already used for a different employee command"

**Fix Applied:**
- `db/schema_v140_fix_supervisor_identity_link.sql` — adds `'supervisor'` to the role allow-list
- `src/lib/services/employees.ts` — always clears command IDs after attempt (not just on success) so retries generate fresh IDs
- Cleanup query removes orphaned `link_identity` commands from failed attempts

---

## Critical Bugs (Open)

### BUG-001: PATCH endpoint has no input validation on `responses` and `overall_score`

**File:** `src/app/api/supervisor/evaluations/[id]/route.ts` (lines 86-93)  
**Severity:** Critical  
**Type:** Security / Data Integrity

**Description:**  
The `PATCH` handler accepts `body.responses` and `body.overall_score` directly without Zod validation. Unlike the `POST` route which uses `createEvaluationSchema`, the PATCH blindly passes user-supplied values into the database update.

**Impact:**
- An attacker can set `overall_score` to any value (e.g., 999.9, negative numbers) — the DB column is `NUMERIC(3,1)` which allows up to 99.9
- Malformed `responses` JSONB can be injected (missing required fields, wrong types, XSS in label/notes strings)
- No max-length enforcement on `comment` field (POST enforces 5000 chars, PATCH does not)

**Reproduction:**
```bash
curl -X PATCH /api/supervisor/evaluations/{id} \
  -d '{"overall_score": 99.9, "comment": "<script>...</script>", "responses": [{"garbage": true}]}'
```

---

### BUG-002: RLS policy overlap allows unlimited supervisor read access across organization

**File:** `db/schema_v139_supervisor_tables.sql` (lines 88-97)  
**Severity:** High  
**Type:** Security / Authorization

**Description:**  
The `supervisor_read_own_evaluations` policy has an `OR` condition that grants any user with the `supervisor` role access to ALL evaluations in their org:

```sql
CREATE POLICY "supervisor_read_own_evaluations" ON site_evaluations
  FOR SELECT USING (
    supervisor_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    OR org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid()
        AND om.role IN ('admin', 'hr_admin', 'supervisor')  -- <-- this grants ALL supervisors full org access
    )
  );
```

**Impact:**  
Every supervisor can read every other supervisor's evaluations. The policy name suggests "own evaluations" but the second branch opens it to all supervisors in the org. This contradicts the API-level filter at `evaluations/route.ts:44` where non-admins are restricted to `supervisor_id = auth.employeeId`.

**Expected behavior:**  
Supervisors should only see their own evaluations via RLS. The `OR` branch should only include `admin` and `hr_admin`, not `supervisor`:

```sql
AND om.role IN ('admin', 'hr_admin')
```

---

### BUG-003: Admins can edit submitted evaluations without status checks

**File:** `src/app/api/supervisor/evaluations/[id]/route.ts` (lines 79-84)  
**Severity:** High  
**Type:** Logic / Business Rule

**Description:**  
The status guard only blocks edits when the current user is the supervisor who owns the evaluation:

```typescript
if (existing.status !== "draft" && existing.supervisor_id === auth.employeeId) {
  return NextResponse.json({ message: "Cannot edit a submitted evaluation." }, { status: 400 });
}
```

This means admins/hr_admins can freely modify `responses`, `overall_score`, and `comment` on already-submitted or even already-reviewed evaluations. There is no audit trail for these modifications.

**Impact:**  
- Admins can alter evaluation data after submission, breaking the integrity of the review workflow
- A "reviewed" evaluation can have its score changed without re-review
- No business event is emitted on PATCH, so changes are invisible to the outbox/notification system

---

## Medium Severity Bugs

### BUG-004: `employee_locations` query in POST lacks `org_id` filter

**File:** `src/app/api/supervisor/evaluations/route.ts` (lines 83-89)  
**Severity:** Medium  
**Type:** Data Isolation

**Description:**  
The location assignment check queries `employee_locations` filtered only by `employee_id` and `location_id`, without scoping to `org_id`:

```typescript
const { data: locationAssignment } = await auth.admin
  .from("employee_locations")
  .select("id")
  .eq("employee_id", auth.employeeId)
  .eq("location_id", parsed.data.location_id)
  .or("assigned_to.is.null,assigned_to.gte." + parsed.data.evaluation_date)
  .maybeSingle();
```

**Impact:**  
Uses `auth.admin` (service role client which bypasses RLS). If an employee somehow has rows in `employee_locations` referencing another org's location (data corruption scenario), this check would incorrectly pass. Should include `.eq("org_id", auth.orgId)` for defense-in-depth.

---

### BUG-005: Attachment DELETE does not remove file from object storage

**File:** `src/app/api/supervisor/evaluations/[id]/attachments/route.ts` (lines 160-163)  
**Severity:** Medium  
**Type:** Resource Leak

**Description:**  
The `DELETE` handler only removes the database record but does not delete the actual file from the `site-evaluations` storage bucket:

```typescript
await auth.admin
  .from("site_evaluation_attachments")
  .delete()
  .eq("id", attachmentId);
```

**Impact:**  
- Orphaned files accumulate in object storage indefinitely
- Storage costs grow without bound
- Deleted attachments remain accessible if someone has the direct storage URL

**Fix:**  
Before deleting the DB record, call storage removal:
```typescript
await auth.admin.storage.from("site-evaluations").remove([attachment.file_key]);
```

---

### BUG-006: `overall_score` column allows values up to 99.9 but business rule is 0-5

**File:** `db/schema_v139_supervisor_tables.sql` (line 35)  
**Severity:** Medium  
**Type:** Schema Constraint Missing

**Description:**  
The column is defined as `NUMERIC(3,1)` which allows values from -99.9 to 99.9. The API POST validation enforces `min(0).max(5)`, but:
1. The PATCH endpoint has no validation (see BUG-001)
2. Direct DB access (admin tools, migrations, other services) has no constraint

**Fix:**  
Add a CHECK constraint:
```sql
overall_score NUMERIC(3,1) CHECK (overall_score >= 0 AND overall_score <= 5),
```

---

### BUG-007: Missing `updated_at` trigger for `site_evaluation_attachments` table

**File:** `db/schema_v139_supervisor_tables.sql`  
**Severity:** Low  
**Type:** Inconsistency

**Description:**  
The `site_evaluation_attachments` table has no `updated_at` column and therefore no trigger. While attachments are typically immutable (insert-only), if an UPDATE is ever performed, there's no timestamp tracking.

This is a minor inconsistency but acceptable since attachments are insert/delete only.

---

## Low Severity Issues

### BUG-008: `update_site_evaluation_timestamp()` function uses `CREATE OR REPLACE` in global schema

**File:** `db/schema_v139_supervisor_tables.sql` (lines 136-143)  
**Severity:** Low  
**Type:** Migration Safety

**Description:**  
The function is created at the `public` schema level with a generic enough name that it could conflict with other modules. The function is fine for now but uses `CREATE OR REPLACE`, meaning a future migration could accidentally overwrite it if they use the same function name.

---

### BUG-009: Evaluation `status` field accepts 'draft' via CHECK but POST always sets 'submitted'

**File:** `db/schema_v139_supervisor_tables.sql` (line 42) + `src/app/api/supervisor/evaluations/route.ts` (line 134)  
**Severity:** Low  
**Type:** Dead Code Path

**Description:**  
The schema allows `status = 'draft'` and the PATCH endpoint handles draft-to-submitted transitions, but there is no API path to CREATE an evaluation in 'draft' status. The POST endpoint hardcodes `status: "submitted"`.

**Impact:**  
The draft workflow is defined in code but inaccessible to users — effectively dead code. Either:
1. Add a `status` field to `createEvaluationSchema` allowing `'draft' | 'submitted'`
2. Or remove the draft logic from PATCH and the CHECK constraint

---

### BUG-010: RLS policy `admins_manage_evaluations` overlaps with `supervisor_insert_evaluations`

**File:** `db/schema_v139_supervisor_tables.sql` (lines 100-115)  
**Severity:** Low  
**Type:** Policy Redundancy

**Description:**  
The `admins_manage_evaluations` policy uses `FOR ALL` which includes INSERT. The `supervisor_insert_evaluations` policy separately handles INSERT for supervisors. This is not a bug per se, but the overlap means admin INSERT goes through the broader policy which doesn't verify `supervisor_id` matches the inserting user.

**Impact:**  
An admin could insert an evaluation with any `supervisor_id`, bypassing the ownership check. The API prevents this (it uses `auth.employeeId`), but the RLS layer doesn't enforce it for admins.

---

## Summary Table

| ID | Severity | Category | Status |
|----|----------|----------|--------|
| BUG-000 | Critical | Blocker | **FIXED (v140)** |
| BUG-001 | Critical | Security | Open |
| BUG-002 | High | Authorization | Open |
| BUG-003 | High | Logic | Open |
| BUG-004 | Medium | Data Isolation | Open |
| BUG-005 | Medium | Resource Leak | Open |
| BUG-006 | Medium | Schema Constraint | Open |
| BUG-007 | Low | Inconsistency | Accepted |
| BUG-008 | Low | Migration Safety | Accepted |
| BUG-009 | Low | Dead Code | Open |
| BUG-010 | Low | Policy Redundancy | Accepted |

---

## Recommended Fix Priority

1. ~~**BUG-000** — Add `'supervisor'` to `link_employee_identity` allow-list~~ **DONE (v140)**
2. **BUG-001** — Add Zod validation to PATCH endpoint (immediate)
3. **BUG-002** — Remove `'supervisor'` from RLS read policy OR branch (immediate)
4. **BUG-003** — Add status-transition guards for admin edits + emit business events (next sprint)
5. **BUG-005** — Add storage cleanup on attachment delete (next sprint)
6. **BUG-006** — Add CHECK constraint via new migration v141 (next sprint)
7. **BUG-004** — Add `org_id` filter to location assignment query (low effort, do alongside BUG-001)
8. **BUG-009** — Decide on draft workflow: enable or remove (backlog)
