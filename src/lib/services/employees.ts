import { createClient } from "@/lib/supabase/client";

export async function getEmployees(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .select("*, department:department_id(name, manager_employee_id), location:location_id(name, manager_employee_id, latitude, longitude, radius_meters), manager:manager_id(full_name), employee_locations(location_id, is_primary, assigned_from, assigned_to, location:location_id(id, name, latitude, longitude, radius_meters))")
    .eq("org_id", orgId)
    .order("full_name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .select("*, department:department_id(name), location:location_id(name), employee_locations(location_id, is_primary, assigned_from, assigned_to, location:location_id(id, name, latitude, longitude, radius_meters))")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createEmployee(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function replaceEmployeeLocations(
  employeeId: string,
  locationIds: string[],
  primaryLocationId?: string
) {
  const supabase = createClient();
  const uniqueLocationIds = Array.from(new Set(locationIds.filter(Boolean)));
  const primaryId = primaryLocationId && uniqueLocationIds.includes(primaryLocationId)
    ? primaryLocationId
    : uniqueLocationIds[0];

  const deleteResult = await supabase
    .from("employee_locations")
    .delete()
    .eq("employee_id", employeeId);

  if (deleteResult.error) {
    return { error: { message: deleteResult.error.message } };
  }

  if (uniqueLocationIds.length === 0) {
    return { error: null };
  }

  const rows = uniqueLocationIds.map((locationId) => ({
    employee_id: employeeId,
    location_id: locationId,
    is_primary: locationId === primaryId,
    assigned_from: new Date().toISOString().split("T")[0],
  }));

  const insertResult = await supabase
    .from("employee_locations")
    .insert(rows as never);

  return { error: insertResult.error ? { message: insertResult.error.message } : null };
}

export async function createEmployeeAccount(values: {
  employee_id: string;
  email: string;
  password: string;
  full_name?: string;
  role: "employee" | "training_manager";
}) {
  const response = await fetch("/api/hr/employee-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      data: null,
      error: { message: String(data?.message || "Unable to create employee account.") },
    };
  }

  return {
    data,
    error: null,
  } as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateEmployee(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteEmployee(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}
