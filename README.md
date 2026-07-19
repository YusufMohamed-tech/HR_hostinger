# Tatwir Talent HRMS

Multi-tenant HR and workforce management platform for deskless teams. The application and Supabase database are implemented together, with tenant-scoped authorization, row-level security, replay-safe workflow commands, durable events, and operational workers.

## Features
- Multi-tenant org management with role-based access
- Employee, department, location, contract, and hierarchy modules
- Shift scheduling with overlap, effective-date, and assignment conflict controls
- Event stream tracking (check-in, movement, sales)
- KPI analytics, authoritative payroll runs, payslips, and accounting integration
- Professional LMS module for internal corporate learning
- On-ground SIM distribution with editable package commission rules and Finance commission settlements
- Immutable business events, operational audit logs, notification outbox, compliance jobs, and managed-file retention

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

Verify the canonical migration manifest before database work:
```bash
npm run db:verify-migrations
npm run db:migrate -- --dry-run
```

For a new empty local/staging database, apply the tracked baseline and every ordered migration:

```bash
npm run db:migrate -- --fresh
```

For an existing environment, first follow [docs/DATABASE_MIGRATIONS.md](docs/DATABASE_MIGRATIONS.md). The runner refuses to guess an untracked database's migration level. Single-file migration application is disabled because it bypasses ordering and checksums.

`npm run apply:schema` remains a protected legacy reset command and must not be used for production.

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

The LMS migrations are included in the canonical manifest after the accounting v43 migration. Use `npm run db:migrate`; do not apply the duplicate historical v43 filenames by lexical order.

Keep `SUPABASE_ACCESS_TOKEN` only in local/secure environment configuration. Do not print it in logs or commit it. Prefer a Supabase pooler URL if direct PostgreSQL connectivity is required.

Verify LMS database objects after the migration is reachable:
```bash
npm run verify:lms
```

## On-Ground SIM Commissions v53
The SIM package catalog now stores editable commission rules. Defaults are 15 SAR total commission per package sale: trader sale pays 5 SAR to the field-agent chain and 10 SAR to the trader, while a direct field-agent activation pays 15 SAR to the field agent and no trader commission. Sale records snapshot the package rule used at sale time, so later package edits do not recalculate old commissions.

The commission/finance migration is ordered after v47-v52 in the canonical manifest and is applied with `npm run db:migrate`.

Run the focused calculation check after commission rule changes:
```bash
npm run test:sim-commissions
```

Finance users can review and settle sales commissions under `/accounting/commissions`. Settlement marks commission ledger rows paid with payment method, reference, and notes; it does not change the original sale snapshot.

## Deployment (Vercel)
- Follow [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md); do not deploy from this short README alone.
- Set every production-required value documented in `.env.example`, including the worker, malware-scanner, audit-evidence, and rate-limit secrets.
- Run `npm run verify:ci`, rehearse migration/rollback and backup/restore on staging, then obtain the launch sign-offs tracked in `docs/PRE_LAUNCH_AUDIT.md`.

## Documentation
See [docs](docs) for the current migration, security, operational, governance, role, payroll, and launch evidence documents. The [documentations](documentations) directory contains the earlier architecture and product references.
