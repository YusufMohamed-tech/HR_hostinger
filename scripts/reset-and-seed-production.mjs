import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCOUNTS = [
  {
    email: "dr.amr@tatwir.sa",
    password: "Dramr@2026",
    fullName: "Dr. Amr",
    role: "admin",
    platformRole: "superadmin",
    title: "Super Admin",
  },
  {
    email: "wejdan@tatwir.sa",
    password: "Wejdan@2026",
    fullName: "Wejdan",
    role: "hr_admin",
    platformRole: null,
    title: "HR Admin",
  },
  {
    email: "wael@tatwir.sa",
    password: "Wael@2026",
    fullName: "Wael",
    role: "sales_manager",
    platformRole: null,
    title: "GM Sales",
  },
  {
    email: "a.gaafar@tatwir.sa",
    password: "Gaafar@2026",
    fullName: "A. Gaafar",
    role: "finance_manager",
    platformRole: null,
    title: "Finance Manager",
  },
];

async function runSQL(sql) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function clearAllData() {
  console.log("\n=== STEP 1: Clear all public table data ===\n");

  const truncateSQL = `
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      -- Disable all triggers temporarily
      SET session_replication_role = 'replica';

      -- Truncate all tables in public schema
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;

      -- Re-enable triggers
      SET session_replication_role = 'origin';
    END $$;
  `;

  try {
    await runSQL(truncateSQL);
    console.log("  All public tables truncated successfully.");
  } catch (err) {
    console.error("  Truncate via Management API failed:", err.message);
    console.log("  Trying fallback approach...");
    await clearDataFallback();
  }
}

async function clearDataFallback() {
  const tablesToClear = [
    "chatbot_messages",
    "chatbot_conversations",
    "chatbot_actions",
    "platform_audit_logs",
    "platform_user_commands",
    "platform_admins",
    "event_outbox",
    "business_events",
    "employee_lifecycle_commands",
    "employee_career_events",
    "employee_locations",
    "employees",
    "org_members",
    "profiles",
    "departments",
    "locations",
    "organizations",
  ];

  for (const table of tablesToClear) {
    try {
      await runSQL(`DELETE FROM public.${table}`);
      console.log(`  Cleared: ${table}`);
    } catch (err) {
      console.log(`  Skip ${table}: ${err.message.slice(0, 80)}`);
    }
  }
}

async function deleteAllAuthUsers() {
  console.log("\n=== STEP 2: Delete all auth users ===\n");

  const deleteAuthSQL = `DELETE FROM auth.users;`;
  try {
    await runSQL(deleteAuthSQL);
    console.log("  All auth users deleted.");
  } catch (err) {
    console.error("  Direct auth delete failed:", err.message);
    console.log("  Trying user-by-user via admin API...");

    let page = 1;
    const perPage = 100;
    let totalDeleted = 0;

    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    for (const user of data.users) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) {
        console.warn(`  Could not delete ${user.email}: ${deleteError.message}`);
      } else {
        totalDeleted++;
      }
    }
    console.log(`  Deleted ${totalDeleted} auth users via admin API.`);
  }
}

