# Role and Capability Contract

This is the launch authorization contract for Tatwir HRMS. It applies to navigation, middleware, server APIs, database RLS, and background workers. A UI control is never an authorization boundary.

## Tenant model

- A non-platform user has exactly one organization membership. `org_members_single_workspace_org_user_idx` enforces this for every role except the retired `super_admin` workspace role.
- Platform administration is separate: only an active `platform_admins.role = 'superadmin'` record grants platform access. A workspace `super_admin` membership grants nothing and has no fallback path.
- Every tenant request must pass active user/profile, active/non-deleted organization, settings/timezone, active subscription, active plan, and organization feature gates.
- Trusted server code may use the service-role key only after resolving the caller and applying an explicit organization predicate to every reference.

## Capability matrix

| Workspace role | People | Attendance | Leave | Recruitment | Payroll preparation | Assets | Locations | Accounting |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `admin` | Manage | Manage | Manage | Manage | Manage | Manage | Manage | Admin where accounting policy allows |
| `hr_admin` | Manage | Manage | Manage | Manage | Manage | Manage | Manage | No posting authority unless explicitly granted by accounting policy |
| `hr_recruitment` | Scoped employee read | No | No | Manage | No | No | Read | No |
| `training_manager` | Assigned scope only | Assigned scope only | Assigned approval scope only | No | No | No | Manage | No |
| `finance_manager` | No | No | No | No | Manage | No | Read | Approve/post/reverse |
| `accountant` | No | No | No | No | Read required inputs | No | Read | Prepare transactions |
| `finance_viewer` | No | No | No | No | Read reports | No | Read | Read only |
| `sales_manager` | No | No | No | No | No | No | Manage | Sales/accounting permissions defined by accounting policy |
| `sales` | Self | Self | Self | No | Self payslip | Self | Read | No |
| `onground_agent_manager` | Agent scope | No | No | No | No | No | Read | No |
| `promoter` | Self | No | No | No | No | No | Read | No |
| `field_agent` | Self | No | No | No | No | No | Read | No |
| `merchant` | Self | No | No | No | No | No | Read | No |
| `employee` | Self | Self | Self | No | Self payslip | Self | Read | No |

“Manage” is still constrained to the current organization. Manager scope is derived from employee manager, department manager, location manager, or explicitly assigned location; it is not a tenant-wide permission.

## Database capabilities

The canonical RLS helpers are:

- `is_admin()` — organization administration only (`admin`; legacy `super_admin` remains recognized only inside tenant RLS during migration).
- `can_manage_people()` — `admin`, `hr_admin`.
- `can_manage_attendance()` — `admin`, `hr_admin`; manager scope is evaluated separately.
- `can_manage_leave()` — `admin`, `hr_admin`; manager approval scope is evaluated separately.
- `can_manage_recruitment()` — `admin`, `hr_admin`, `hr_recruitment`.
- `can_manage_payroll()` — `admin`, `hr_admin`, `finance_manager`.
- `can_manage_assets()` — `admin`, `hr_admin`.
- `can_manage_locations()` — `admin`, `hr_admin`, `training_manager`, `sales_manager`.
- `can_manage_employee_scope(employee_id)` — people managers, the employee, or an assigned training manager.

Accounting posting remains a distinct high-risk capability and must not be inferred from `can_manage_payroll()`.

## Module entitlement rules

A module is enabled only when all of these are true:

1. The subscription is `active` or unexpired `trialing`.
2. Its referenced plan is active and the plan feature is `true`.
3. `organization_features.<module>_enabled` is `true`.
4. The module appears in `organization_features.enabled_modules`.
5. The user’s role/capability permits the requested action.

Missing or inconsistent entitlement data fails closed. Organizations that existed before enforcement receive the explicit `legacy` plan rather than implicit unlimited access.

## Enforcement ownership

| Layer | Responsibility |
|---|---|
| Middleware | Session, workspace role, suspension/deletion, subscription/plan, module access, path access |
| Server tenant context | Repeat all high-risk checks, issue request ID, expose timezone/capabilities, create scoped admin client |
| Server command | Validate input and every referenced ID against the resolved organization |
| Database RLS/RPC | Enforce tenant rows, allowed transition, locking, idempotency, and transactional invariants |
| UI/navigation | Reflect permissions for usability only |
| Worker | Authenticate with a dedicated secret, claim locked outbox rows, retry, and dead-letter visibly |

## Required regression cases

- Every role against every protected module and mutation.
- Tenant A IDs submitted by Tenant B through both browser and service-role routes.
- Missing settings/features/subscription/plan, expired trial, suspended profile, suspended/deleted organization.
- Platform table failure, legacy workspace `super_admin`, and suspended platform administrator.
- Concurrent membership, event claim, outbox claim, attendance, leave approval, payroll posting, and sale attempts.

The disposable PostgreSQL smoke suite (`npm run test:db`) currently proves the fresh migration chain, HR-admin versus organization-admin separation, two-tenant employee/organization isolation, cross-tenant write rejection, tenant defaults, business date, and atomic event/outbox claims.
