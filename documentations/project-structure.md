# Project Structure

## LMS v43 Files

Database and verification:
- `db/schema_v43_lms_module.sql`
- `scripts/verify-lms-module.mjs`

Types, validation, and services:
- `src/types/lms.ts`
- `src/lib/validation.ts`
- `src/lib/server/lms.ts`
- `src/lib/services/lms.ts`
- `src/hooks/use-data.ts`

API:
- `src/app/api/lms/[[...segments]]/route.ts`

Frontend:
- `src/components/lms/LmsScreens.tsx`
- `src/app/(app)/lms/page.tsx`
- `src/app/(app)/lms/my/page.tsx`
- `src/app/(app)/lms/catalog/page.tsx`
- `src/app/(app)/lms/player/[enrollmentId]/page.tsx`
- `src/app/(app)/lms/certificates/page.tsx`
- `src/app/(app)/lms/community/page.tsx`
- `src/app/(app)/lms/courses/page.tsx`
- `src/app/(app)/lms/courses/new/page.tsx`
- `src/app/(app)/lms/courses/[courseId]/edit/page.tsx`
- `src/app/(app)/lms/courses/[courseId]/instructors/page.tsx`
- `src/app/(app)/lms/courses/[courseId]/tasks/page.tsx`
- `src/app/(app)/lms/courses/[courseId]/submissions/page.tsx`
- `src/app/(app)/lms/courses/[courseId]/community/page.tsx`
- `src/app/(app)/lms/assignments/page.tsx`
- `src/app/(app)/lms/reports/page.tsx`

Navigation and gates:
- `src/middleware.ts`
- `src/lib/rbac.ts`
- `src/components/layout/Sidebar.tsx`

## On-Ground SIM Import Files

Database and test support:
- `db/schema_v52_sim_box_ocr_import.sql`
- `scripts/test-sim-box-generation.mjs`

OCR import helpers:
- `src/lib/sim-box-import.ts`
- `src/lib/sim-box-local-ocr.ts`
- `src/lib/field-agents/schemas.ts`
- `src/types/field-agents.ts`

API and frontend:
- `src/app/api/sales/agents/[[...segments]]/route.ts`
- `src/lib/services/field-agents.ts`
- `src/components/field-agents/FieldAgentAdminScreens.tsx`

## Root Directory

```
tatwir-hrms/
├── .env.example              # Environment variable template
├── components.json           # ShadCN/UI configuration
├── db/                       # Database schema and migrations
├── docs/                     # Legacy project planning documents
├── next.config.mjs           # Next.js configuration (security headers)
├── package.json              # Dependencies and npm scripts
├── package-lock.json         # Dependency lock file
├── postcss.config.mjs        # PostCSS configuration for Tailwind
├── PROJECT_CONTEXT.md        # AI-readable project context document
├── README.md                 # Project README
├── scripts/                  # Database seed and utility scripts
├── src/                      # Application source code
├── tailwind.config.ts        # Tailwind CSS configuration
└── tsconfig.json             # TypeScript configuration
```

## Source Code (`src/`)

