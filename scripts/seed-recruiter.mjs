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
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCOUNT = {
  email: "recruiter@tatwir.sa",
  password: "recruiter12345678",
  fullName: "HR Recruiter",
  title: "HR Recruiter",
  role: "hr_recruitment",
};

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
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
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
    console.log(`  Auth user updated: ${email}`);
    return data.user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  console.log(`  Auth user created: ${email}`);
  return data.user;
}

async function main() {
  console.log("\n=== Seed Recruitment Account ===\n");

  const organization = await getOrganization();
  console.log(`  Organization: ${organization.name || organization.slug} (${organization.id})`);

  const authUser = await upsertAuthUser(ACCOUNT);

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      user_id: authUser.id,
      org_id: organization.id,
      full_name: ACCOUNT.fullName,
      email: ACCOUNT.email,
      title: ACCOUNT.title,
      account_status: "active",
    },
    { onConflict: "user_id" }
  );
  if (profileError) throw profileError;
  console.log("  Profile upserted.");

  const { error: memberError } = await supabase.from("org_members").upsert(
    {
      org_id: organization.id,
      user_id: authUser.id,
      role: ACCOUNT.role,
    },
    { onConflict: "org_id,user_id" }
  );
  if (memberError) throw memberError;
  console.log("  Org member upserted.");

  console.log("\n=== Done ===\n");
  console.log(`  Email:    ${ACCOUNT.email}`);
  console.log(`  Password: ${ACCOUNT.password}`);
  console.log(`  Role:     ${ACCOUNT.role}`);
  console.log(`  Org:      ${organization.name || organization.slug}`);
}

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