async function seedAccounts() {
  console.log("\n=== STEP 3: Create organization ===\n");

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: "Tatwir", slug: "tatwir", status: "Active" })
    .select("id, name, slug")
    .single();
  if (orgError) throw new Error(`Failed to create organization: ${orgError.message}`);
  console.log(`  Organization created: ${org.name} (${org.id})`);

  console.log("\n=== STEP 3a: Seed plans ===\n");

  const plans = [
    {
      code: "starter",
      name: "Starter",
      description: "Core HR workspace with conservative tenant limits.",
      features: { hr: true, sales: false, recruitment: false, accounting: false, chat: true, assets: true, payroll: true, personnel: true, lms: true },
      limits: { employees: 50, storage_mb: 1024, sales_agents: 0, accounting_entries_monthly: 0, api_requests_monthly: 10000 },
      price_monthly: 0,
      price_yearly: 0,
      currency: "SAR",
      is_active: true,
    },
    {
      code: "pro",
      name: "Pro",
      description: "HR, sales, recruitment, and accounting for growing teams.",
      features: { hr: true, sales: true, recruitment: true, accounting: true, chat: true, assets: true, payroll: true, personnel: true, lms: true },
      limits: { employees: 250, storage_mb: 10240, sales_agents: 50, accounting_entries_monthly: 10000, api_requests_monthly: 50000 },
      price_monthly: 0,
      price_yearly: 0,
      currency: "SAR",
      is_active: true,
    },
    {
      code: "enterprise",
      name: "Enterprise",
      description: "Full platform with negotiated limits and support.",
      features: { hr: true, sales: true, recruitment: true, accounting: true, chat: true, assets: true, payroll: true, personnel: true, lms: true },
      limits: { employees: 10000, storage_mb: 102400, sales_agents: 1000, accounting_entries_monthly: 1000000, api_requests_monthly: 1000000 },
      price_monthly: 0,
      price_yearly: 0,
      currency: "SAR",
      is_active: true,
    },
  ];

  for (const plan of plans) {
    const { error: planError } = await supabase.from("plans").upsert(plan, { onConflict: "code" });
    if (planError) throw new Error(`Failed to seed plan ${plan.code}: ${planError.message}`);
  }
  console.log("  Plans seeded (starter, pro, enterprise).");

  console.log("\n=== STEP 3b: Provision tenant configuration ===\n");

  const { error: settingsError } = await supabase.from("organization_settings").upsert({
    org_id: org.id,
    brand_name: org.name,
    locale: "ar-SA",
    timezone: "Asia/Riyadh",
  }, { onConflict: "org_id" });
  if (settingsError) throw new Error(`Failed to create organization_settings: ${settingsError.message}`);
  console.log("  organization_settings created.");

  const { error: featuresError } = await supabase.from("organization_features").upsert({
    org_id: org.id,
    plan_code: "pro",
    hr_enabled: true,
    sales_enabled: true,
    recruitment_enabled: true,
    accounting_enabled: true,
    chat_enabled: true,
    assets_enabled: true,
    payroll_enabled: true,
    personnel_enabled: true,
    lms_enabled: true,
    enabled_modules: ["hr", "sales", "recruitment", "accounting", "chat", "assets", "payroll", "personnel", "lms"],
  }, { onConflict: "org_id" });
  if (featuresError) throw new Error(`Failed to create organization_features: ${featuresError.message}`);
  console.log("  organization_features created.");

  const { error: subscriptionError } = await supabase.from("organization_subscriptions").upsert({
    org_id: org.id,
    plan_code: "pro",
    status: "active",
    period_start: new Date().toISOString(),
    period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "org_id" });
  if (subscriptionError) throw new Error(`Failed to create organization_subscriptions: ${subscriptionError.message}`);
  console.log("  organization_subscriptions created.");

  console.log("\n=== STEP 4: Create user accounts ===\n");

  for (const account of ACCOUNTS) {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });
    if (authError) throw new Error(`Failed to create auth user ${account.email}: ${authError.message}`);

    const userId = authData.user.id;

    const { error: profileError } = await supabase.from("profiles").upsert({
      user_id: userId,
      org_id: org.id,
      full_name: account.fullName,
      email: account.email,
      title: account.title,
      account_status: "active",
    }, { onConflict: "user_id" });
    if (profileError) throw new Error(`Failed to create profile for ${account.email}: ${profileError.message}`);

    const { error: memberError } = await supabase.from("org_members").insert({
      org_id: org.id,
      user_id: userId,
      role: account.role,
    });
    if (memberError) throw new Error(`Failed to create org_member for ${account.email}: ${memberError.message}`);

    if (account.platformRole) {
      const { error: platformError } = await supabase.from("platform_admins").insert({
        user_id: userId,
        role: account.platformRole,
        status: "active",
      });
      if (platformError) throw new Error(`Failed to create platform_admin for ${account.email}: ${platformError.message}`);
    }

    console.log(`  Created: ${account.email} | Role: ${account.role} | Title: ${account.title}${account.platformRole ? " | Platform: " + account.platformRole : ""}`);
  }

  console.log("\n=== DONE ===\n");
  console.log("Production accounts ready:");
  console.table(
    ACCOUNTS.map((a) => ({
      Email: a.email,
      Password: a.password,
      Role: a.role,
      Title: a.title,
    }))
  );
}

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  PRODUCTION RESET & SEED                    ║");
  console.log("║  This will DELETE ALL data and users         ║");
  console.log("╚══════════════════════════════════════════════╝");

  if (!projectRef || !accessToken) {
    console.error("\nMissing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env.local");
    console.error("These are needed for the Management API to run SQL directly.");
    process.exit(1);
  }

  await clearAllData();
  await deleteAllAuthUsers();
  await seedAccounts();
}

main().catch((error) => {
  console.error("\nFATAL:", error.message);
  process.exit(1);
});
