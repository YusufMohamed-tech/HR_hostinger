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
  console.error("❌ Missing database connection string in .env.local");
  console.log("Available env vars:", {
    SUPABASE_DB_URL: !!process.env.SUPABASE_DB_URL,
    DATABASE_URL: !!process.env.DATABASE_URL,
    POSTGRES_URL: !!process.env.POSTGRES_URL
  });
  process.exit(1);
}

console.log("🔍 Database Schema Debug Tool");
console.log("📡 Connection string found:", connectionString.substring(0, 20) + "...");

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function debugSchema() {
  try {
    await client.connect();
    console.log("✅ Connected to database");

    // Test basic query
    const result = await client.query("SELECT version()");
    console.log("📊 Database version:", result.rows[0].version.split(',')[0]);

    // Check if pgcrypto extension exists
    const extResult = await client.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'"
    );
    console.log("🔐 pgcrypto extension:", extResult.rows.length > 0 ? "✅ Available" : "❌ Missing");

    // Check auth schema access
    try {
      const authResult = await client.query(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'auth'"
      );
      console.log("👤 Auth schema tables:", authResult.rows[0].count);
    } catch (err) {
      console.log("❌ Cannot access auth schema:", err.message);
    }

    // Check existing public tables
    const tableResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log("📋 Existing public tables:", tableResult.rows.map(r => r.table_name).join(', '));

    // Check if functions exist
    const funcResult = await client.query(
      "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name"
    );
    console.log("🔧 Existing functions:", funcResult.rows.map(r => r.routine_name).join(', '));

    // Test a simple schema query
    try {
      const schemaTest = await client.query("SELECT COUNT(*) FROM public.organizations");
      console.log("🏢 Organizations count:", schemaTest.rows[0].count);
    } catch (err) {
      console.log("❌ Cannot query organizations:", err.message);
    }

    console.log("\n🎯 Debugging complete!");
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
    console.error("Stack trace:", error.stack);
  } finally {
    await client.end();
  }
}

debugSchema();
