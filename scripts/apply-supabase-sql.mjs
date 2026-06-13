import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

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
const sqlWithoutComments = sql
  .replace(/--.*$/gmu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

if (/\bdrop\s+table\b|\btruncate\b/iu.test(sqlWithoutComments) && process.env.ALLOW_DESTRUCTIVE_MIGRATION !== "true") {
  console.error("Refusing to run a migration containing DROP TABLE or TRUNCATE.");
  process.exit(1);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await response.text();
if (!response.ok) {
  console.error(`Migration failed (${response.status}): ${text}`);
  process.exit(1);
}

console.log(`Migration applied through Supabase Management API: ${path.relative(process.cwd(), migrationPath)}`);
