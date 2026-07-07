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

## Apply additive migrations

For production or staging databases that already contain data, prefer additive migration files instead of the full schema reset:

```bash
npm run apply:migration -- db/<migration-file>.sql
```

Some networks cannot resolve or connect to Supabase direct database hosts such as `db.<project-ref>.supabase.co` because that endpoint may require working IPv6 routing. If the direct database command fails with DNS or TCP errors, use the supported Supabase Management API fallback:

```bash
npm run apply:supabase-sql -- db/schema_v43_lms_module.sql
```

This fallback requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_ACCESS_TOKEN` in `.env.local`. Do not print, paste into logs, or commit `SUPABASE_ACCESS_TOKEN`. If direct database connectivity is required, prefer a Supabase pooler URL over the direct `db.<project-ref>.supabase.co` host.

After applying the LMS migration, verify it with:

```bash
npm run verify:lms
```

## Apply on-ground agent and trader migrations

Apply the on-ground SIM distribution migrations sequentially on databases that already have the base schema:

```bash
npm run apply:migration -- db/schema_v47_field_agents.sql
npm run apply:migration -- db/schema_v48_merchants.sql
npm run apply:migration -- db/schema_v49_onground_agent_manager.sql
npm run apply:migration -- db/schema_v50_sim_packages_trader_payments.sql
npm run apply:migration -- db/schema_v51_trader_sale_activation_details.sql
npm run apply:migration -- db/schema_v52_sim_box_ocr_import.sql
npm run apply:migration -- db/schema_v53_editable_sim_commission_rules_finance.sql
```

`schema_v52_sim_box_ocr_import.sql` creates the private `sim-box-imports` storage bucket, `sim_import_batches`, and SIM import provenance columns. OCR runs client-side through Tesseract.js and optional ZXing barcode detection, so no server-side OCR key or paid OCR API is required.

`schema_v53_editable_sim_commission_rules_finance.sql` adds editable SIM package commission rules, sale-time commission snapshots, commission `sale_id` links, Finance settlement fields, and settlement indexes. It is additive and does not recalculate old sale snapshots when package rules change.

Run the focused generation check after code changes that touch kit-code generation:

```bash
npm run test:sim-box-generation
npm run test:sim-box-parser
npm run test:sim-commissions
```

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
