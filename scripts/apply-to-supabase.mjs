#!/usr/bin/env node
/**
 * Applies migrations to a live Supabase project via the Management API.
 * Usage: node scripts/apply-to-supabase.mjs
 *
 * Reads SUPABASE_PROJECT_ID and SUPABASE_ACCESS_TOKEN from env or args.
 * Creates schema_migrations table if absent (first run / adoption scenario).
 * Skips migrations already recorded in schema_migrations.
 * Stops immediately on any failure so state is never silently corrupted.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID || "mxifsvgrkxoyskkiaqzs";
const ACCESS_TOKEN =
  process.env.SUPABASE_ACCESS_TOKEN ||
  "sbp_fed15bb3ad755b5ca0eccdea09c26a2e6d5f7652";

const API = `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`;

async function sql(query) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok || (body && body.message && !Array.isArray(body))) {
    throw new Error(
      `SQL error (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  return body;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function ensureSchemamigrations() {
  await sql(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id            text        PRIMARY KEY,
      file          text        NOT NULL,
      checksum      text        NOT NULL,
      applied_at    timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied() {
  const rows = await sql(
    "SELECT id, checksum FROM public.schema_migrations ORDER BY applied_at"
  );
  const map = new Map();
  for (const r of rows) map.set(r.id, r.checksum);
  return map;
}

async function recordMigration(id, file, checksum) {
  await sql(`
    INSERT INTO public.schema_migrations (id, file, checksum)
    VALUES (${lit(id)}, ${lit(file)}, ${lit(checksum)})
    ON CONFLICT (id) DO NOTHING;
  `);
}

function lit(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

// Migrations up to and including this ID existed in the DB before our tracking
// system was introduced. They are recorded as adopted without being re-run.
const ADOPTION_BOUNDARY = "schema_v54b_payroll_deduction_groups";

async function main() {
  console.log(`\nTarget project: ${PROJECT_ID}`);

  const manifest = JSON.parse(
    readFileSync(resolve(ROOT, "db/migrations.manifest.json"), "utf8")
  );
  const migrations = manifest.migrations;
  console.log(`Manifest: ${migrations.length} migrations\n`);

  await ensureSchemamigrations();
  const applied = await getApplied();
  console.log(`Already tracked: ${applied.size} migrations`);

  let adopted = 0;
  let skipped = 0;
  let ran = 0;

  let pastBoundary = false;

  for (const { id, file } of migrations) {
    const filePath = resolve(ROOT, file);

    // Already tracked — verify checksum if we have the file, then skip.
    if (applied.has(id)) {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf8");
        const checksum = sha256(content);
        const stored = applied.get(id);
        if (stored !== checksum) {
          console.error(`\n  CHECKSUM MISMATCH (already applied): ${id}`);
          console.error(`    stored:  ${stored}`);
          console.error(`    current: ${checksum}`);
          process.exit(1);
        }
      }
      skipped++;
      if (id === ADOPTION_BOUNDARY) pastBoundary = true;
      continue;
    }

    // Adoption zone — record without running; schema already existed in DB.
    if (!pastBoundary) {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf8");
        const checksum = sha256(content);
        await recordMigration(id, file, checksum);
        process.stdout.write(`  ADOPT ${id}\n`);
        adopted++;
      } else {
        process.stdout.write(`  ADOPT (no file) ${id}\n`);
        await recordMigration(id, file, "adopted-no-file");
        adopted++;
      }
      if (id === ADOPTION_BOUNDARY) pastBoundary = true;
      continue;
    }

    // Normal migration run.
    if (!existsSync(filePath)) {
      console.log(`  SKIP (no file): ${id}`);
      skipped++;
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    const checksum = sha256(content);

    process.stdout.write(`  APPLY ${id} ... `);
    try {
      await sql(content);
      await recordMigration(id, file, checksum);
      console.log("OK");
      ran++;
    } catch (err) {
      console.log("FAILED");
      console.error(`\n  Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  console.log(
    `\nDone. Adopted: ${adopted}  Skipped: ${skipped}  Applied: ${ran}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
