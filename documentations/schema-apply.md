# Apply Database Schema

## Requirements
- .env.local with SUPABASE_DB_URL (or DATABASE_URL)
- NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY when seeding users
- Node.js installed

## Apply the schema
```bash
npm run apply:schema
```

The script runs `db/schema-production-clean.sql` inside a transaction and prints success or failure.

## Seed the initial production admin
Set these variables in `.env.local`:
```env
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=
INITIAL_ADMIN_NAME=
INITIAL_ORG_NAME=
INITIAL_ORG_SLUG=
```

Then run:
```bash
npm run seed:admin
```

The production schema intentionally avoids direct writes to Supabase Auth tables. This seed step creates/updates the first admin through the Supabase Admin API, then links the user to `profiles` and `org_members`.

## Seed Dr. Amr Naiem as platform superadmin
Optional overrides:
```env
DR_AMR_ADMIN_EMAIL=dr.amr.naiem@tatwir.sa
DR_AMR_ADMIN_PASSWORD=
DR_AMR_ADMIN_NAME=Dr. Amr Naiem
DR_AMR_ORG_NAME=Tatwir Talent
DR_AMR_ORG_SLUG=tatwir-talent
DR_AMR_ORG_ID=
```

Then run:
```bash
npm run seed:dr-amr
```

This creates/updates the Supabase Auth user, activates the profile, gives the user organization admin access, and marks the user as an active platform superadmin.

## Seed local/staging demo users
```bash
npm run seed:demo
```

Use demo users only outside production.
