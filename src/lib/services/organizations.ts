import { createClient } from "@/lib/supabase/client";

export async function getOrganizations() {
  const supabase = createClient();
  const result = await supabase
    .from("organizations")
    .select("*")
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createOrganization(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("organizations")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateOrganization(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("organizations")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function deleteOrganization(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("organizations")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}
