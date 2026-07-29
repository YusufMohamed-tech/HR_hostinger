import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.FIELD_AGENT_ORG_SLUG?.trim() || "tatwir-talent";
const emailPrefix = process.env.FIELD_AGENT_EMAIL_PREFIX?.trim() || "ongroundagent";
const emailDomain = process.env.FIELD_AGENT_EMAIL_DOMAIN?.trim() || "tatwir.sa";
const passwordSuffix = process.env.FIELD_AGENT_PASSWORD_SUFFIX;
const count = Number(process.env.FIELD_AGENT_COUNT || 5);

if (!supabaseUrl || !serviceRoleKey || !passwordSuffix) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "
    + "or FIELD_AGENT_PASSWORD_SUFFIX."
  );
  process.exit(1);
}
if (!Number.isInteger(count) || count < 1 || count > 50) {
  console.error("FIELD_AGENT_COUNT must be an integer from 1 to 50.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(error, fallback) {
  if (error) throw new Error(error.message || fallback);
}

async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; ; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    fail(result.error, "Unable to list Auth users.");
    const user = result.data.users.find(
      (candidate) => candidate.email?.toLowerCase() === targetEmail
    );
    if (user || result.data.users.length < 100) return user || null;
  }
}

async function provisionAgent(index, context) {
  const emailLocal = `${emailPrefix}${index}`;
  const email = `${emailLocal}@${emailDomain}`.toLowerCase();
  const password = `${emailLocal}${passwordSuffix}`;
  const fullName = `Onground Agent ${index}`;
  const employeeCode = `ONGROUND-AGENT-${String(index).padStart(3, "0")}`;
  const phone = `+96650000${String(index).padStart(4, "0")}`;
  const nationalId = `TATWIR-FIELD-AGENT-${String(index).padStart(4, "0")}`;

  if (password.length < 12) throw new Error(`Generated password for ${email} is too short.`);

  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    const membership = await supabase.from("org_members")
      .select("org_id, role")
      .eq("user_id", authUser.id)
      .maybeSingle();
    fail(membership.error, `Unable to inspect ${email} membership.`);
    const safelyManaged = authUser.user_metadata?.provisioning_source === "tatwir-field-agent-seed";
    if (
      membership.data
      && (
        membership.data.org_id !== context.organization.id
        || membership.data.role !== "field_agent"
      )
    ) {
      throw new Error(`${email} already belongs to another organization or role.`);
    }
    if (!membership.data && !safelyManaged) {
      throw new Error(`${email} is an unmanaged Auth account; refusing to take it over.`);
    }
    const updated = await supabase.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...authUser.user_metadata,
        full_name: fullName,
        provisioning_source: "tatwir-field-agent-seed",
      },
    });
    fail(updated.error, `Unable to update ${email} Auth account.`);
    authUser = updated.data.user;
  } else {
    const created = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        provisioning_source: "tatwir-field-agent-seed",
      },
    });
    fail(created.error, `Unable to create ${email} Auth account.`);
    authUser = created.data.user;
  }
  if (!authUser) throw new Error(`Auth provisioning returned no user for ${email}.`);

  const employeeResult = await supabase.from("employees")
    .select("id, user_id, lifecycle_status")
    .eq("org_id", context.organization.id)
    .ilike("email", email)
    .maybeSingle();
  fail(employeeResult.error, `Unable to inspect ${email} employee record.`);
  let employee = employeeResult.data;
  if (employee && ["offboarding", "offboarded", "archived"].includes(employee.lifecycle_status)) {
    throw new Error(`${email} is offboarded or archived and cannot be reactivated.`);
  }
  if (employee?.user_id && employee.user_id !== authUser.id) {
    throw new Error(`${email} employee record is linked to another Auth identity.`);
  }

  const employeeValues = {
    full_name: fullName,
    full_name_en: fullName,
    email,
    phone,
    hiring_date: new Date().toISOString().slice(0, 10),
    department_id: context.department.id,
    location_id: context.location.id,
    job_title: "Field Agent",
    employment_type: "full_time",
    status: "Active",
    lifecycle_status: "active",
    onboarded_at: new Date().toISOString(),
  };
  if (employee) {
    const updated = await supabase.from("employees")
      .update(employeeValues)
      .eq("org_id", context.organization.id)
      .eq("id", employee.id)
      .select("id, user_id, lifecycle_status")
      .single();
    fail(updated.error, `Unable to activate ${email} employee record.`);
    employee = updated.data;
  } else {
    const created = await supabase.from("employees")
      .insert({
        org_id: context.organization.id,
        employee_code: employeeCode,
        lifecycle_version: 1,
        ...employeeValues,
      })
      .select("id, user_id, lifecycle_status")
      .single();
    fail(created.error, `Unable to create ${email} employee record.`);
    employee = created.data;
  }

  const locationAssignment = await supabase.from("employee_locations")
    .select("id")
    .eq("org_id", context.organization.id)
    .eq("employee_id", employee.id)
    .eq("location_id", context.location.id)
    .is("assigned_to", null)
    .maybeSingle();
  fail(locationAssignment.error, `Unable to inspect ${email} location assignment.`);
  if (locationAssignment.data) {
    const updated = await supabase.from("employee_locations")
      .update({ is_primary: true })
      .eq("id", locationAssignment.data.id);
    fail(updated.error, `Unable to update ${email} location assignment.`);
  } else {
    const created = await supabase.from("employee_locations").insert({
      org_id: context.organization.id,
      employee_id: employee.id,
      location_id: context.location.id,
      is_primary: true,
      assigned_from: new Date().toISOString().slice(0, 10),
    });
    fail(created.error, `Unable to create ${email} location assignment.`);
  }

  const linked = await supabase.rpc("link_employee_identity", {
    p_org_id: context.organization.id,
    p_employee_id: employee.id,
    p_actor_user_id: context.actor.user_id,
    p_command_id: crypto.randomUUID(),
    p_user_id: authUser.id,
    p_email: email,
    p_full_name: fullName,
    p_role: "field_agent",
  });
  fail(linked.error, `Unable to link ${email} identity.`);

  const profile = await supabase.from("profiles")
    .update({ account_status: "Active" })
    .eq("org_id", context.organization.id)
    .eq("user_id", authUser.id);
  fail(profile.error, `Unable to activate ${email} profile.`);

  const existingAgent = await supabase.from("field_agents")
    .select("id")
    .eq("organization_id", context.organization.id)
    .eq("user_id", authUser.id)
    .maybeSingle();
  fail(existingAgent.error, `Unable to inspect ${email} field-agent row.`);
  const fieldAgentValues = {
    full_name: fullName,
    phone,
    national_id: nationalId,
    region: "Riyadh",
    commission_rate: 0,
    max_sim_capacity: 1000,
    status: "active",
    joined_at: new Date().toISOString().slice(0, 10),
  };
  const fieldAgent = existingAgent.data
    ? await supabase.from("field_agents")
      .update(fieldAgentValues)
      .eq("organization_id", context.organization.id)
      .eq("id", existingAgent.data.id)
      .select("id, status")
      .single()
    : await supabase.from("field_agents")
      .insert({
        organization_id: context.organization.id,
        user_id: authUser.id,
        created_by: context.actor.user_id,
        ...fieldAgentValues,
      })
      .select("id, status")
      .single();
  fail(fieldAgent.error, `Unable to provision ${email} field-agent row.`);

  return {
    email,
    userId: authUser.id,
    employeeId: employee.id,
    fieldAgentId: fieldAgent.data.id,
  };
}

