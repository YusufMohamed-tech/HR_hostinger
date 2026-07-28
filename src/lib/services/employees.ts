import { createClient } from "@/lib/supabase/client";

function commandId(scope: string) {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = `hrms-command:${scope}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function clearCommandId(scope: string) {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(`hrms-command:${scope}`);
}

function clearCommandPrefix(prefix: string) {
  if (typeof window === "undefined") return;
  const storagePrefix = `hrms-command:${prefix}`;
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(storagePrefix)) window.sessionStorage.removeItem(key);
  }
}

async function responseResult(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { data: null, error: { message: String(body.message || fallback) } };
  return { data: (body.employee ?? body.data ?? body) as Record<string, unknown>, error: null };
}

export async function getEmployees(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .select("*, department:department_id(name, manager_employee_id), company:company_id(id, name, slug, code), project:project_id(id, name, slug, code), location:location_id(name, city, project_id, manager_employee_id, latitude, longitude, radius_meters), manager:manager_id(full_name), employee_locations(location_id, is_primary, assigned_from, assigned_to, location:location_id(id, name, city, project_id, latitude, longitude, radius_meters))")
    .eq("org_id", orgId)
    .order("full_name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeById(orgId: string, id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .select("*, department:department_id(name), company:company_id(id, name, slug, code), project:project_id(id, name, slug, code), location:location_id(name, city, project_id), employee_locations(location_id, is_primary, assigned_from, assigned_to, location:location_id(id, name, city, project_id, latitude, longitude, radius_meters))")
    .eq("org_id", orgId)
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createEmployee(values: Record<string, unknown>) {
  const employee = { ...values };
  delete employee.org_id;
  const scope = `employee-onboarding:${String(employee.email || employee.employee_code || employee.full_name || "draft")}`;
  const response = await fetch("/api/hr/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command_id: commandId(scope), employee }),
  });
  const result = await responseResult(response, "Unable to begin employee onboarding.");
  return result;
}

export async function replaceEmployeeLocations(
  orgId: string,
  employeeId: string,
  locationIds: string[],
  primaryLocationId?: string
) {
  const uniqueLocationIds = Array.from(new Set(locationIds.filter(Boolean)));
  const primaryId = primaryLocationId && uniqueLocationIds.includes(primaryLocationId)
    ? primaryLocationId
    : uniqueLocationIds[0];
  const response = await fetch(`/api/hr/employees/${employeeId}/locations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location_ids: uniqueLocationIds, primary_location_id: primaryId || null, org_id: orgId }),
  });
  const body = await response.json().catch(() => ({}));
  return { error: response.ok ? null : { message: String(body.message || "Unable to update employee locations.") } };
}

export type EmployeeAccountRole =
  | "employee"
  | "hr_admin"
  | "hr_recruitment"
  | "training_manager"
  | "onground_agent_manager"
  | "promoter"
  | "finance_manager"
  | "accountant"
  | "finance_viewer";

export async function createEmployeeAccount(values: {
  employee_id: string;
  email: string;
  full_name?: string;
  role: EmployeeAccountRole;
  password: string;
}) {
  const scope = `employee-identity:${values.employee_id}:${values.email.toLowerCase()}`;
  const response = await fetch("/api/hr/employee-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, command_id: commandId(scope) }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(data?.message || "Unable to create employee account.") },
    };
  }

  clearCommandId(scope);

  return {
    data,
    error: null,
  } as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function setEmployeeAccountPassword(values: {
  employee_id: string;
  password: string;
}) {
  const response = await fetch("/api/hr/employee-accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const data = await response.json().catch(() => null);

  return {
    data: response.ok ? data : null,
    error: response.ok
      ? null
      : { message: String(data?.message || "Unable to update employee password.") },
  };
}

export async function updateEmployee(
  id: string,
  values: Record<string, unknown>,
  options: { expectedVersion: number; locationIds: string[]; primaryLocationId?: string; managedDepartmentIds: string[] }
) {
  const safeValues = { ...values };
  delete safeValues.org_id;
  const scope = `employee-update:${id}:${options.expectedVersion}`;
  const response = await fetch(`/api/hr/employees/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command_id: commandId(scope), expected_version: options.expectedVersion,
      employee: safeValues, location_ids: options.locationIds,
      primary_location_id: options.primaryLocationId || null,
      managed_department_ids: options.managedDepartmentIds }),
  });
  const result = await responseResult(response, "Unable to update employee.");
  if (!result.error) clearCommandId(scope);
  return result;
}

export async function promoteEmployee(id: string, values: Record<string, unknown>) {
  const response = await fetch("/api/hr/structure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "promote_employee", command_id: crypto.randomUUID(), target_id: id,
      expected_version: Number(values.expected_version), payload: values }),
  });
  const body = await response.json().catch(() => ({}));
  return response.ok ? { data: body.data || null, error: null }
    : { data: null, error: { message: String(body.message || "Unable to promote employee.") } };
}

export async function finalizeEmployeeOnboarding(employeeId: string) {
  const scope = `employee-finalize:${employeeId}`;
  const response = await fetch(`/api/hr/employees/${employeeId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command_id: commandId(scope) }),
  });
  const result = await responseResult(response, "Unable to finalize employee onboarding.");
  if (!result.error) {
    clearCommandId(scope);
    clearCommandPrefix("employee-onboarding:");
  }
  return result;
}

export async function offboardEmployeeRecord(
  _orgId: string,
  id: string,
  values?: { effectiveDate?: string; reason?: string; terminationType?: "resignation" | "termination" | "end_of_contract" | "retirement" | "other" }
) {
  const scope = `employee-offboard:${id}`;
  const response = await fetch(`/api/hr/employees/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command_id: commandId(scope),
      effective_date: values?.effectiveDate || new Date().toISOString().slice(0, 10),
      reason: values?.reason || "Offboarded by HR from the employee directory.",
      termination_type: values?.terminationType || "termination",
    }),
  });
  const result = await responseResult(response, "Unable to offboard employee.");
  if (!result.error) clearCommandId(scope);
  return { error: result.error };
}
