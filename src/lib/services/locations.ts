import { createClient } from "@/lib/supabase/client";

export async function getLocations(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("locations")
    .select("*, manager:manager_employee_id(full_name)")
    .eq("org_id", orgId)
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createLocation(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("locations")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateLocation(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("locations")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteLocation(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("locations")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}
