import { createClient } from "@/lib/supabase/client";

export async function getLocations(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("locations")
    .select("*, manager:manager_employee_id(full_name), project:project_id(id, name, slug, code, brand_color)")
    .eq("org_id", orgId)
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createLocation(values: Record<string, unknown>) {
  return structureCommand("save_location", crypto.randomUUID(), null, values);
}

export async function updateLocation(id: string, values: Record<string, unknown>) {
  return structureCommand("save_location", id, Number(values.expected_version), values);
}

export async function deleteLocation(id: string, expectedVersion: number) {
  return structureCommand("delete_location", id, expectedVersion, {});
}

async function structureCommand(action: string, targetId: string, expectedVersion: number | null, payload: Record<string, unknown>) {
  try {
    const response = await fetch("/api/hr/structure", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, command_id: crypto.randomUUID(), target_id: targetId,
        expected_version: Number.isFinite(expectedVersion) ? expectedVersion : null, payload }) });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { data: body.data || null, error: null }
      : { data: null, error: { message: String(body.message || "Unable to update location.") } };
  } catch {
    return { data: null, error: { message: "Unable to connect to location service." } };
  }
}
