import { createClient } from "@/lib/supabase/client";

export async function getEmployeeAssets(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("assigned_date", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getAssets(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .select("*, employee:employee_id(full_name, employee_code), inventory:inventory_id(asset_name, asset_type, serial_number, status)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getAssetInventory(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("asset_inventory")
    .select("*, office_location:office_location_id(name, city)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function hasUnreturnedAssets(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .select("id")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .is("returned_date", null)
    .neq("status", "returned")
    .limit(1);

  if (result.error) return { hasAssets: false, error: result.error as { message: string } };
  return { hasAssets: Boolean(result.data?.length), error: null };
}

export async function createAssetAssignment(values: Record<string, unknown>) {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, mode: "assignment", assignment_id: crypto.randomUUID(), command_id: crypto.randomUUID() }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: { message: String(payload?.message || "Unable to assign asset.") } };
  }
  return { data: payload?.data || null, error: null };
}

export async function updateAssetAssignment(id: string, values: Record<string, unknown>) {
  const response = await fetch("/api/assets", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...values, command_id: crypto.randomUUID() }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: { message: String(payload?.message || "Unable to update asset.") } };
  }
  return { data: payload?.data || null, error: null };
}

export async function createAssetInventory(values: Record<string, unknown>) {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "inventory", ...values, inventory_id: crypto.randomUUID(), command_id: crypto.randomUUID() }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: { message: String(payload?.message || "Unable to add asset inventory.") } };
  }
  return { data: payload?.data || null, error: null };
}

export async function acknowledgeAssetAssignment(id: string, expectedVersion: number, signatureData: string) {
  const response = await fetch("/api/assets", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, expected_version: expectedVersion, signature_data: signatureData,
      consent: true, command_id: crypto.randomUUID() }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: { message: String(payload?.message || "Unable to acknowledge asset.") } };
  }
  return { data: payload?.data || null, error: null };
}
