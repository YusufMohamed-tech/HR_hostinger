import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const targetCount = Number(process.env.SEED_EMPLOYEE_COUNT || 200);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const firstNames = [
  { slug: "ahmed", ar: "أحمد" },
  { slug: "mohammed", ar: "محمد" },
  { slug: "abdullah", ar: "عبدالله" },
  { slug: "abdulaziz", ar: "عبدالعزيز" },
  { slug: "salman", ar: "سلمان" },
  { slug: "faisal", ar: "فيصل" },
  { slug: "nasser", ar: "ناصر" },
  { slug: "saud", ar: "سعود" },
  { slug: "sultan", ar: "سلطان" },
  { slug: "khalid", ar: "خالد" },
  { slug: "rakan", ar: "راكان" },
  { slug: "turki", ar: "تركي" },
  { slug: "bandar", ar: "بندر" },
  { slug: "mishaal", ar: "مشعل" },
  { slug: "fahad", ar: "فهد" },
  { slug: "talal", ar: "طلال" },
  { slug: "saad", ar: "سعد" },
  { slug: "omar", ar: "عمر" },
  { slug: "youssef", ar: "يوسف" },
  { slug: "ibrahim", ar: "إبراهيم" },
  { slug: "walid", ar: "وليد" },
  { slug: "ziyad", ar: "زياد" },
  { slug: "bader", ar: "بدر" },
  { slug: "ayman", ar: "أيمن" },
  { slug: "anas", ar: "أنس" },
  { slug: "hani", ar: "هاني" },
  { slug: "haitham", ar: "هيثم" },
  { slug: "mazen", ar: "مازن" },
  { slug: "muath", ar: "معاذ" },
  { slug: "abdulrahman", ar: "عبدالرحمن" },
  { slug: "nabil", ar: "نبيل" },
  { slug: "rami", ar: "رامي" },
  { slug: "samer", ar: "سامر" },
  { slug: "tariq", ar: "طارق" },
  { slug: "salem", ar: "سالم" },
  { slug: "yasir", ar: "ياسر" },
  { slug: "adel", ar: "عادل" },
  { slug: "ali", ar: "علي" },
  { slug: "hamad", ar: "حمد" },
  { slug: "marwan", ar: "مروان" },
];

const familyNames = [
  { slug: "alotaibi", ar: "العتيبي" },
  { slug: "alqahtani", ar: "القحطاني" },
  { slug: "alharbi", ar: "الحربي" },
  { slug: "alghamdi", ar: "الغامدي" },
  { slug: "alzahrani", ar: "الزهراني" },
];

const jobTitles = [
  "Sales Representative",
  "Field Sales Agent",
  "Account Executive",
  "Customer Success Specialist",
  "Operations Coordinator",
  "Office Administrator",
  "Administrative Assistant",
  "Branch Coordinator",
];

function pickRandom(list, index) {
  return list[index % list.length];
}

function phoneFor(index) {
  return `+9665${String(50000000 + index).padStart(8, "0")}`;
}

function nationalIdFor(index) {
  return `1${String(100000000 + index).slice(-9)}`;
}

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

async function loadAuthUsersByEmail() {
  const usersByEmail = new Map();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) usersByEmail.set(user.email.toLowerCase(), user);
    }
    if (data.users.length < perPage) return usersByEmail;
    page += 1;
  }
}

async function upsertAuthUser({ email, password, fullName }, usersByEmail) {
  const existing = usersByEmail.get(email.toLowerCase());
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    usersByEmail.set(email.toLowerCase(), data.user);
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  usersByEmail.set(email.toLowerCase(), data.user);
  return data.user;
}

async function main() {
  const organization = await getOrganization();
  const { data: departments } = await supabase.from("departments").select("id").eq("org_id", organization.id).order("name");
  const { data: locations } = await supabase.from("locations").select("id").eq("org_id", organization.id).order("name");

  const employees = [];
  const emailCounts = new Map();
  let index = 0;

  for (const firstName of firstNames) {
    for (const familyName of familyNames) {
      if (employees.length >= targetCount) break;

      const fullName = `${firstName.ar} ${familyName.ar}`;
      const seenCount = emailCounts.get(firstName.slug) || 0;
      emailCounts.set(firstName.slug, seenCount + 1);
      const slug = seenCount === 0 ? firstName.slug : `${firstName.slug}${seenCount + 1}`;
      employees.push({
        fullName,
        slug,
        email: `${slug}@tatwir.sa`,
        password: `${slug}12345678`,
        phone: phoneFor(index),
        nationalId: nationalIdFor(index),
        jobTitle: pickRandom(jobTitles, index),
        departmentId: departments?.length ? departments[index % departments.length].id : null,
        locationId: locations?.length ? locations[index % locations.length].id : null,
        employeeCode: `SA-${String(index + 1).padStart(3, "0")}`,
      });
      index += 1;
    }
    if (employees.length >= targetCount) break;
  }

  const authUsersByEmail = await loadAuthUsersByEmail();

  for (let currentIndex = 0; currentIndex < employees.length; currentIndex += 1) {
    const employee = employees[currentIndex];
    const authUser = await upsertAuthUser({
      email: employee.email,
      password: employee.password,
      fullName: employee.fullName,
    }, authUsersByEmail);

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: authUser.id,
        org_id: organization.id,
        full_name: employee.fullName,
        email: employee.email,
        phone: employee.phone,
        title: employee.jobTitle,
        account_status: "active",
      },
      { onConflict: "user_id" }
    );
    if (profileError) throw profileError;

    const { error: memberError } = await supabase.from("org_members").upsert(
      {
        org_id: organization.id,
        user_id: authUser.id,
        role: "employee",
      },
      { onConflict: "org_id,user_id" }
    );
    if (memberError) throw memberError;

    const { error: employeeError } = await supabase.from("employees").upsert(
      {
        org_id: organization.id,
        user_id: authUser.id,
        employee_code: employee.employeeCode,
        full_name: employee.fullName,
        email: employee.email,
        phone: employee.phone,
        national_id: employee.nationalId,
        job_title: employee.jobTitle,
        department_id: employee.departmentId,
        location_id: employee.locationId,
        status: "Active",
      },
      { onConflict: "org_id,employee_code" }
    );
    if (employeeError) throw employeeError;

    if ((currentIndex + 1) % 25 === 0 || currentIndex + 1 === employees.length) {
      console.log(`Seeded ${currentIndex + 1}/${employees.length} employees`);
    }
  }

  console.log(`Seeded ${employees.length} Saudi employees in ${organization.name || organization.id}.`);
}

main().catch((error) => {
  console.error("Saudi employee seed failed:", error.message);
  process.exit(1);
});
