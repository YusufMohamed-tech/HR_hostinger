# Multi-Tenancy Audit Remediation Report

## Source Documents Reviewed

- `documentations/README.md`
- `documentations/architecture.md`
- `documentations/authentication.md`
- `documentations/database.md`
- `documentations/services.md`
- `documentations/development.md`
- `documentations/api.md`
- `documentations/known-issues.md`
- `docs/audit.md`

## Remediation Status

### Completed In This Pass

| Audit Finding | Status | Implementation |
|---|---|---|
| #1 `employee_locations` lacks `org_id` | Fixed in migration | Added `org_id`, backfill, NOT NULL enforcement, FK, tenant indexes, and org-scoped RLS in `db/schema_v41_multi_tenancy_audit_fixes.sql`. |
| #2 `current_org_id()` is non-deterministic | Fixed in migration | Added deterministic ordering and aligned `current_role()`, `is_admin()`, and `current_employee_id()` with the resolved org. |
| #4 `profiles` SELECT allows cross-org admin reads | Fixed in migration | Scoped profile select/update policies to `org_id = current_org_id()` for org admins. |
| #5 Chat RLS does not verify org membership | Fixed in migration | Chat conversation, participant, and message select policies now require matching tenant scope. |
| #6 By-ID service reads lack org filters | Started | `getEmployeeById()` and `getTaskById()` now require `orgId` and filter by tenant. |
| #7 Delete/update mutations by ID lack org filters | Started | Employee and task update/delete/assignment mutations now require `orgId` and apply tenant filters. |
| #8 `replaceEmployeeLocations` deletes without org filter | Fixed | Function now requires `orgId`, filters deletes by `org_id`, and inserts tenant-scoped rows. |
| #10 Public storage buckets lack tenant policies | Started | Task/chat buckets are made private in migration, storage object policies are tenant-scoped, and task/chat attachment metadata now preserves object paths for signed URLs. |
| #11 Device fingerprint is not tenant-scoped | Fixed | Attendance device localStorage keys now include `orgId`. |
| #33 `updateCheckOut` updates by ID only | Fixed | Checkout now requires `orgId` and `employeeId`, and filters both record verification and update. |
| #35 Workspace audit logging is weak/non-observable | Improved | `writeAuditLog()` validates required fields, performs an insert round-trip, logs failures, and returns a result. |

### Partially Complete / Next Targets

| Audit Finding | Remaining Work |
|---|---|
| #9 Widespread service-role usage | Create `withTenantContext()` and progressively move API routes to a shared tenant auth wrapper. |
| #10 Storage isolation | Add signed URL rendering everywhere attachments are shown beyond task/chat, then apply the migration after a browser QA pass. |
| #34 API routes lack systemic tenant enforcement | Build the shared wrapper and convert high-risk routes first: sales, chat, advance requests, manager tasks, assets. |
| Known Issue #7 API/form validation gaps | Add Zod validation to public and service-role-backed API routes. |
| Known Issue #8 pagination gaps | Add paginated list patterns to large tables after isolation fixes are stable. |

## Verification Plan

### Completed

| Check | Result |
|---|---|
| `npm run lint` | Passed. One pre-existing warning remains in `src/app/(app)/balances/page.tsx` for raw `<img>` usage. |
| `npm run build` | Passed. The app compiled and generated all routes successfully. |

### Still Required Before Production Rollout

1. Apply `db/schema_v41_multi_tenancy_audit_fixes.sql` in staging.
2. QA employee edit/delete, task edit/update, attendance check-in/out, task attachments, and chat attachments.
3. After staging QA, apply the migration to production.
