import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { coordinatesForLocation, hasCoordinates } from "./location-coordinate-utils.mjs";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const historyStart = process.env.SEED_SALES_HISTORY_FROM || "2026-01-01";
const historyEnd = process.env.SEED_SALES_HISTORY_TO || new Date().toISOString().slice(0, 10);
const dailyAgentCount = Number(process.env.SEED_SALES_DAILY_AGENT_COUNT || 50);
const dailySalesBaseline = Number(process.env.SEED_SALES_DAILY_BASELINE || 318000);
const dailySalesMin = Number(process.env.SEED_SALES_DAILY_MIN || 292000);
const dailySalesMax = Number(process.env.SEED_SALES_DAILY_MAX || 336000);
const historySeedPrefix = "Historical mock sales seed 2026";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sourcePath = path.resolve(process.cwd(), "scripts", "sales-locations-2026.json");
const locationPayload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const companyManagerAccounts = [
  { slug: "stc", email: "sales.manager.stc@tatwir.sa", password: "stc@12345678", name: "STC Sales Manager", phone: "+966580001001", code: "STC" },
  { slug: "mobily", email: "sales.manager.mobily@tatwir.sa", password: "mobily@12345678", name: "Mobily Sales Manager", phone: "+966580001002", code: "MOBILY" },
  { slug: "zain", email: "sales.manager.zain@tatwir.sa", password: "zain@12345678", name: "Zain Sales Manager", phone: "+966580001003", code: "ZAIN" },
  { slug: "salam", email: "sales.manager.salam@tatwir.sa", password: "salam@12345678", name: "Salam Sales Manager", phone: "+966580001004", code: "SALAM" },
  { slug: "virgin-mobile", email: "sales.manager.virgin@tatwir.sa", password: "virgin@12345678", name: "Virgin Mobile Sales Manager", phone: "+966580001005", code: "VIRGIN" },
  { slug: "lebara", email: "sales.manager.lebara@tatwir.sa", password: "lebara@12345678", name: "Lebara Sales Manager", phone: "+966580001006", code: "LEBARA" },
  { slug: "red-bull-mobile", email: "sales.manager.redbull@tatwir.sa", password: "redbull@12345678", name: "Red Bull MOBILE Sales Manager", phone: "+966580001007", code: "RBM" },
];

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

function monthKey(date) {
  return date.slice(0, 7);
}

