import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
const adminName = process.env.INITIAL_ADMIN_NAME || "HR Admin";
const orgName = process.env.INITIAL_ORG_NAME || "Tatwir Talent";
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const orgId = process.env.INITIAL_ORG_ID || crypto.randomUUID();

if (!supabaseUrl || !serviceRoleKey || !adminEmail || !adminPassword) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INITIAL_ADMIN_EMAIL, or INITIAL_ADMIN_PASSWORD."
  );
  process.exit(1);
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

async function upsertAdminUser() {
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

async function main() {
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .upsert({ id: orgId, name: orgName, slug: orgSlug, status: "Active" }, { onConflict: "id" })
    .select()
    .single();
  if (orgError) throw orgError;

  const admin = await upsertAdminUser();

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      user_id: admin.id,
      org_id: organization.id,
      full_name: adminName,
      email: adminEmail,
      title: "HR Manager",
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

  console.log(`Initial admin ready for ${adminEmail} in ${orgName}.`);
}

main().catch((error) => {
  console.error("Initial admin seed failed:", error.message);
  process.exit(1);
});
