# Authentication & Role-Based Access Control

## Overview

Tatwir Talent HRMS uses **Supabase Auth** for authentication and a custom **RBAC (Role-Based Access Control)** system enforced at three levels:

1. **Middleware** — Server-side route protection before page renders
2. **Client-side** — AuthGuard component and RoleProvider context
3. **Database** — Row Level Security (RLS) policies on all tables

---

## Authentication Flow

```
1. User visits any URL
     │
2. middleware.ts intercepts
     │
3. Create Supabase server client (with cookies)
     │
4. Call supabase.auth.getUser()
     │
     ├─── No user?
     │         │
     │         ├── Public path? → Allow through
     │         ├── API route? → Return 401 JSON
     │         └── Other? → Redirect to /login?next=<original-path>
     │
     └─── Has user?
               │
5. Check platform_admins table
     │
     ├─── Is Superadmin? → Full access to everything
     │
     └─── Not Superadmin?
               │
6. Check org_members table
     │
     ├─── Has org membership?
     │         │
     │    7. Check account_status + org.status
     │         │
     │         ├── Suspended? → Redirect to /suspended (or 403 for API)
     │         │
     │         └── Active?
     │               │
     │          8. Resolve role → canAccessPath(role, pathname)
     │               │
     │               ├── Allowed? → Continue to page
     │               └── Denied? → Redirect to default path for role
     │
     └─── No org membership?
               │
          9. Candidate portal? → Allow
               │
               └── Otherwise → Redirect to /candidate/applications
```

## Login Process

**Location:** `src/app/login/page.tsx`

1. User enters email and password
2. Client calls `supabase.auth.signInWithPassword({ email, password })`
3. On success: Supabase sets session cookies
4. Client redirects to `/` (or `?next=` parameter if present)
5. On error: Display error message inline

## Session Management

Sessions are managed via **HTTP-only cookies** set by Supabase Auth:

- **Browser client** (`src/lib/supabase/client.ts`): Uses `createBrowserClient` with anon key
- **Server client** (`src/lib/supabase/server.ts`): Uses `createServerClient` with cookie read/write
- **Middleware**: Refreshes session on every request via cookie manipulation

Session tokens auto-refresh. No manual token management needed.

---

## Role System

### Role Hierarchy

```
Superadmin (Platform Level)
    │
    └── Workspace Roles (Organization Level)
            ├── Admin
            ├── HR_Admin
            ├── HR_Recruitment
            ├── Training_Manager
            ├── Sales
            ├── Sales_Manager
            ├── Finance_Manager
            ├── Accountant
            ├── Finance_Viewer
            └── Employee
```

### Role Definitions

| Role | Display Name | Scope | Description |
|------|-------------|-------|-------------|
| `Superadmin` | Superadmin | Platform | Full platform access, cross-org management |
| `Admin` | Admin | Organization | Full org access, all modules |
| `HR_Admin` | HR Admin | Organization | HR operations, employees, departments, payroll |
| `HR_Recruitment` | Recruiter | Organization | Recruitment module only |
| `Training_Manager` | Training Manager | Organization | Tasks, employees (read), training |
| `Sales` | Sales Rep | Organization | Sales log, dashboard, personal history |
| `Sales_Manager` | Sales Manager | Organization | Full sales module + team management |
| `Finance_Manager` | Finance Manager | Organization | Full accounting + team + settings |
| `Accountant` | Accountant | Organization | Accounting operations (no posting/settings) |
| `Finance_Viewer` | Finance Viewer | Organization | Accounting read-only |
| `Employee` | Employee | Organization | Self-service (attendance, tasks, leave, chat) |

### Database Roles (org_members.role column)

```sql
'super_admin' | 'admin' | 'employee' | 'hr_admin' | 'hr_recruitment' |
'training_manager' | 'sales' | 'sales_manager' | 'finance_manager' |
'accountant' | 'finance_viewer'
```

Mapping function: `roleFromOrgRole()` in `src/lib/rbac.ts`

---

## Path-Based Access Control

The `canAccessPath(role, pathname)` function in `src/lib/rbac.ts` defines which roles can access which routes:

### Module Access Matrix

| Path | Superadmin | Admin | HR_Admin | HR_Recruit | Training_Mgr | Sales | Sales_Mgr | Finance_Mgr | Accountant | Finance_Viewer | Employee |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `/` (Dashboard) | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `/employees` | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/departments` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/attendance` | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `/tasks` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `/leave` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `/recruitment` | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/sales/*` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓* | ✓ | ✗ | ✗ | ✗ | ✗ |
| `/accounting` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| `/accounting/settings` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `/accounting/team` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `/superadmin/*` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/payroll` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| `/notifications` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/settings` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

*Sales reps: dashboard, log, and history only (not team/products/reports)

### Default Landing Pages by Role

| Role | Default Path |
|------|-------------|
| Superadmin | `/superadmin` |
| HR_Recruitment | `/recruitment` |
| Sales / Sales_Manager | `/sales/dashboard` |
| Finance_Manager / Accountant / Finance_Viewer | `/accounting` |
| All others | `/` |

---

## Public Paths (No Auth Required)

```
/login
/suspended
/auth/*                  (OAuth callback)
/apply/*                 (Public job application)
/candidate/login
/candidate/register
/candidate/applications
/api/candidate/posting   (Public posting lookup)
/api/candidate/apply     (Public application submit)
```

---

## Client-Side Auth Components

### RoleProvider (`src/providers/RoleProvider.tsx`)

Context provider that:
1. Calls `supabase.auth.getUser()` on mount
2. Fetches `platform_admins`, `org_members`, `profiles`, `employees` in parallel
3. Builds `User` object with resolved role
4. Exposes: `currentUser`, `loading`, `login()`, `logout()`, `refresh()`

### AuthGuard (`src/components/auth/AuthGuard.tsx`)

Client-side wrapper that:
- Shows loading spinner while auth resolves
- Redirects to `/login` if no user after resolution
- Renders children only when authenticated

### useRoleContext Hook

```tsx
const { currentUser } = useRoleContext();
const isAdmin = currentUser?.role === "Admin";

// Admin-only UI
{isAdmin && <AdminButton />}
```

---

## Supabase Client Types

| Client | File | Key | RLS | Use Case |
|--------|------|-----|-----|----------|
| Browser | `src/lib/supabase/client.ts` | Anon | Enforced | Client components, service layer |
| Server | `src/lib/supabase/server.ts` | Anon | Enforced | Server components, route handlers (user context) |
| Admin | `src/lib/supabase/admin.ts` | Service Role | **Bypassed** | API routes needing cross-org access, seed scripts |

---

## Account Suspension

The middleware checks both individual account status and organization status:

1. `profiles.account_status` must be `"active"`
2. `organizations.status` must be `"active"`

If either is not active:
- API requests → 403 `"Account or organization is suspended."`
- Page requests → Redirect to `/suspended`

---

## Security Considerations

- Session cookies are HTTP-only (managed by Supabase SSR)
- Service role key is server-side only (`SUPABASE_SERVICE_ROLE_KEY`)
- Anon key is public but RLS policies restrict all data access
- Middleware runs on every request (except static assets)
- No CORS issues — same-origin deployment on Vercel
- `X-Frame-Options: DENY` prevents clickjacking
- `Permissions-Policy` restricts camera/geolocation to same-origin
