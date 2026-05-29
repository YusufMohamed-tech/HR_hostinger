import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

const orgId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const employeeRecordId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";

// Passwords are read from env vars. If absent, a secure random password is generated
// and printed once to stdout so you can store it safely.
const hrPassword = process.env.DEMO_HR_PASSWORD || crypto.randomBytes(16).toString("hex");
const employeePassword = process.env.DEMO_EMPLOYEE_PASSWORD || crypto.randomBytes(16).toString("hex");

console.log("\n=== Demo user passwords (store these securely) ===");
if (!process.env.DEMO_HR_PASSWORD) console.log(`DEMO_HR_PASSWORD=${hrPassword}`);
if (!process.env.DEMO_EMPLOYEE_PASSWORD) console.log(`DEMO_EMPLOYEE_PASSWORD=${employeePassword}`);
console.log("===================================================\n");

const demoUsers = [
  {
    email: "hr@tatwir.sa",
    password: hrPassword,
    fullName: "HR Admin",
    title: "HR Manager",
    role: "admin",
  },
  {
    email: "employee@tatwir.sa",
    password: employeePassword,
    fullName: "Test Employee",
    title: "Software Engineer",
    role: "employee",
    employeeId: employeeRecordId,
  },
];

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
  const { error: orgError } = await supabase
    .from("organizations")
    .upsert({ id: orgId, name: "Tatwir Demo Org", slug: "tatwir-demo" }, { onConflict: "id" });
  if (orgError) throw orgError;

  for (const demoUser of demoUsers) {
    const authUser = await upsertAuthUser(demoUser);

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: authUser.id,
        org_id: orgId,
        full_name: demoUser.fullName,
        email: demoUser.email,
        title: demoUser.title,
      },
      { onConflict: "user_id" }
    );
    if (profileError) throw profileError;

    const { error: memberError } = await supabase.from("org_members").upsert(
      {
        org_id: orgId,
        user_id: authUser.id,
        role: demoUser.role,
      },
      { onConflict: "org_id,user_id" }
    );
    if (memberError) throw memberError;

    if (demoUser.employeeId) {
      const { error: employeeError } = await supabase.from("employees").upsert(
        {
          id: demoUser.employeeId,
          org_id: orgId,
          user_id: authUser.id,
          full_name: demoUser.fullName,
          email: demoUser.email,
          job_title: demoUser.title,
        },
        { onConflict: "id" }
      );
      if (employeeError) throw employeeError;
    }

    console.log(`Seeded ${demoUser.email}`);
  }

  console.log("Demo users are ready.");
}

main().catch((error) => {
  console.error("Demo user seed failed:", error);
  process.exit(1);
});
