import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import {
  readManifest,
  sha256,
  validateManifest,
} from "./migration-manifest.mjs";

dotenv.config({ path: ".env.local" });

const migrationArg = process.argv[2];
if (!migrationArg) {
  console.error("Usage: node scripts/apply-supabase-sql.mjs db/<migration-file>.sql");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = supabaseUrl?.match(/^https:\/\/([^.]+)\./)?.[1];

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const migrationPath = path.resolve(process.cwd(), migrationArg);
if (!fs.existsSync(migrationPath)) {
  console.error(`Migration file not found: ${migrationPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(migrationPath, "utf8");
const manifest = readManifest();
const manifestValidation = validateManifest(manifest);
if (manifestValidation.errors.length > 0) {
  throw new Error(`Migration manifest is invalid: ${manifestValidation.errors.join("; ")}`);
}
const projectFile = path.relative(process.cwd(), migrationPath).replaceAll("\\", "/");
const entry = manifest.migrations.find((item) => item.file === projectFile);
if (!entry) {
  console.error("Only a forward migration registered in db/migrations.manifest.json may be applied.");
  process.exit(1);
}
const checksum = sha256(sql);
const sqlWithoutComments = sql
  .replace(/--.*$/gmu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

if (/\bdrop\s+table\b|\btruncate\b/iu.test(sqlWithoutComments) && process.env.ALLOW_DESTRUCTIVE_MIGRATION !== "true") {
  console.error("Refusing to run a migration containing DROP TABLE or TRUNCATE.");
  process.exit(1);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const headers = {
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
};
const existingResponse = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({
    query: `
      select to_jsonb(migration) as record
      from public.schema_migrations migration
      where migration.id = '${entry.id.replaceAll("'", "''")}'
    `,
  }),
});
const existingText = await existingResponse.text();
if (!existingResponse.ok) {
  console.error(`Migration ledger check failed (${existingResponse.status}): ${existingText}`);
  process.exit(1);
}
const existingRows = JSON.parse(existingText);
if (Array.isArray(existingRows) && existingRows.length > 0) {
  const existing = existingRows[0]?.record || {};
  const existingFile = existing.file_path ?? existing.file;
  const existingChecksum = existing.checksum_sha256 ?? existing.checksum;
  if (existingFile !== entry.file || existingChecksum !== checksum) {
    console.error(`Applied migration drift detected for ${entry.id}.`);
    process.exit(1);
  }
  console.log(`Migration already applied with matching checksum: ${entry.id}`);
  process.exit(0);
}

const columnsResponse = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({
    query: `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'schema_migrations'
    `,
  }),
});
const columnsText = await columnsResponse.text();
if (!columnsResponse.ok) {
  console.error(`Migration ledger metadata check failed (${columnsResponse.status}): ${columnsText}`);
  process.exit(1);
}
const ledgerColumns = new Set(JSON.parse(columnsText).map((row) => row.column_name));
const fileColumn = ledgerColumns.has("file_path") ? "file_path" : "file";
const checksumColumn = ledgerColumns.has("checksum_sha256") ? "checksum_sha256" : "checksum";
for (const requiredColumn of ["id", fileColumn, checksumColumn]) {
  if (!ledgerColumns.has(requiredColumn)) {
    console.error(`Migration ledger is missing required column ${requiredColumn}.`);
    process.exit(1);
  }
}

const appliedBy = (process.env.MIGRATION_ACTOR || "supabase-management-api").replaceAll("'", "''");
const started = Date.now();
const actorColumn = ledgerColumns.has("applied_by") ? ", applied_by" : "";
const actorValue = ledgerColumns.has("applied_by") ? `, '${appliedBy}'` : "";
const executionColumn = ledgerColumns.has("execution_ms") ? ", execution_ms" : "";
const executionValue = ledgerColumns.has("execution_ms") ? `, ${Math.max(Date.now() - started, 0)}` : "";
const transaction = `
  BEGIN;
  ${sql}
  INSERT INTO public.schema_migrations (
    id, ${fileColumn}, ${checksumColumn}${actorColumn}${executionColumn}
  )
  VALUES (
    '${entry.id.replaceAll("'", "''")}',
    '${entry.file.replaceAll("'", "''")}',
    '${checksum}'${actorValue}${executionValue}
  );
  COMMIT;
`;
const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({ query: transaction }),
});
const text = await response.text();
if (!response.ok) {
  console.error(`Migration failed (${response.status}): ${text}`);
  process.exit(1);
}

console.log(`Migration applied and recorded through Supabase Management API: ${entry.id}`);
