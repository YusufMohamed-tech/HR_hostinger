import { createClient } from "@/lib/supabase/client";

export async function getEmployees(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .select("*, department:department_id(name), location:location_id(name)")
    .eq("org_id", orgId)
    .order("full_name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .select("*, department:department_id(name), location:location_id(name)")
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