```
src/
├── app/                      # Next.js App Router pages and API routes
│   ├── globals.css           # Global styles + CSS variables (light/dark themes)
│   ├── layout.tsx            # Root layout: Arabic font, RTL, RoleProvider
│   ├── favicon.ico
│   ├── login/                # Public login page
│   │   └── page.tsx
│   ├── suspended/            # Account suspended page
│   │   └── page.tsx
│   ├── auth/                 # Auth callback (magic link exchange)
│   │   └── callback/route.ts
│   ├── api/                  # Server-side API route handlers
│   │   ├── accounting/       # Accounting module endpoints
│   │   ├── advance-requests/ # Advance salary requests
│   │   ├── assets/           # Company asset management
│   │   ├── attendance/       # Attendance operations
│   │   ├── candidate/        # Candidate portal API
│   │   ├── chat/             # Internal messaging
│   │   ├── hr/               # HR admin operations
│   │   ├── leave-requests/   # Leave management
│   │   ├── manager/          # Manager-specific operations
│   │   ├── recruitment/      # Recruitment pipeline
│   │   ├── sales/            # Sales module
│   │   ├── superadmin/       # Platform administration
│   │   └── tasks/            # Task management
│   ├── candidate/            # Candidate-facing pages
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── applications/page.tsx
│   ├── apply/                # Public job application pages
│   │   └── [postingId]/page.tsx
│   └── (app)/                # Protected route group (all authenticated pages)
│       ├── layout.tsx        # App shell: AuthGuard + Sidebar + Header
│       ├── page.tsx          # Dashboard (role-based KPI cards)
│       ├── accounting/       # Full accounting module
│       ├── assets/           # Company asset tracking
│       ├── attendance/       # GPS check-in/out with selfie
│       ├── balances/         # Leave balance viewer
│       ├── chat/             # Internal messaging
│       ├── departments/      # Department management
│       ├── employees/        # Employee CRUD + detail view
│       ├── leave/            # Leave requests and approvals
│       ├── locations/        # Location/geofence management
│       ├── notifications/    # Notification center
│       ├── payroll/          # Payroll overview
│       ├── personnel/        # Personnel operations
│       ├── recruitment/      # Recruitment ATS interface
│       ├── sales/            # Sales logging and dashboard
│       ├── schedule/         # Shift scheduling
│       ├── settings/         # User/company settings
│       └── tasks/            # Task assignment and tracking
│
├── components/               # React components
│   ├── auth/                 # Authentication components
│   │   └── AuthGuard.tsx     # Client-side auth redirect guard
│   ├── ErrorBoundary.tsx     # React error boundary
│   ├── PhasePlaceholder.tsx  # "Coming soon" placeholder card
│   ├── Skeletons.tsx         # Loading skeleton variants
│   ├── accounting/           # Accounting-specific components
│   ├── attendance/           # Attendance-specific components
│   ├── candidate/            # Candidate portal components
│   ├── charts/               # SVG chart components (MiniLineChart, MiniBarChart)
│   ├── forms/                # Dialog-based form components
│   ├── layout/               # App shell components
│   │   ├── Sidebar.tsx       # Fixed left sidebar (role-based navigation)
│   │   └── Header.tsx        # Top bar (search, user dropdown, mobile menu)
│   ├── locations/            # Location/map components
│   ├── recruitment/          # Recruitment-specific components
│   ├── sales/                # Sales-specific components (SalesShiftMonitor)
│   └── ui/                   # ShadCN primitive components (14+)
│       ├── avatar.tsx
│       ├── badge.tsx
│       ├── button.tsx
│       ├── calendar.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── popover.tsx
│       ├── select.tsx
│       ├── sheet.tsx
│       ├── table.tsx
│       └── tabs.tsx
│
├── config/
│   └── brand.ts              # Brand constants (colors, tagline)
│
├── hooks/
│   └── use-data.ts           # Generic data-fetching hooks (useOrgData + domain hooks)
│
├── lib/
│   ├── utils.ts              # cn() helper (clsx + tailwind-merge)
│   ├── validation.ts         # Zod validation schemas
│   ├── rbac.ts               # Role definitions, path access rules
│   ├── hr-options.ts         # HR dropdown option constants
│   ├── leave-balance-core.ts # Leave balance calculation logic
│   ├── location-classification.ts # Location type helpers
│   ├── accounting/           # Accounting business logic utilities
│   ├── server/               # Server-only utilities
│   ├── superadmin/           # Superadmin helper functions
│   ├── supabase/             # Supabase client factories
│   │   ├── client.ts         # Browser client (anon key, RLS-enforced)
│   │   ├── server.ts         # Server client (cookie-based, RLS-enforced)
│   │   └── admin.ts          # Admin client (service role, bypasses RLS)
│   ├── services/             # Data access service modules (27 files)
│   └── utils/                # Additional utilities
│       └── audit.ts          # Audit logging helper
│
├── providers/
│   └── RoleProvider.tsx      # Auth context provider (user, login, logout, refresh)
│
├── data/
│   └── mock.ts               # Legacy mock data (unused)
│
└── types/
    ├── index.ts              # Role, User, ActivityEvent type definitions
    ├── database.ts           # Full Supabase Database type (auto-generated)
    └── accounting.ts         # Accounting-specific types
```

## Database Directory (`db/`)

```
db/
├── schema.sql                        # Original development schema
├── schema-production-clean.sql       # Canonical base schema (v1)
└── schema_v2_additions.sql           # Incremental migrations (v2 through current)
    schema_v3_rbac.sql
    schema_v4_modules.sql
    ...
    schema_v37_accounting_module.sql
    schema_v38_accounting_hardening.sql
    schema_v39_accounting_completion.sql
    schema_v40_accounting_audit_fixes.sql
    schema_v47_field_agents.sql
    schema_v48_merchants.sql
    schema_v49_onground_agent_manager.sql
    schema_v50_sim_packages_trader_payments.sql
    schema_v51_trader_sale_activation_details.sql
    schema_v52_sim_box_ocr_import.sql
```

## Scripts Directory (`scripts/`)

```
scripts/
├── apply-schema.mjs              # Full schema reset (destructive, needs flag)
├── apply-migration.mjs           # Safe incremental migration runner
├── apply-supabase-sql.mjs        # Raw SQL execution via Supabase API
├── debug-schema.mjs              # Schema debugging utility
├── verify-accounting-module.mjs  # Accounting module verification
├── test-sim-box-generation.mjs    # SIM box kit-code generation edge-case test
├── test-sim-box-parser.mjs        # SIM box OCR text parser edge-case test
├── seed-initial-admin.mjs        # Create first admin user
├── seed-dr-amr-admin.mjs         # Create platform superadmin
├── seed-demo-users.mjs           # Demo user accounts (staging only)
├── seed-production-users.mjs     # Production user setup
├── seed-saudi-employees.mjs      # Saudi employee sample data
├── seed-sales-mock.mjs           # Sales module mock data
├── seed-sales-operations.mjs     # Sales operations data
├── seed-location-coordinates.mjs # Location GPS coordinates
├── seed-attendance-dashboard.mjs # Attendance sample data
├── seed-demo-tasks.mjs           # Task sample data
├── seed-demo-schedules-leaves.mjs # Schedule and leave data
├── seed-recruitment-mock.mjs     # Recruitment pipeline data
├── cleanup-test-accounts.mjs     # Remove test accounts
└── sales-locations-2026.json     # Sales location reference data
```
