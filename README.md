# Tatwir Talent HRMS

AI-driven HR and workforce management platform for deskless teams. This repo includes a full mock UI and a production-ready Supabase schema with RLS policies.

## Features
- Multi-tenant org management with role-based access
- Employee, department, location, contract, and hierarchy modules
- Shift scheduling with conflict placeholders
- Event stream tracking (check-in, movement, sales)
- KPI analytics and payroll previews
- LMS onboarding pipeline
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

Demo users are optional for local/staging only:
```bash
npm run seed:demo
```

## Deployment (Vercel)
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
- Deploy from GitHub.

## Documentation
See the [docs](docs) directory for architecture, database, backend, frontend, and presentation details.
