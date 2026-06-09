import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const targetCount = Number(process.env.SEED_SALES_COUNT || 200);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const telecomCompanies = [
  { name: "stc", slug: "stc", code: "STC", brand_color: "#4f008c" },
  { name: "Mobily", slug: "mobily", code: "MOBILY", brand_color: "#00a651" },
  { name: "Zain KSA", slug: "zain", code: "ZAIN", brand_color: "#8cc63f" },
  { name: "Salam", slug: "salam", code: "SALAM", brand_color: "#00a3e0" },
  { name: "Virgin Mobile KSA", slug: "virgin-mobile", code: "VIRGIN", brand_color: "#e10a17" },
  { name: "Lebara KSA", slug: "lebara", code: "LEBARA", brand_color: "#f58220" },
  { name: "Red Bull MOBILE", slug: "red-bull-mobile", code: "RBM", brand_color: "#1b2a57" },
];

const productTemplates = [
  { name: "باقة إنترنت 5GB", category: "إنترنت", unit: "باقة", price: 35, description: "باقة بيانات شهرية خفيفة" },
  { name: "باقة إنترنت 10GB", category: "إنترنت", unit: "باقة", price: 55, description: "باقة بيانات شهرية متوسطة" },
  { name: "باقة إنترنت 20GB", category: "إنترنت", unit: "باقة", price: 85, description: "باقة بيانات شهرية قوية" },
  { name: "باقة إنترنت 50GB", category: "إنترنت", unit: "باقة", price: 140, description: "باقة بيانات شهرية عالية" },
  { name: "باقة إنترنت لا محدود", category: "إنترنت", unit: "باقة", price: 220, description: "باقة بيانات مفتوحة" },
  { name: "شريحة مسبقة الدفع", category: "شرائح", unit: "شريحة", price: 30, description: "شريحة جديدة مسبقة الدفع" },
  { name: "شريحة مفوتر", category: "شرائح", unit: "شريحة", price: 50, description: "شريحة مفوتر جديدة" },
  { name: "رقم مميز فضي", category: "أرقام مميزة", unit: "رقم", price: 250, description: "رقم مميز فئة فضية" },
  { name: "رقم مميز ذهبي", category: "أرقام مميزة", unit: "رقم", price: 750, description: "رقم مميز فئة ذهبية" },
  { name: "رقم مميز بلاتيني", category: "أرقام مميزة", unit: "رقم", price: 1500, description: "رقم مميز فئة بلاتينية" },
  { name: "باقة مكالمات محلية", category: "مكالمات", unit: "باقة", price: 45, description: "دقائق محلية شهرية" },
  { name: "باقة مكالمات دولية", category: "مكالمات", unit: "باقة", price: 90, description: "دقائق دولية شهرية" },
  { name: "إضافة دقائق", category: "إضافات", unit: "إضافة", price: 25, description: "إضافة دقائق للحساب" },
  { name: "إضافة بيانات 2GB", category: "إضافات", unit: "إضافة", price: 18, description: "إضافة بيانات سريعة" },
  { name: "إضافة بيانات 5GB", category: "إضافات", unit: "إضافة", price: 35, description: "إضافة بيانات شهرية" },
  { name: "راوتر منزلي", category: "أجهزة", unit: "جهاز", price: 299, description: "راوتر منزلي للإنترنت" },
  { name: "جهاز ماي فاي", category: "أجهزة", unit: "جهاز", price: 199, description: "جهاز إنترنت متنقل" },
  { name: "باقة أعمال صغيرة", category: "أعمال", unit: "باقة", price: 180, description: "باقة للشركات الصغيرة" },
  { name: "باقة أعمال متقدمة", category: "أعمال", unit: "باقة", price: 350, description: "باقة للشركات المتوسطة" },
  { name: "خدمة نقل الرقم", category: "خدمات", unit: "طلب", price: 0, description: "طلب نقل رقم من مشغل آخر" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

function phoneFor(index) {
  return `+9665${String(72000000 + index).padStart(8, "0")}`;
}

function nationalIdFor(index) {
  return `1${String(300000000 + index).slice(-9)}`;
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

async function ensureSalesCompanies(orgId) {
  for (const company of telecomCompanies) {
    const { error } = await supabase
      .from("sales_companies")
      .upsert(
        {
          organization_id: orgId,
          name: company.name,
          slug: company.slug,
          code: company.code,
          brand_color: company.brand_color,
          is_active: true,
        },
        { onConflict: "organization_id,slug" }
      );
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("sales_companies")
    .select("id, name, slug, code, brand_color")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  if (!data?.length) throw new Error("No active sales companies found.");
  return data;
}

async function seedProducts(orgId, companies) {
  for (const company of companies) {
    const { data: existingProducts, error: loadError } = await supabase
      .from("sales_products")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("company_id", company.id);
    if (loadError) throw loadError;

    const existingByName = new Map((existingProducts || []).map((product) => [product.name, product.id]));
    const desiredNames = new Set(productTemplates.map((template) => `${company.name} ${template.name}`));

    for (const template of productTemplates) {
      const name = `${company.name} ${template.name}`;
      const productValues = {
        organization_id: orgId,
        company_id: company.id,
        name,
        description: template.description,
        unit: template.unit,
        category: template.category,
        price: template.price,
        is_active: true,
      };

      const existingId = existingByName.get(name);
      const result = existingId
        ? await supabase.from("sales_products").update(productValues).eq("id", existingId)
        : await supabase.from("sales_products").insert(productValues);
      if (result.error) throw result.error;
    }

    const extraProductIds = (existingProducts || [])
      .filter((product) => !desiredNames.has(product.name))
      .map((product) => product.id);
    for (const extraChunk of chunk(extraProductIds, 100)) {
      const { error } = await supabase
        .from("sales_products")
        .update({ is_active: false })
        .eq("organization_id", orgId)
        .eq("company_id", company.id)
        .in("id", extraChunk);
      if (error) throw error;
    }

    console.log(`Seeded ${productTemplates.length} products for ${company.name}`);
  }
}

async function main() {
  const organization = await getOrganization();
  const companies = await ensureSalesCompanies(organization.id);
  await seedProducts(organization.id, companies);

  const [{ data: departments }, { data: locations }, usersByEmail] = await Promise.all([
    supabase.from("departments").select("id, name").eq("org_id", organization.id).order("name"),
    supabase.from("locations").select("id, name").eq("org_id", organization.id).order("name"),
    loadAuthUsersByEmail(),
  ]);

  const salesDepartment =
    (departments || []).find((department) => String(department.name || "").toLowerCase().includes("sales")) ||
    (departments || [])[0] ||
    null;

  const seededUsers = [];

  for (let index = 1; index <= targetCount; index += 1) {
    const code = `t${index}`;
    const email = `${code}@tatwir.sa`;
    const password = `${code}@12345678`;
    const fullName = `Sales Agent ${code.toUpperCase()}`;
    const authUser = await upsertAuthUser({ email, password, fullName }, usersByEmail);
    const assignedCompany = companies[(index - 1) % companies.length];
    const location = locations?.length ? locations[(index - 1) % locations.length] : null;

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: authUser.id,
        org_id: organization.id,
        full_name: fullName,
        email,
        phone: phoneFor(index),
        title: "Sales Agent",
        account_status: "active",
      },
      { onConflict: "user_id" }
    );
    if (profileError) throw profileError;

    const { error: memberError } = await supabase.from("org_members").upsert(
      {
        org_id: organization.id,
        user_id: authUser.id,
        role: "sales",
      },
      { onConflict: "org_id,user_id" }
    );
    if (memberError) throw memberError;

    const { error: employeeError } = await supabase.from("employees").upsert(
      {
        org_id: organization.id,
        user_id: authUser.id,
        employee_code: `SALES-T${String(index).padStart(3, "0")}`,
        full_name: fullName,
        email,
        phone: phoneFor(index),
        national_id: nationalIdFor(index),
        job_title: "Sales Agent",
        department_id: salesDepartment?.id || null,
        location_id: location?.id || null,
        status: "Active",
      },
      { onConflict: "org_id,employee_code" }
    );
    if (employeeError) throw employeeError;

    seededUsers.push({ userId: authUser.id, companyId: assignedCompany.id, code, email, password });

    if (index % 25 === 0 || index === targetCount) {
      console.log(`Prepared ${index}/${targetCount} sales agents`);
    }
  }

  for (const userChunk of chunk(seededUsers, 50)) {
    const { error } = await supabase
      .from("sales_company_assignments")
      .update({ is_active: false, end_date: todayIso(), notes: "Replaced by sales mock seed" })
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .in("user_id", userChunk.map((user) => user.userId));
    if (error) throw error;
  }

  for (const assignmentChunk of chunk(seededUsers, 100)) {
    const { error } = await supabase.from("sales_company_assignments").insert(
      assignmentChunk.map((user) => ({
        organization_id: organization.id,
        company_id: user.companyId,
        user_id: user.userId,
        assignment_role: "sales",
        start_date: todayIso(),
        is_active: true,
        notes: `Mock sales assignment for ${user.code}`,
      }))
    );
    if (error) throw error;
  }

  console.log(`Seeded ${seededUsers.length} sales agents in ${organization.name || organization.id}.`);
  console.log("Example login: t1@tatwir.sa / t1@12345678");
}

main().catch((error) => {
  console.error("Sales mock seed failed:", error.message);
  process.exit(1);
});
