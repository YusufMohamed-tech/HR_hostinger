import { createClient } from "@/lib/supabase/client";

export async function getDepartments(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("departments")
    .select("*, manager:manager_employee_id(full_name)")
    .eq("org_id", orgId)
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createDepartment(values: Record<string, unknown>) {
  return structureCommand("save_department", crypto.randomUUID(), null, values);
}

export async function updateDepartment(id: string, values: Record<string, unknown>) {
  return structureCommand("save_department", id, Number(values.expected_version), values);
}

export async function deleteDepartment(id: string, expectedVersion: number) {
  return structureCommand("delete_department", id, expectedVersion, {});
}

export async function setDepartmentMembers(id: string, expectedVersion: number, managerEmployeeId: string | null, employeeIds: string[]) {
  return structureCommand("set_department_members", id, expectedVersion, {
    manager_employee_id: managerEmployeeId,
    employee_ids: employeeIds,
  });
}

async function structureCommand(action: string, targetId: string, expectedVersion: number | null, payload: Record<string, unknown>) {
  try {
    const response = await fetch("/api/hr/structure", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, command_id: crypto.randomUUID(), target_id: targetId,
        expected_version: Number.isFinite(expectedVersion) ? expectedVersion : null, payload }) });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { data: body.data || null, error: null }
      : { data: null, error: { message: String(body.message || "Unable to update organization structure.") } };
  } catch {
    return { data: null, error: { message: "Unable to connect to organization structure service." } };
  }
}
