# Tatwir Talent HRMS

AI-driven HR and workforce management platform for deskless teams. This repo includes a full mock UI and a production-ready Supabase schema with RLS policies.

## Features
- Multi-tenant org management with role-based access
- Employee, department, location, contract, and hierarchy modules
- Shift scheduling with conflict placeholders
- Event stream tracking (check-in, movement, sales)
- KPI analytics and payroll previews
- Professional LMS module for internal corporate learning
- AI insights and audit logs (mocked)

## Local Setup
1. Install dependencies
```bash
npm install
```

2. Configure environment
```bash
cp .env.example .env.local
```

3. Run the app
```bash
npm run dev
```

## Apply Database Changes
Add your database connection string to `.env.local`:
```
SUPABASE_DB_URL=postgresql://...
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

For production or any database that contains real data, apply only the needed migration:
```bash
npm run apply:migration -- db/schema_v12_safe_saves_and_policy_fix.sql
```

`npm run apply:schema` is a full reset command for local/staging only. It runs `db/schema-production-clean.sql`, which drops and recreates application tables. It is protected and will refuse to run unless you explicitly set `ALLOW_DESTRUCTIVE_SCHEMA_APPLY=true`.

For an intentional local/staging reset only:
```bash
ALLOW_DESTRUCTIVE_SCHEMA_APPLY=true npm run apply:schema
```

For production, create the first admin through the Supabase Admin API:
```bash
npm run seed:admin
```

To create Dr. Amr Naiem as a platform superadmin with full system access:
```bash
npm run seed:dr-amr
```

Demo users are optional for local/staging only:
```bash
npm run seed:demo
```

## LMS Module v43
The LMS module is implemented as a private, multi-tenant HRMS module for employee learning. It includes course categories, courses, sections, text/video/document/link lessons, quizzes, tasks, submissions, instructor review, course community, announcements, learner progress, assignments, certificates, reports, and private `lms-content` storage.

Apply the additive LMS migration:
```bash
npm run apply:migration -- db/schema_v43_lms_module.sql
```

If the direct database host `db.<project-ref>.supabase.co` fails on a network without working IPv6/direct DB access, use the Supabase Management API fallback:
```bash
npm run apply:supabase-sql -- db/schema_v43_lms_module.sql
```

Keep `SUPABASE_ACCESS_TOKEN` only in local/secure environment configuration. Do not print it in logs or commit it. Prefer a Supabase pooler URL if direct PostgreSQL connectivity is required.

Verify LMS database objects after the migration is reachable:
```bash
npm run verify:lms
```

## Deployment (Vercel)
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
- Deploy from GitHub.

## Documentation
See the [documentations](documentations) directory for architecture, database, backend, frontend, and presentation details.
