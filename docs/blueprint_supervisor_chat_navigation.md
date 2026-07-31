# Blueprint: Fix Supervisor Chat Navigation

## Problem Statement

When a user logged in as a **Supervisor** clicks "الشات" in the sidebar, the browser silently redirects them back to `/supervisor` instead of loading the chat interface. The link exists in the sidebar and the chat page itself has no role guard — the block is entirely in the middleware RBAC layer.

---

## Root Cause

### Location

`src/lib/rbac.ts` — the `canAccessPath` function, lines ~185–198.

### What happens

`canAccessPath` has an **explicit, exhaustive allowlist** for the `Supervisor` role. It returns `true` only for the paths listed in that block and immediately returns `false` for everything else. `/chat` and `/api/chat` are not in the list.

```ts
// src/lib/rbac.ts  (current — broken)
if (role === "Supervisor") {
  return (
    normalizedPath.startsWith("/supervisor") ||
    normalizedPath.startsWith("/api/supervisor") ||
    normalizedPath.startsWith("/attendance") ||
    normalizedPath.startsWith("/api/attendance") ||
    normalizedPath.startsWith("/tasks") ||
    normalizedPath.startsWith("/api/tasks") ||
    normalizedPath.startsWith("/leave") ||
    normalizedPath.startsWith("/api/leave") ||
    normalizedPath.startsWith("/notifications") ||
    normalizedPath.startsWith("/settings")
    // /chat and /api/chat are missing ← root cause
  );
}
```

The middleware (`src/middleware.ts`) calls `canAccessPath`. When it returns `false`, the middleware issues an immediate redirect to `getDefaultPathForRole("Supervisor")` which resolves to `/supervisor`:

```ts
// src/middleware.ts
if (!canAccessPath(role, pathname)) {
  return secure(NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url)));
}
```

### Why other roles are unaffected

Roles such as `Sales_Manager`, `Employee`, and `HR_Recruitment` do **not** have an early-return allowlist block; control falls through to the catch-all `return ALL_ROLES.includes(role)` which returns `true` for any known role, including on `/chat`. The Supervisor block never reaches that catch-all.

### Secondary guard (not the cause, worth noting)

`src/middleware.ts` also checks `requiredFeatureForPath` for the `chat` feature module. This is a plan-level gate that applies to **all** roles equally. If the organization's plan has the `chat` feature disabled, no role can access `/chat`. This is working as designed and is not related to the Supervisor-specific redirect.

---

## Scope of Changes

| File | Change |
|---|---|
| `src/lib/rbac.ts` | Add `/chat` and `/api/chat` to the Supervisor allowlist |

No other files need to change:
- `src/components/layout/Sidebar.tsx` — the sidebar link is already correct (`href="/chat"`).
- `src/app/(app)/chat/page.tsx` — no role guard inside the component; Supervisors can use all existing chat functionality once the middleware lets them through. Group creation is already gated separately (`canCreateGroup` only for Admin/HR_Admin/Superadmin).
- `src/app/api/chat/route.ts` — the API uses `requireTenantContext({ feature: "chat" })` with no `roles` restriction; Supervisors are already in `ORG_ROLES` and will be accepted.

---

## Implementation

### Step 1 — Update `canAccessPath` in `src/lib/rbac.ts`

Locate the `Supervisor` block and add the two missing path prefixes:

```ts
// src/lib/rbac.ts  (after fix)
if (role === "Supervisor") {
  return (
    normalizedPath.startsWith("/supervisor") ||
    normalizedPath.startsWith("/api/supervisor") ||
    normalizedPath.startsWith("/attendance") ||
    normalizedPath.startsWith("/api/attendance") ||
    normalizedPath.startsWith("/tasks") ||
    normalizedPath.startsWith("/api/tasks") ||
    normalizedPath.startsWith("/leave") ||
    normalizedPath.startsWith("/api/leave") ||
    normalizedPath.startsWith("/notifications") ||
    normalizedPath.startsWith("/settings") ||
    normalizedPath.startsWith("/chat") ||          // ← add this
    normalizedPath.startsWith("/api/chat")         // ← add this
  );
}
```

That is the entire code change.

---

## Verification Checklist

### Manual (browser)

1. Log in as a Supervisor account.
2. Click "الشات" in the sidebar.
3. **Expected:** Chat inbox loads at `/chat`.
4. **Previously:** Redirected to `/supervisor`.

### Check no regression on other roles

| Role | Expected after change |
|---|---|
| Supervisor | Can now access `/chat` |
| Sales_Manager | Still works (unaffected — different code path) |
| Employee | Still works (unaffected) |
| HR_Admin / Admin | Still works (unaffected) |

### API access

With a Supervisor session, confirm the following API calls succeed (HTTP 200):

- `GET /api/chat` — load inbox
- `POST /api/chat` — send a message
- `PATCH /api/chat` — mark message read

### Feature flag edge case

If the organization's plan does **not** have the `chat` feature enabled, the Supervisor will still be redirected — but so will every other role. That is correct behavior and unrelated to this fix. If the client org has chat disabled, enable the feature in the org plan settings first.

---

## Risk Assessment

| Concern | Assessment |
|---|---|
| Unintended privilege escalation | None. Supervisors gain access to chat (sending/receiving messages) which is the intended behavior, as evidenced by the sidebar link being present. Group creation remains restricted to Admin/HR_Admin/Superadmin. |
| API exposure | The chat API has no role filter beyond `requireTenantContext`; all org roles were already implicitly permitted at the API layer. The middleware fix aligns the UI routing with what the API already allows. |
| Blast radius | One function, two lines added. No data model or auth model changes. |

---

## Migration / Deployment Notes

- No database migration required.
- No environment variable changes.
- Deploy as a standard Next.js build. The middleware change takes effect immediately on the new deployment with no cache warm-up needed.