function dateRange(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function createRng(seed = 20260610) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dailySalesTarget(date, dayIndex, rng) {
  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const weeklySignal = Math.sin(dayIndex / 3.7) * 0.55 + Math.cos(dayIndex / 6.4) * 0.35;
  const weekdaySignal = dayOfWeek === 5 || dayOfWeek === 6 ? -0.28 : dayOfWeek === 4 ? 0.12 : 0.04;
  const jitterSignal = (rng() - 0.5) * 0.5;
  const value = dailySalesBaseline + 18000 * (weeklySignal + weekdaySignal + jitterSignal);
  return money(clamp(value, dailySalesMin, dailySalesMax));
}

function phoneForManager(index) {
  return `+96658${String(1000000 + index).padStart(7, "0")}`;
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

async function ensureDepartment(orgId, name) {
  const { data: existingRows, error: loadError } = await supabase
    .from("departments")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("name", name)
    .limit(1);
  if (loadError) throw loadError;
  if (existingRows?.[0]) return existingRows[0];

  const { data, error } = await supabase
    .from("departments")
    .insert({ org_id: orgId, name })
    .select("id, name")
    .single();
  if (error) throw error;
  return data;
}

async function loadCompanies(orgId) {
  const { data, error } = await supabase
    .from("sales_companies")
    .select("id, name, slug, code, brand_color")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  if (!data?.length) throw new Error("No active sales companies found. Run npm run seed:sales-mock first.");
  return data;
}

async function ensureLocations(orgId) {
  const { data: existingRows, error: loadError } = await supabase
    .from("locations")
    .select("id, name, latitude, longitude")
    .eq("org_id", orgId);
  if (loadError) throw loadError;
  const existingByName = new Map((existingRows || []).map((location) => [location.name, location]));
  const seeded = [];

  for (const item of locationPayload.locations) {
    const existingLocation = existingByName.get(item.name);
    const coordinates = hasCoordinates(existingLocation) ? null : coordinatesForLocation(item);
    const values = {
      org_id: orgId,
      name: item.name,
      type: "branch",
      radius_meters: Number(item.radius_meters || 100),
    };
    if (coordinates) {
      values.latitude = coordinates.latitude;
      values.longitude = coordinates.longitude;
    }
    const existingId = existingLocation?.id;
    const result = existingId
      ? await supabase.from("locations").update(values).eq("id", existingId).select("id, name").single()
      : await supabase.from("locations").insert(values).select("id, name").single();
    if (result.error) throw result.error;
    seeded.push({ ...item, id: result.data.id });
    existingByName.set(item.name, { id: result.data.id, ...values });
  }

  return seeded;
}

async function ensureCompanyManagers(orgId, companies, salesDepartmentId, locationsByCompany) {
  const usersByEmail = await loadAuthUsersByEmail();
  const companiesBySlug = new Map(companies.map((company) => [company.slug, company]));
  const managersByCompanyId = new Map();
  let index = 0;

  for (const account of companyManagerAccounts) {
    const company = companiesBySlug.get(account.slug);
    if (!company) continue;
    index += 1;
    const authUser = await upsertAuthUser({ email: account.email, password: account.password, fullName: account.name }, usersByEmail);
    const location = (locationsByCompany.get(account.slug) || [])[0] || null;

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: authUser.id,
        org_id: orgId,
        full_name: account.name,
        email: account.email,
        phone: account.phone || phoneForManager(index),
        title: `${company.name} Sales Manager`,
        account_status: "active",
      },
      { onConflict: "user_id" }
    );
    if (profileError) throw profileError;

    const { error: memberError } = await supabase.from("org_members").upsert(
      {
        org_id: orgId,
        user_id: authUser.id,
        role: "sales_manager",
      },
      { onConflict: "org_id,user_id" }
    );
    if (memberError) throw memberError;

    const { data: employee, error: employeeError } = await supabase.from("employees").upsert(
      {
        org_id: orgId,
        user_id: authUser.id,
        employee_code: `SALES-MGR-${account.code}`,
        full_name: account.name,
        email: account.email,
        phone: account.phone || phoneForManager(index),
        job_title: `${company.name} Sales Manager`,
        department_id: salesDepartmentId,
        location_id: location?.id || null,
        city: location?.city || null,
        province: location?.region || null,
        status: "Active",
      },
      { onConflict: "org_id,employee_code" }
    ).select("id").single();
    if (employeeError) throw employeeError;

    await deactivateExtraAssignments(orgId, authUser.id, "manager", null);
    const { error: assignmentError } = await supabase.from("sales_company_assignments").insert({
      organization_id: orgId,
      company_id: company.id,
      user_id: authUser.id,
      assignment_role: "manager",
      start_date: historyStart,
      is_active: true,
      notes: `Operations seed manager for ${company.name}`,
    });
    if (assignmentError) throw assignmentError;

    managersByCompanyId.set(company.id, authUser.id);

    if (location?.id && employee?.id) {
      await upsertEmployeeLocation(employee.id, location.id, historyStart);
    }
  }

  return managersByCompanyId;
}

async function deactivateExtraAssignments(orgId, userId, role, keepAssignmentId) {
  const { data, error } = await supabase
    .from("sales_company_assignments")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("assignment_role", role)
    .eq("is_active", true);
  if (error) throw error;

  const ids = (data || []).map((assignment) => assignment.id).filter((id) => id !== keepAssignmentId);
  if (!ids.length) return;
  const { error: updateError } = await supabase
    .from("sales_company_assignments")
    .update({ is_active: false, end_date: historyEnd, notes: "Replaced by sales operations seed" })
    .in("id", ids);
  if (updateError) throw updateError;
}

async function upsertEmployeeLocation(employeeId, locationId, assignedFrom) {
  const { error: clearError } = await supabase
    .from("employee_locations")
    .update({ is_primary: false, assigned_to: historyEnd })
    .eq("employee_id", employeeId)
    .eq("is_primary", true);
  if (clearError) throw clearError;

  const { error } = await supabase.from("employee_locations").upsert(
    {
      employee_id: employeeId,
      location_id: locationId,
      is_primary: true,
      assigned_from: assignedFrom,
      assigned_to: null,
    },
    { onConflict: "employee_id,location_id" }
  );
  if (error) throw error;
}

