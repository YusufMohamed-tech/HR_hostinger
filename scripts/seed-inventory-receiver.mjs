import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.INVENTORY_RECEIVER_EMAIL?.trim().toLowerCase();
const password = process.env.INVENTORY_RECEIVER_PASSWORD;
const fullName = process.env.INVENTORY_RECEIVER_NAME?.trim() || "Inventory Receiver";
const employeeCode = process.env.INVENTORY_RECEIVER_EMPLOYEE_CODE?.trim() || "INV-RECEIVER-001";
const orgSlug = process.env.INITIAL_ORG_SLUG?.trim() || "tatwir-talent";

if (!supabaseUrl || !serviceRoleKey || !email || !password) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "
    + "INVENTORY_RECEIVER_EMAIL, or INVENTORY_RECEIVER_PASSWORD."
  );
  process.exit(1);
}
if (password.length < 12) {
  console.error("INVENTORY_RECEIVER_PASSWORD must contain at least 12 characters.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(error, fallback) {
  if (error) throw new Error(error.message || fallback);
}

async function findAuthUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const result = await supabase.auth.admin.listUsers({ page, perPage });
    fail(result.error, "Unable to list Auth users.");
    const user = result.data.users.find(
      (candidate) => candidate.email?.toLowerCase() === targetEmail
    );
    if (user) return user;
    if (result.data.users.length < perPage) return null;
    page += 1;
  }
}

