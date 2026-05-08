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
  const supabase = createClient();
  const result = await supabase
    .from("departments")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateDepartment(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("departments")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteDepartment(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("departments")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}
