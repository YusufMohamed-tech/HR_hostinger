import { createClient } from "@/lib/supabase/client";

export async function getOrgMembers(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members")
    .select("*, profiles:user_id(full_name, email)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function addOrgMember(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateOrgMemberRole(id: string, role: string) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members")
    .update({ role } as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function removeOrgMember(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members")
    .delete()
    .eq("id", id);

  return result as unknown as { error: { message: string } | null };
}
