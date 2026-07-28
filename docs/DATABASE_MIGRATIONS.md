# Database Migration Runbook

`db/migrations.manifest.json` is the only authoritative migration order. Filename sorting is not an ordering mechanism because historical versions 13, 43, 44, and 54 each contain two migrations.

Current repository state (2026-07-28): 125 ordered migrations after the baseline; the current head is `schema_v123_atomic_product_receiving`. Always use the verifier for the live count instead of copying this number into deployment scripts.

## Safety rules

- Never edit a migration after it has been recorded in `public.schema_migrations`; the runner compares SHA-256 checksums and stops on drift.
- Never apply a single SQL file directly in production. `npm run apply:migration` intentionally refuses to bypass the ledger.
- `db/schema.sql` is the fresh-database baseline. It contains destructive statements and is only used by `db:migrate -- --fresh` after the runner proves the public schema has no application tables.
- Historical v2 and v3 are already incorporated into the baseline and are recorded as absorbed files; they must not be replayed after it.
- `db/schema-production-clean.sql` is a legacy, incomplete reset snapshot and is excluded from forward deployment.
- `db/alter_leave_multi_level.sql` is obsolete and excluded because it references `leave_status_enum`, which is not the product enum.
- Use a Supabase pooler database URL when direct database DNS/IPv6 is unavailable.

## Verify the repository manifest

```bash
npm run db:verify-migrations
npm run db:migrate -- --dry-run
```

The verifier fails if a migration is missing, duplicated, empty, destructive, outside the repository, present on disk but absent from the manifest, or inconsistent with the migration ID/file/checksum required by runtime readiness in `src/lib/schema-version.json`.

## New empty environment

```bash
SUPABASE_DB_URL=postgresql://... npm run db:migrate -- --fresh
```

The command acquires a PostgreSQL advisory lock, applies the baseline, applies every migration in its own transaction, and records the file path/checksum, actor, timestamp, and execution time.

## Existing untracked environment

Do not guess its migration level. First compare the database objects, RLS policies, functions, triggers, enums, indexes, and storage configuration with the manifest in a disposable staging clone.

After that comparison identifies the last migration definitely present, adoption can be recorded once:

```bash
ALLOW_MIGRATION_ADOPTION=true \
MIGRATION_ACTOR=engineer@example.com \
SUPABASE_DB_URL=postgresql://... \
npm run db:migrate -- --adopt-through schema_v54b_payroll_deduction_groups
```

Adoption **does not execute or validate SQL**. It only creates history, so the environment comparison and approval evidence are mandatory.

Then inspect and apply pending work:

```bash
npm run db:migrate -- --status
npm run db:migrate
```

## Release procedure

1. Run CI and `db:verify-migrations` on the release commit.
2. Back up the database and record the restore point.
3. Run `db:migrate -- --status` against staging, then apply pending migrations.
4. Run integration, RLS, and reconciliation tests in staging.
5. Repeat status/apply against production during the approved window.
6. Archive the migration output and `schema_migrations` rows with the release evidence.

SQL schema changes roll forward with a corrective migration. Application rollback is allowed only when the older application remains compatible with the migrated schema.