async function assignSalesEmployees(orgId, companies, salesDepartmentId, locationsByCompany) {
  const { data: employees, error: employeesError } = await supabase
    .from("employees")
    .select("id, user_id, employee_code, full_name, email")
    .eq("org_id", orgId)
    .like("employee_code", "SALES-T%")
    .order("employee_code", { ascending: true });
  if (employeesError) throw employeesError;

  const userIds = (employees || []).map((employee) => employee.user_id).filter(Boolean);
  if (!userIds.length) throw new Error("No sales employees found. Run npm run seed:sales-mock first.");

  const { data: assignments, error: assignmentsError } = await supabase
    .from("sales_company_assignments")
    .select("id, user_id, company_id, assignment_role, start_date, end_date, is_active")
    .eq("organization_id", orgId)
    .eq("assignment_role", "sales")
    .eq("is_active", true)
    .in("user_id", userIds);
  if (assignmentsError) throw assignmentsError;

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const assignmentsByUser = new Map();
  for (const assignment of assignments || []) {
    const list = assignmentsByUser.get(assignment.user_id) || [];
    list.push(assignment);
    assignmentsByUser.set(assignment.user_id, list);
  }

  const salesAgents = [];
  let fallbackIndex = 0;
  for (const employee of employees || []) {
    let activeAssignments = assignmentsByUser.get(employee.user_id) || [];
    if (!activeAssignments.length) {
      const company = companies[fallbackIndex % companies.length];
      fallbackIndex += 1;
      const { data: inserted, error: insertError } = await supabase.from("sales_company_assignments").insert({
        organization_id: orgId,
        company_id: company.id,
        user_id: employee.user_id,
        assignment_role: "sales",
        start_date: historyStart,
        is_active: true,
        notes: "Created by sales operations seed",
      }).select("id, user_id, company_id, assignment_role, start_date, end_date, is_active").single();
      if (insertError) throw insertError;
      activeAssignments = [inserted];
    }

    const keptAssignment = activeAssignments[0];
    await deactivateExtraAssignments(orgId, employee.user_id, "sales", keptAssignment.id);

    const company = companyById.get(keptAssignment.company_id) || companies[fallbackIndex % companies.length];
    const companyLocations = locationsByCompany.get(company.slug) || [];
    const location = (companyLocations.length ? companyLocations : Array.from(locationsByCompany.values()).flat())[salesAgents.length % Math.max(1, companyLocations.length || Array.from(locationsByCompany.values()).flat().length)] || null;

    if (location) {
      const { error: employeeUpdateError } = await supabase
        .from("employees")
        .update({
          department_id: salesDepartmentId,
          location_id: location.id,
          city: location.city || null,
          province: location.region || null,
          job_title: "Sales Agent",
        })
        .eq("id", employee.id);
      if (employeeUpdateError) throw employeeUpdateError;

      await upsertEmployeeLocation(employee.id, location.id, historyStart);
    } else {
      const { error: employeeUpdateError } = await supabase
        .from("employees")
        .update({ department_id: salesDepartmentId, job_title: "Sales Agent" })
        .eq("id", employee.id);
      if (employeeUpdateError) throw employeeUpdateError;
    }

    salesAgents.push({
      employeeId: employee.id,
      userId: employee.user_id,
      companyId: company.id,
      companySlug: company.slug,
      locationId: location?.id || null,
      locationName: location?.name || "",
      city: location?.city || "",
      region: location?.region || "",
    });
  }

  return salesAgents;
}

async function loadProductsByCompany(orgId) {
  const { data, error } = await supabase
    .from("sales_products")
    .select("id, company_id, name, price, category, unit, is_active")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .gt("price", 0)
    .order("price", { ascending: false });
  if (error) throw error;

  const productsByCompany = new Map();
  for (const product of data || []) {
    const list = productsByCompany.get(product.company_id) || [];
    list.push(product);
    productsByCompany.set(product.company_id, list);
  }
  return productsByCompany;
}

function makeLine(product, targetAmount) {
  const unitPrice = Number(product.price || 0);
  const quantity = Math.max(1, Math.ceil(targetAmount / unitPrice));
  const gross = money(quantity * unitPrice);
  const lineTotal = money(targetAmount);
  const discountAmount = money(Math.max(0, gross - lineTotal));
  const discountPercent = gross > 0 ? money((discountAmount / gross) * 100) : 0;
  return {
    product_id: product.id,
    product_name: product.name,
    quantity,
    unit_price: unitPrice,
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    line_total: lineTotal,
  };
}

function makeItems(products, amount, rng) {
  const available = products.filter((product) => Number(product.price || 0) > 0);
  if (!available.length) throw new Error("No active paid products found for a sales company.");
  const itemCount = amount >= 2800 && available.length > 1 ? 2 : 1;
  if (itemCount === 1) {
    const product = available[Math.floor(rng() * available.length)];
    return [makeLine(product, amount)];
  }

  const firstAmount = money(amount * (0.55 + rng() * 0.25));
  const secondAmount = money(amount - firstAmount);
  const firstProduct = available[Math.floor(rng() * available.length)];
  let secondProduct = available[Math.floor(rng() * available.length)];
  if (secondProduct.id === firstProduct.id) secondProduct = available[(available.indexOf(firstProduct) + 1) % available.length];
  return [makeLine(firstProduct, firstAmount), makeLine(secondProduct, secondAmount)];
}

