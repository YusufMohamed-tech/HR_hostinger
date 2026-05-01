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

## Apply Database Schema
Add your database connection string to `.env.local`:
```
SUPABASE_DB_URL=postgresql://...
```

Then run:
```bash
npm run apply:schema
```

## Deployment (Vercel)
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
- Deploy from GitHub.

## Documentation
See the [docs](docs) directory for architecture, database, backend, frontend, and presentation details.
