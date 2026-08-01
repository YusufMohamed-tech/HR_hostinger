import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";
import { readManifest, readProjectFile, sha256, validateManifest } from "./migration-manifest.mjs";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const statusOnly = args.includes("--status");
const fresh = args.includes("--fresh");
const adoptIndex = args.indexOf("--adopt-through");
const adoptThrough = adoptIndex >= 0 ? args[adoptIndex + 1] : null;

const manifest = readManifest();
const { errors } = validateManifest(manifest);
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (dryRun) {
  console.log(`Baseline: ${manifest.baseline.id} (${manifest.baseline.file})`);
  for (const [index, entry] of manifest.migrations.entries()) {
    console.log(`${String(index + 1).padStart(2, "0")} ${entry.id} ${entry.file}`);
  }
  process.exit(0);
}

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("Missing SUPABASE_DB_URL, DATABASE_URL, or POSTGRES_URL.");
  process.exit(1);
}

if (fresh && adoptThrough) {
  console.error("Use either --fresh or --adopt-through, not both.");
  process.exit(1);
}

if (adoptThrough && process.env.ALLOW_MIGRATION_ADOPTION !== "true") {
  console.error("Migration adoption only records history; it does not validate deployed objects.");
  console.error("After a manual schema comparison, set ALLOW_MIGRATION_ADOPTION=true and retry.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : false,
});

const ledgerSql = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    id text PRIMARY KEY,
    file_path text NOT NULL UNIQUE,
    checksum_sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by text NOT NULL,
    execution_ms integer NOT NULL DEFAULT 0
  )
`;

function entryRecord(entry) {
  const sql = readProjectFile(entry.file);
  return { ...entry, sql, checksum: sha256(sql) };
}

async function record(entry, appliedBy, executionMs = 0) {
  const item = entryRecord(entry);
  await client.query(
    `INSERT INTO public.schema_migrations (id, file_path, checksum_sha256, applied_by, execution_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [item.id, item.file, item.checksum, appliedBy, executionMs]
  );
}

async function apply(entry) {
  const item = entryRecord(entry);
  const started = Date.now();
  await client.query("BEGIN");
  try {
    await client.query(item.sql);
    await client.query(
      `INSERT INTO public.schema_migrations (id, file_path, checksum_sha256, applied_by, execution_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.id, item.file, item.checksum, process.env.MIGRATION_ACTOR || "cli", Date.now() - started]
    );
    await client.query("COMMIT");
    console.log(`Applied ${item.id} (${Date.now() - started} ms)`);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error && typeof error === "object" && "position" in error && error.position) {
      const position = Number(error.position);
      if (Number.isFinite(position) && position > 0) {
        const prefix = item.sql.slice(0, position - 1);
        const line = prefix.split("\n").length;
        const column = position - prefix.lastIndexOf("\n");
        console.error(`${entry.file}:${line}:${column}`);
      }
    }
    throw error;
  }
}

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('tatwir_hrms_schema_migrations'))");
  await client.query(ledgerSql);

  const { rows: appliedRows } = await client.query(
    "SELECT id, file_path, checksum_sha256, applied_at, applied_by FROM public.schema_migrations ORDER BY applied_at, id"
  );
  const applied = new Map(appliedRows.map((row) => [row.id, row]));
  const expected = [manifest.baseline, ...manifest.migrations].map(entryRecord);

  for (const entry of expected) {
    const existing = applied.get(entry.id);
    if (existing && (existing.file_path !== entry.file || existing.checksum_sha256 !== entry.checksum)) {
      throw new Error(`Applied migration drift detected for ${entry.id}; never edit an applied migration.`);
    }
  }

  if (statusOnly) {
    for (const entry of expected) console.log(`${applied.has(entry.id) ? "applied" : "pending"}\t${entry.id}\t${entry.file}`);
    process.exitCode = 0;
  } else if (adoptThrough) {
    const lastIndex = manifest.migrations.findIndex((entry) => entry.id === adoptThrough);
    if (lastIndex < 0) throw new Error(`Unknown --adopt-through id: ${adoptThrough}`);
    if (applied.size > 0) throw new Error("Adoption is only allowed when the migration ledger is empty.");

    const { rows } = await client.query(
      "SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
    );
    if (Number(rows[0]?.count || 0) === 0) throw new Error("Cannot adopt an empty database; use --fresh.");

    await record(manifest.baseline, `adopt:${process.env.MIGRATION_ACTOR || "cli"}`);
    for (const entry of manifest.migrations.slice(0, lastIndex + 1)) {
      await record(entry, `adopt:${process.env.MIGRATION_ACTOR || "cli"}`);
    }
    console.log(`Adopted existing schema history through ${adoptThrough}. Run --status, then apply pending migrations.`);
  } else {
    if (!applied.has(manifest.baseline.id)) {
      const { rows } = await client.query(
        "SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
      );
      const tableCount = Number(rows[0]?.count || 0);
      if (!fresh) {
        throw new Error(
          tableCount > 0
            ? "Existing database has no tracked baseline. Compare it with the manifest, then use --adopt-through with explicit approval."
            : "Empty database detected. Re-run with --fresh to apply the baseline and all migrations."
        );
      }
      if (tableCount > 0) throw new Error("--fresh is only allowed when the public schema has no application tables.");
      await apply(manifest.baseline);
      applied.set(manifest.baseline.id, true);
    } else if (fresh) {
      throw new Error("--fresh cannot be used after a baseline has already been recorded.");
    }

    for (const entry of manifest.migrations) {
      if (!applied.has(entry.id)) await apply(entry);
    }
    console.log("Database is at the manifest head.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext('tatwir_hrms_schema_migrations'))");
  } catch {
    // Connection/setup failure may happen before the lock is acquired.
  }
  await client.end().catch(() => undefined);
}