async function main() {
  const organizationResult = await supabase
    .from("organizations")
    .select("id, name, slug, status")
    .eq("slug", orgSlug)
    .maybeSingle();
  fail(organizationResult.error, "Unable to load the target organization.");
  const organization = organizationResult.data;
  if (!organization) throw new Error(`Organization '${orgSlug}' was not found.`);
  if (String(organization.status).toLowerCase() !== "active") {
    throw new Error(`Organization '${orgSlug}' is not active.`);
  }

  const [departmentResult, locationResult, actorResult] = await Promise.all([
    supabase.from("departments")
      .select("id, name")
      .eq("org_id", organization.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("locations")
      .select("id, name")
      .eq("org_id", organization.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("org_members")
      .select("user_id, role")
      .eq("org_id", organization.id)
      .in("role", ["admin", "hr_admin"])
      .limit(1)
      .maybeSingle(),
  ]);
  fail(departmentResult.error, "Unable to resolve a receiver department.");
  fail(locationResult.error, "Unable to resolve a receiver location.");
  fail(actorResult.error, "Unable to resolve an HR provisioning actor.");
  if (!departmentResult.data || !locationResult.data || !actorResult.data) {
    throw new Error("The organization requires a department, location, and admin/HR actor.");
  }

  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    const membershipResult = await supabase.from("org_members")
      .select("org_id, role")
      .eq("user_id", authUser.id)
      .maybeSingle();
    fail(membershipResult.error, "Unable to inspect the existing Auth membership.");
    if (
      membershipResult.data
      && (
        membershipResult.data.org_id !== organization.id
        || membershipResult.data.role !== "inventory_receiver"
      )
    ) {
      throw new Error("The email already belongs to another organization or role.");
    }
    const updateResult = await supabase.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    fail(updateResult.error, "Unable to update the receiver Auth account.");
    authUser = updateResult.data.user;
  } else {
    const createResult = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    fail(createResult.error, "Unable to create the receiver Auth account.");
    authUser = createResult.data.user;
  }
  if (!authUser) throw new Error("Receiver Auth provisioning returned no user.");

  const employeeResult = await supabase.from("employees")
    .select("id, user_id, lifecycle_status, status")
    .eq("org_id", organization.id)
    .ilike("email", email)
    .maybeSingle();
  fail(employeeResult.error, "Unable to inspect the receiver employee.");
  let employee = employeeResult.data;
  if (employee && ["offboarding", "offboarded", "archived"].includes(employee.lifecycle_status)) {
    throw new Error("The matching employee is offboarded or archived and cannot be reactivated.");
  }
  if (employee?.user_id && employee.user_id !== authUser.id) {
    throw new Error("The matching employee is linked to a different Auth identity.");
  }

  if (!employee) {
    const insertResult = await supabase.from("employees")
      .insert({
        org_id: organization.id,
        employee_code: employeeCode,
        full_name: fullName,
        full_name_en: fullName,
        email,
        hiring_date: new Date().toISOString().slice(0, 10),
        department_id: departmentResult.data.id,
        location_id: locationResult.data.id,
        job_title: "Inventory Receiver",
        employment_type: "full_time",
        status: "Active",
        lifecycle_status: "active",
        lifecycle_version: 1,
        onboarded_at: new Date().toISOString(),
      })
      .select("id, user_id, lifecycle_status, status")
      .single();
    fail(insertResult.error, "Unable to create the receiver employee.");
    employee = insertResult.data;
  } else {
    const updateResult = await supabase.from("employees")
      .update({
        full_name: fullName,
        full_name_en: fullName,
        department_id: departmentResult.data.id,
        location_id: locationResult.data.id,
        job_title: "Inventory Receiver",
        status: "Active",
        lifecycle_status: "active",
        onboarded_at: new Date().toISOString(),
      })
      .eq("org_id", organization.id)
      .eq("id", employee.id)
      .select("id, user_id, lifecycle_status, status")
      .single();
    fail(updateResult.error, "Unable to activate the receiver employee.");
    employee = updateResult.data;
  }

  const locationAssignment = await supabase.from("employee_locations")
    .select("id")
    .eq("org_id", organization.id)
    .eq("employee_id", employee.id)
    .eq("location_id", locationResult.data.id)
    .is("assigned_to", null)
    .maybeSingle();
  fail(locationAssignment.error, "Unable to inspect the receiver location assignment.");
  if (locationAssignment.data) {
    const updateAssignment = await supabase.from("employee_locations")
      .update({ is_primary: true, assigned_from: new Date().toISOString().slice(0, 10) })
      .eq("id", locationAssignment.data.id);
    fail(updateAssignment.error, "Unable to update the receiver location assignment.");
  } else {
    const insertAssignment = await supabase.from("employee_locations").insert({
      org_id: organization.id,
      employee_id: employee.id,
      location_id: locationResult.data.id,
      is_primary: true,
      assigned_from: new Date().toISOString().slice(0, 10),
    });
    fail(insertAssignment.error, "Unable to create the receiver location assignment.");
  }

  const linkResult = await supabase.rpc("link_employee_identity", {
    p_org_id: organization.id,
    p_employee_id: employee.id,
    p_actor_user_id: actorResult.data.user_id,
    p_command_id: crypto.randomUUID(),
    p_user_id: authUser.id,
    p_email: email,
    p_full_name: fullName,
    p_role: "inventory_receiver",
  });
  fail(linkResult.error, "Unable to link the receiver identity.");

  const profileActivation = await supabase.from("profiles")
    .update({ account_status: "Active" })
    .eq("org_id", organization.id)
    .eq("user_id", authUser.id);
  fail(profileActivation.error, "Unable to activate the receiver profile.");

  const [profileCheck, membershipCheck, employeeCheck] = await Promise.all([
    supabase.from("profiles").select("account_status")
      .eq("org_id", organization.id).eq("user_id", authUser.id).single(),
    supabase.from("org_members").select("role")
      .eq("org_id", organization.id).eq("user_id", authUser.id).single(),
    supabase.from("employees").select("id, status, lifecycle_status, location_id")
      .eq("org_id", organization.id).eq("user_id", authUser.id).single(),
  ]);
  fail(profileCheck.error, "Unable to verify the receiver profile.");
  fail(membershipCheck.error, "Unable to verify the receiver role.");
  fail(employeeCheck.error, "Unable to verify the receiver employee.");
  if (
    String(profileCheck.data.account_status).toLowerCase() !== "active"
    || membershipCheck.data.role !== "inventory_receiver"
    || String(employeeCheck.data.status).toLowerCase() !== "active"
    || employeeCheck.data.lifecycle_status !== "active"
  ) {
    throw new Error("Receiver verification did not reach an active state.");
  }

  console.log(JSON.stringify({
    ready: true,
    email,
    role: membershipCheck.data.role,
    organization: organization.name,
    department: departmentResult.data.name,
    location: locationResult.data.name,
    employee_id: employeeCheck.data.id,
    password_stored: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Inventory receiver seed failed: ${error.message}`);
  process.exit(1);
});
