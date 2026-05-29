import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Passwords must be provided via environment variables.
// Never commit passwords to source code.
const superadminPassword = process.env.PROD_SUPERADMIN_PASSWORD;
const hrPassword = process.env.PROD_HR_PASSWORD;
const recruiterPassword = process.env.PROD_RECRUITER_PASSWORD;

const missingVars = [
  !superadminPassword && "PROD_SUPERADMIN_PASSWORD",
  !hrPassword && "PROD_HR_PASSWORD",
  !recruiterPassword && "PROD_RECRUITER_PASSWORD",
].filter(Boolean);

if (missingVars.length > 0) {
  console.error(`Missing required environment variables: ${missingVars.join(", ")}`);
  console.error("Set these in .env.local before running this seed script.");
  console.error("You can generate secure passwords with: node -e \"require('crypto').randomBytes(20).toString('hex')\"");
  process.exit(1);
}

const platformUsers = [
  {
    email: "superadmin@tatwir.sa",
    password: superadminPassword,
    fullName: "Super Admin",
    title: "Superadmin",
    role: "superadmin",
  },
];

const organizationUsers = [
  {
    email: "hr@tatwir.sa",
    password: hrPassword,
    fullName: "HR",
    title: "HR Admin",
    role: "hr_admin",
  },
  {
    email: "recruiter@tatwir.sa",
    password: recruiterPassword,
    fullName: "HR Recruiter",
    title: "HR Recruiter",
    role: "hr_recruitment",
  },
];

async function getOrganization() {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const fallback = await supabase
    .from("organizations")
    .select("id, slug, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data) throw new Error("No organization found.");
  return fallback.data;
}

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

async function upsertAuthUser({ email, password, fullName }) {
  const existing = await getAuthUserByEmail(email);

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user;
}

async function main() {
  const organization = await getOrganization();

  for (const account of platformUsers) {
    const authUser = await upsertAuthUser(account);

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: authUser.id,
        org_id: null,
        full_name: account.fullName,
        email: account.email,
        title: account.title,
        account_status: "active",
      },
      { onConflict: "user_id" }
    );
    if (profileError) throw profileError;

    const { error: platformError } = await supabase.from("platform_admins").upsert(
      {
        user_id: authUser.id,
        role: account.role,
        status: "active",
      },
      { onConflict: "user_id" }
    );
    if (platformError) throw platformError;

    console.log(`Ready: ${account.email} (${account.role})`);
  }

  for (const account of organizationUsers) {
    const authUser = await upsertAuthUser(account);

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: authUser.id,
        org_id: organization.id,
        full_name: account.fullName,
        email: account.email,
        title: account.title,
        account_status: "active",
      },
      { onConflict: "user_id" }
    );
    if (profileError) throw profileError;

    const { error: memberError } = await supabase.from("org_members").upsert(
      {
        org_id: organization.id,
        user_id: authUser.id,
        role: account.role,
      },
      { onConflict: "org_id,user_id" }
    );
    if (memberError) throw memberError;

    console.log(`Ready: ${account.email} (${account.role})`);
  }

  console.log(`Production users seeded in ${organization.name || organization.id}.`);
}

main().catch((error) => {
  console.error("Production user seed failed:", error.message);
  process.exit(1);
});
