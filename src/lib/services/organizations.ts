import { createClient } from "@/lib/supabase/client";

/* ─── READ ─── */

export async function getOrganizations() {
  const supabase = createClient();
  const result = await supabase
    .from("organizations" as never)
    .select("*")
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getOrganizationById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("organizations" as never)
    .select("*, org_members(count)")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createOrganization(values: { name: string; slug?: string; plan?: string }) {
  const supabase = createClient();
  const result = await supabase.from("organizations" as never).insert(values as never).select().single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── UPDATE ─── */

export async function updateOrganization(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase.from("organizations" as never).update(values as never).eq("id", id).select().single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── DELETE ─── */

export async function deleteOrganization(id: string) {
  const supabase = createClient();
  const result = await supabase.from("organizations" as never).delete().eq("id", id);
  return result as unknown as { error: { message: string } | null };
}