async function seedHistoricalSales(orgId, salesAgents, productsByCompany, managersByCompanyId) {
  const { error: deleteError } = await supabase
    .from("sales_logs")
    .delete()
    .eq("organization_id", orgId)
    .like("notes", `${historySeedPrefix}%`);
  if (deleteError) throw deleteError;

  const rng = createRng();
  const rows = [];
  const dates = dateRange(historyStart, historyEnd);

  for (const [dayIndex, date] of dates.entries()) {
    const target = dailySalesTarget(date, dayIndex, rng);
    const entries = [];
    const count = Math.min(dailyAgentCount, salesAgents.length);
    const startIndex = (dayIndex * 13) % salesAgents.length;
    for (let offset = 0; offset < count; offset += 1) {
      const agent = salesAgents[(startIndex + offset) % salesAgents.length];
      if ((productsByCompany.get(agent.companyId) || []).length) {
        entries.push({ date, agent, weight: 0.65 + rng() * 0.9 });
      }
    }

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let remaining = money(target);
    entries.forEach((entry, index) => {
      const amount = index === entries.length - 1
        ? remaining
        : money(Math.max(250, target * entry.weight / totalWeight));
      remaining = money(remaining - amount);
      const products = productsByCompany.get(entry.agent.companyId) || [];
      const items = makeItems(products, amount, rng);
      const subtotal = money(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
      const totalDiscount = money(items.reduce((sum, item) => sum + item.discount_amount, 0));
      const grandTotal = money(items.reduce((sum, item) => sum + item.line_total, 0));
      const createdHour = 10 + Math.floor(rng() * 10);
      const createdMinute = Math.floor(rng() * 60);
      rows.push({
        organization_id: orgId,
        company_id: entry.agent.companyId,
        sales_agent_id: entry.agent.userId,
        log_date: entry.date,
        items,
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
        notes: `${historySeedPrefix} | ${entry.agent.locationName || entry.agent.city || entry.agent.region || "Sales site"}`,
        status: "reviewed",
        reviewed_by: managersByCompanyId.get(entry.agent.companyId) || null,
        reviewed_at: `${entry.date}T${String(createdHour + 1).padStart(2, "0")}:${String(createdMinute).padStart(2, "0")}:00.000Z`,
        created_at: `${entry.date}T${String(createdHour).padStart(2, "0")}:${String(createdMinute).padStart(2, "0")}:00.000Z`,
      });
    });
  }

  for (const rowChunk of chunk(rows, 500)) {
    const { error } = await supabase.from("sales_logs").insert(rowChunk);
    if (error) throw error;
  }

  return rows.length;
}

async function verifyMonthlyTotals(orgId) {
  const data = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .from("sales_logs")
      .select("log_date, grand_total")
      .eq("organization_id", orgId)
      .like("notes", `${historySeedPrefix}%`)
      .gte("log_date", historyStart)
      .lte("log_date", historyEnd)
      .order("log_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    data.push(...(page || []));
    if (!page || page.length < pageSize) break;
    from += pageSize;
  }

  const totals = new Map();
  for (const row of data || []) {
    const key = monthKey(row.log_date);
    totals.set(key, money((totals.get(key) || 0) + Number(row.grand_total || 0)));
  }
  return Array.from(totals.entries()).sort(([a], [b]) => a.localeCompare(b));
}

async function main() {
  const organization = await getOrganization();
  const [salesDepartment, accountingDepartment, companies] = await Promise.all([
    ensureDepartment(organization.id, "Sales"),
    ensureDepartment(organization.id, "Accounting"),
    loadCompanies(organization.id),
  ]);

  const locations = await ensureLocations(organization.id);
  const locationsByCompany = new Map();
  for (const location of locations) {
    const list = locationsByCompany.get(location.company_slug) || [];
    list.push(location);
    locationsByCompany.set(location.company_slug, list);
  }

  const managersByCompanyId = await ensureCompanyManagers(organization.id, companies, salesDepartment.id, locationsByCompany);
  const salesAgents = await assignSalesEmployees(organization.id, companies, salesDepartment.id, locationsByCompany);
  const productsByCompany = await loadProductsByCompany(organization.id);
  const logCount = await seedHistoricalSales(organization.id, salesAgents, productsByCompany, managersByCompanyId);
  const totals = await verifyMonthlyTotals(organization.id);

  console.log(`Organization: ${organization.name || organization.id}`);
  console.log(`Departments ready: ${salesDepartment.name}, ${accountingDepartment.name}`);
  console.log(`Imported/updated locations: ${locations.length} from ${locationPayload.source_file}`);
  console.log(`Sales agents assigned to locations: ${salesAgents.length}`);
  console.log(`Generated historical sales logs: ${logCount}`);
  console.log("Monthly generated totals:");
  totals.forEach(([key, total]) => console.log(`- ${key}: ${Math.round(total).toLocaleString("en-US")} SAR`));
  console.log("Company manager examples:");
  companyManagerAccounts.slice(0, 3).forEach((account) => console.log(`- ${account.email} / ${account.password}`));
}

main().catch((error) => {
  console.error("Sales operations seed failed:", error.message);
  process.exit(1);
});
