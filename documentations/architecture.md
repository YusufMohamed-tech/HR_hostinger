# System Architecture

## High-Level Overview

Tatwir Talent HRMS follows a **monolithic full-stack architecture** using Next.js 14 with the App Router pattern. The system is a multi-tenant SaaS application where all data isolation is enforced at the database level through PostgreSQL Row Level Security (RLS).

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                         │
│    React 18 + Next.js App Router + Tailwind CSS + ShadCN/UI     │
│                        RTL Layout (Arabic)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
┌──────────────────┐ ┌─────────────┐ ┌─────────────────────┐
│   Client-Side    │ │  Next.js    │ │   Middleware         │
│   Services       │ │  API Routes │ │   (Auth + RBAC)      │
│   (Browser       │ │  (Server)   │ │                      │
│    Supabase)     │ │             │ │                      │
└────────┬─────────┘ └──────┬──────┘ └──────────┬──────────┘
         │                   │                    │
         │    ┌──────────────┼────────────────────┘
         │    │              │
         ▼    ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Supabase Platform                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  PostgreSQL   │  │    Auth      │  │      Storage          │ │
│  │  (RLS-       │  │  (Email/     │  │  (attendance-selfies, │ │
│  │   enforced)  │  │   Password)  │  │   employee-documents) │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. Presentation Layer (Client)

- **Framework:** Next.js 14 App Router with React 18
- **Routing:** File-system based routing under `src/app/`
- **Styling:** Tailwind CSS with HSL CSS variables for theming
- **Components:** ShadCN/UI primitives + custom business components
- **State:** React Context (RoleProvider) + local component state via hooks
- **Direction:** RTL (right-to-left) for Arabic language support

### 2. Application Layer

#### Client-Side Services (`src/lib/services/`)
- Direct Supabase queries from the browser using the **anon key**
- All queries are subject to RLS policies
- Used by pages for CRUD operations on most modules

#### Server-Side API Routes (`src/app/api/`)
- Next.js Route Handlers (42 endpoints)
- Use the **admin client** (service role key) to bypass RLS when needed
- Handle complex business logic: recruitment pipeline, sales logging, accounting
- Protected by middleware authentication checks

### 3. Middleware Layer (`src/middleware.ts`)

Intercepts every request and performs:
1. Session refresh (Supabase cookie management)
2. Authentication check (redirect to `/login` if unauthenticated)
3. Account/organization suspension check
4. Role-based access control (RBAC) enforcement
5. Candidate portal routing (users without org membership)

### 4. Data Layer (Supabase)

- **PostgreSQL:** 40+ tables with foreign key relationships
- **RLS Policies:** Org-scoped access with role-based write permissions
- **Auth:** Supabase Auth with email/password strategy
- **Storage:** File buckets for attendance selfies and employee documents
- **Helper Functions:** `current_org_id()`, `is_admin()`, `current_employee_id()`

## Multi-Tenancy Model

```
Organization (tenant)
├── org_members (user ↔ org link with role)
├── employees
├── departments
├── locations
├── shifts / attendance
├── tasks
├── leaves
├── sales data
├── recruitment postings
├── accounting records
└── ... all data is org_id scoped
```

Every table includes an `org_id` column. RLS policies ensure that users can only see data belonging to their organization. The `current_org_id()` SQL function extracts the user's org from `org_members`.

## Authentication Flow

```
Browser Request → Middleware → Supabase Auth (getUser)
    │                              │
    │ No user?                     │ Has user?
    │ → Redirect /login            │
    │                              ▼
    │                     Check platform_admins table
    │                              │
    │                    ┌─────────┴──────────┐
    │                    │                    │
    │               Superadmin?          Org Member?
    │               → Full access        → Check role
    │                                        │
    │                              ┌─────────┴──────────┐
    │                              │                    │
    │                         Has Role?            No Role?
    │                         → canAccessPath()    → Candidate portal
    │                              │
    │                         ┌────┴────┐
    │                         │         │
    │                    Allowed?    Blocked?
    │                    → Pass      → Redirect to default
    │
    ▼
Login Page → signInWithPassword → Set cookies → Redirect
```

## Deployment Architecture

```
┌──────────────────────┐         ┌──────────────────────────┐
│       Vercel          │         │       Supabase           │
│  ┌────────────────┐  │         │  ┌──────────────────┐   │
│  │ Next.js App    │  │ ──────▶ │  │ PostgreSQL       │   │
│  │ (SSR + Static) │  │         │  │ Auth             │   │
│  │ API Routes     │  │         │  │ Storage Buckets  │   │
│  └────────────────┘  │         │  └──────────────────┘   │
└──────────────────────┘         └──────────────────────────┘
```

- **Frontend/API:** Deployed on Vercel (automatic from GitHub)
- **Database/Auth/Storage:** Supabase managed cloud
- **CDN:** Vercel Edge Network for static assets
- **DNS:** Custom domain configuration through Vercel

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Client-side Supabase calls | Leverages RLS for security without server roundtrip |
| Server API routes for complex ops | Service role key needed for cross-org operations |
| Single App Router monolith | Simplicity for Phase 1; modules share auth context |
| RTL-first layout | Primary market is Saudi Arabia (Arabic) |
| HSL CSS variables | Supports light/dark themes with consistent brand colors |
| No state management library | React Context sufficient for auth; data fetched per-page |
| No form library | Custom forms with native React state (considered tech debt) |
| Multi-tenant via RLS | Database-level isolation without application code complexity |
