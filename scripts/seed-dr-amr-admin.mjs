import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminEmail = process.env.DR_AMR_ADMIN_EMAIL || "dr.amr.naiem@tatwir.sa";
const adminPassword = process.env.DR_AMR_ADMIN_PASSWORD || crypto.randomBytes(18).toString("base64url");
const adminName = process.env.DR_AMR_ADMIN_NAME || "Dr. Amr Naiem";
const orgName = process.env.DR_AMR_ORG_NAME || process.env.INITIAL_ORG_NAME || "Tatwir Talent";
const orgSlug = process.env.DR_AMR_ORG_SLUG || process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const configuredOrgId = process.env.DR_AMR_ORG_ID || process.env.INITIAL_ORG_ID;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (!process.env.DR_AMR_ADMIN_PASSWORD) {
  console.log("\n=== Dr. Amr Naiem password (store this securely) ===");
  console.log(`DR_AMR_ADMIN_PASSWORD=${adminPassword}`);
  console.log("====================================================\n");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function getAuthUserByEmail(email) {
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < perPage) return null;

    page += 1;
  }
}

async function upsertAuthUser() {
  const existing = await getAuthUserByEmail(adminEmail);

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: adminName },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: adminName },
  });
  if (error) throw error;
  return data.user;
}

async function findOrCreateOrganization() {
  if (configuredOrgId) {
    const { data, error } = await supabase
      .from("organizations")
      .upsert({ id: configuredOrgId, name: orgName, slug: orgSlug, status: "Active" }, { onConflict: "id" })
      .select("id, name")
      .single();
    if (error) throw error;
    return data;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("organizations")
    .insert({ name: orgName, slug: orgSlug, status: "Active" })
    .select("id, name")
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  const organization = await findOrCreateOrganization();
  const admin = await upsertAuthUser();

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      user_id: admin.id,
      org_id: organization.id,
      full_name: adminName,
      email: adminEmail,
      title: "Platform Superadmin",
      account_status: "Active",
    },
    { onConflict: "user_id" }
  );
  if (profileError) throw profileError;

  const { error: memberError } = await supabase.from("org_members").upsert(
    {
      org_id: organization.id,
      user_id: admin.id,
      role: "admin",
    },
    { onConflict: "org_id,user_id" }
  );
  if (memberError) throw memberError;

  const { error: platformError } = await supabase.from("platform_admins").upsert(
    {
      user_id: admin.id,
      role: "superadmin",
      status: "active",
    },
    { onConflict: "user_id" }
  );
  if (platformError) {
    if (platformError.code === "42P01") {
      throw new Error("platform_admins is missing. Apply db/schema_v9_platform_admins_audit.sql before running this seed.");
    }
    throw platformError;
  }

  console.log(`Dr. Amr Naiem is ready as platform superadmin: ${adminEmail}`);
  console.log(`Organization: ${organization.name} (${organization.id})`);
}

main().catch((error) => {
  console.error("Dr. Amr admin seed failed:", error.message || error);
  process.exit(1);
});
