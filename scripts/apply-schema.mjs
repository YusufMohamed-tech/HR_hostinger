import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!connectionString) {
  console.error("Missing SUPABASE_DB_URL (or DATABASE_URL) in .env.local");
  process.exit(1);
}

const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("Schema applied successfully.");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback errors when connection fails early.
  }
  console.error("Schema apply failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