async function main() {
  const organizationResult = await supabase.from("organizations")
    .select("id, name, slug, status")
    .eq("slug", orgSlug)
    .maybeSingle();
  fail(organizationResult.error, "Unable to load the target organization.");
  if (!organizationResult.data || String(organizationResult.data.status).toLowerCase() !== "active") {
    throw new Error(`Active organization '${orgSlug}' was not found.`);
  }

  const [departmentResult, locationResult, actorResult] = await Promise.all([
    supabase.from("departments").select("id, name")
      .eq("org_id", organizationResult.data.id).order("created_at").limit(1).maybeSingle(),
    supabase.from("locations").select("id, name")
      .eq("org_id", organizationResult.data.id).order("created_at").limit(1).maybeSingle(),
    supabase.from("org_members").select("user_id, role")
      .eq("org_id", organizationResult.data.id).in("role", ["admin", "hr_admin"]).limit(1).maybeSingle(),
  ]);
  fail(departmentResult.error, "Unable to resolve a field-agent department.");
  fail(locationResult.error, "Unable to resolve a field-agent location.");
  fail(actorResult.error, "Unable to resolve a provisioning actor.");
  if (!departmentResult.data || !locationResult.data || !actorResult.data) {
    throw new Error("The organization requires a department, location, and admin/HR actor.");
  }

  const context = {
    organization: organizationResult.data,
    department: departmentResult.data,
    location: locationResult.data,
    actor: actorResult.data,
  };
  const agents = [];
  for (let index = 1; index <= count; index += 1) {
    agents.push(await provisionAgent(index, context));
  }

  const emails = agents.map((agent) => agent.email);
  const [memberships, employees, fieldAgents] = await Promise.all([
    supabase.from("org_members").select("user_id, role")
      .eq("org_id", context.organization.id).eq("role", "field_agent"),
    supabase.from("employees").select("id, email, user_id, status, lifecycle_status")
      .eq("org_id", context.organization.id).in("email", emails),
    supabase.from("field_agents").select("id, user_id, status")
      .eq("organization_id", context.organization.id).eq("status", "active"),
  ]);
  fail(memberships.error, "Unable to verify field-agent memberships.");
  fail(employees.error, "Unable to verify field-agent employees.");
  fail(fieldAgents.error, "Unable to verify field-agent rows.");
  if (
    employees.data?.length !== count
    || agents.some((agent) => !employees.data?.some(
      (employee) => employee.email === agent.email
        && employee.user_id
        && String(employee.status).toLowerCase() === "active"
        && employee.lifecycle_status === "active"
    ))
    || agents.some((agent) => !memberships.data?.some(
      (membership) => membership.user_id === agent.userId && membership.role === "field_agent"
    ))
    || agents.some((agent) => !fieldAgents.data?.some(
      (fieldAgent) => fieldAgent.id === agent.fieldAgentId && fieldAgent.status === "active"
    ))
  ) {
    throw new Error("Field-agent verification did not reach the requested active state.");
  }

  console.log(JSON.stringify({
    ready: true,
    organization: context.organization.name,
    count: agents.length,
    emails,
    passwords_printed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Field-agent seed failed: ${error.message}`);
  process.exit(1);
});
