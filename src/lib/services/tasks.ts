import { createClient } from "@/lib/supabase/client";

export async function getTasks(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .select("*, location:location_id(name), assignments:task_assignments(id, status, employee:employee_id(id, full_name))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getTaskById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .select("*, assignments:task_assignments(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createTask(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateTask(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteTask(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tasks")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}

export async function assignTask(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("task_assignments")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateTaskAssignment(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("task_assignments")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createTaskUpdate(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("task_updates")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
