import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const migrationArg = process.argv[2];
if (!migrationArg) {
  console.error("Usage: npm run apply:migration -- db/<migration-file>.sql");
  process.exit(1);
}

const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!connectionString) {
  console.error("Missing SUPABASE_DB_URL (or DATABASE_URL) in .env.local");
  process.exit(1);
}

const migrationPath = path.resolve(process.cwd(), migrationArg);
if (!fs.existsSync(migrationPath)) {
  console.error(`Migration file not found: ${migrationPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(migrationPath, "utf8");
const destructivePattern = /\bdrop\s+table\b|\btruncate\b/iu;
const sqlWithoutComments = sql
  .replace(/--.*$/gmu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

if (destructivePattern.test(sqlWithoutComments) && process.env.ALLOW_DESTRUCTIVE_MIGRATION !== "true") {
  console.error("Refusing to run a migration containing DROP TABLE or TRUNCATE.");
  console.error("Set ALLOW_DESTRUCTIVE_MIGRATION=true only if this is intentional.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : false,
});

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`Migration applied successfully: ${path.relative(process.cwd(), migrationPath)}`);
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback errors when connection fails early.
  }
  console.error("Migration failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
