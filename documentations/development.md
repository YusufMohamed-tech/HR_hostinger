# Development Guide

## Getting Started

```bash
# Clone and install
git clone <repo-url>
cd HR
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with Supabase credentials

# Start development server
npm run dev
```

The app runs at http://localhost:3000 with hot reload enabled.

---

## NPM Scripts Reference

### Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js development server (port 3000) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

### Database Management

| Command | Description |
|---------|-------------|
| `npm run apply:schema` | Full schema reset (requires `ALLOW_DESTRUCTIVE_SCHEMA_APPLY=true`) |
| `npm run apply:migration -- <path>` | Apply single migration file |
| `npm run apply:supabase-sql` | Execute SQL via Supabase Management API |
| `npm run verify:accounting` | Verify accounting module tables exist |

### Data Seeding

| Command | Description |
|---------|-------------|
| `npm run seed:admin` | Create first admin user and organization |
| `npm run seed:dr-amr` | Create Dr. Amr Naiem as platform superadmin |
| `npm run seed:demo` | Create demo users (hr@tatwir.sa, employee@tatwir.sa) |
| `npm run seed:production-users` | Seed production user accounts |
| `npm run seed:saudi-employees` | Seed sample Saudi employees |
| `npm run seed:sales-mock` | Seed sales module data |
| `npm run seed:sales-operations` | Seed sales operations |
| `npm run seed:recruitment-mock` | Seed recruitment pipeline data |
| `npm run seed:attendance-dashboard` | Seed attendance records |
| `npm run seed:demo-tasks` | Seed task assignments |
| `npm run seed:demo-schedules-leaves` | Seed shifts and leave data |
| `npm run seed:location-coordinates` | Seed location GPS coordinates |
| `npm run cleanup:test-accounts` | Remove test accounts |

---

## Code Conventions

### File Naming

- Pages: `page.tsx` (Next.js convention)
- API routes: `route.ts`
- Components: PascalCase (`AddEmployeeDialog.tsx`)
- Services: kebab-case (`employee-details.ts`)
- Hooks: camelCase with `use-` prefix (`use-data.ts`)
- Types: camelCase (`database.ts`)

### Import Aliases

All source imports use the `@/` alias:

```typescript
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRoleContext } from "@/providers/RoleProvider";
import type { User } from "@/types";
```

### Component Structure

```tsx
"use client";  // Client components only

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRoleContext } from "@/providers/RoleProvider";

export default function PageName() {
  const { currentUser } = useRoleContext();
  const [data, setData] = useState([]);

  // Event handlers
  // Render
  return (...);
}
```

### Service Layer Pattern

```typescript
import { createClient } from "@/lib/supabase/client";

export async function getItems(orgId: string) {
  const supabase = createClient();
  return supabase
    .from("table_name")
    .select("*, relation(field)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
}
```

### API Route Pattern

```typescript
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Business logic...
  return NextResponse.json({ data: result });
}
```

---

## Adding New Features

### Adding a New Page

1. Create `src/app/(app)/feature-name/page.tsx`
2. Add route to RBAC rules in `src/lib/rbac.ts` (`canAccessPath`)
3. Add navigation item in `src/components/layout/Sidebar.tsx`
4. Create service functions in `src/lib/services/feature-name.ts`
5. Add data hook in `src/hooks/use-data.ts` if needed

### Adding a New API Route

1. Create `src/app/api/feature-name/route.ts`
2. Add RBAC path check in `src/lib/rbac.ts`
3. Use `createServerSupabaseClient()` for user-context queries
4. Use `createAdminClient()` for privileged operations
5. Return consistent `{ data }` or `{ message }` response

### Adding a New Database Table

1. Create `db/schema_vN_description.sql` migration file
2. Include `org_id` column for multi-tenancy
3. Add RLS policies (SELECT for org members, INSERT/UPDATE/DELETE for admins)
4. Add TypeScript types in `src/types/database.ts`
5. Apply migration: `npm run apply:migration -- db/schema_vN_description.sql`

### Adding a New UI Component

For ShadCN primitives:
```bash
npx shadcn@latest add component-name
```

For custom components:
1. Create file in appropriate `src/components/` subdirectory
2. Use `cn()` for conditional class merging
3. Follow existing patterns (card layout, dialog forms, table display)

---

## Database Workflow

### Creating Migrations

1. Create a new file: `db/schema_v{N}_{description}.sql`
2. Write idempotent SQL (use `IF NOT EXISTS`, `CREATE OR REPLACE`)
3. Include RLS policies for new tables
4. Test locally: `npm run apply:migration -- db/schema_vN_description.sql`
5. Commit the migration file

### Safe Migration Practices

- Never use `DROP TABLE` without the `ALLOW_DESTRUCTIVE_MIGRATION` guard
- Always include `org_id` in new tables
- Add `created_at` and `updated_at` timestamps
- Create RLS policies immediately
- Test with both admin and employee roles

---

## Debugging

### Common Issues

| Issue | Solution |
|-------|----------|
| "Unauthorized" on all requests | Check `.env.local` Supabase credentials |
| Data not loading | Verify user has org_members record |
| RLS blocking queries | Check `org_id` matches user's organization |
| Migration fails | Verify `SUPABASE_DB_URL` is correct |
| Build errors | Run `npm run lint` to identify TypeScript issues |

### Useful Debug Commands

```bash
# Check build compiles
npm run build

# Lint code
npm run lint

# Debug schema (verify table existence)
node scripts/debug-schema.mjs

# Verify accounting module
npm run verify:accounting
```

---

## Project-Specific Notes

### RTL Layout

- All new pages must work in RTL layout
- Use Tailwind's logical properties where possible (`ps-`, `pe-`, `ms-`, `me-`)
- Test with Arabic text for layout overflow
- Sidebar is right-aligned (`pr-[240px]` on desktop)

### Multi-Tenancy

- Every query MUST include `org_id` filtering
- Use `orgId` from `useRoleContext()` in client code
- RLS provides a safety net, but explicit filtering is still required in services

### Role-Based Development

- Always check `currentUser.role` before showing admin features
- Add new paths to `canAccessPath()` in `rbac.ts`
- Test with multiple roles (admin, employee, finance) when adding features

### Type Safety

- Database types are in `src/types/database.ts` (auto-generated from Supabase)
- Use Zod schemas (`src/lib/validation.ts`) for form input validation
- Service functions return `Record<string, unknown>` — extract fields explicitly

---

## Build & Deploy

### Production Build

```bash
npm run build
```

Produces optimized output in `.next/` directory. Build should complete with exit code 0.

### Deploy to Vercel

1. Push to GitHub
2. Vercel auto-deploys from connected repository
3. Ensure environment variables are set in Vercel dashboard

### Post-Deploy Checklist

- [ ] Verify login works
- [ ] Check all module pages load
- [ ] Test attendance GPS (requires HTTPS)
- [ ] Verify file uploads work (storage buckets exist)
- [ ] Confirm demo login buttons are hidden (`NEXT_PUBLIC_SHOW_DEMO_LOGINS=false`)
