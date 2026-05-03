import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getOrgMembers(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members" as never)
    .select("*, profiles:user_id(full_name, email)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function addOrgMember(
  values: { org_id: string; user_id: string; role: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "added_member",
      entity: "org_member",
      entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── UPDATE ─── */

export async function updateOrgMemberRole(
  id: string,
  orgId: string,
  role: string,
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members" as never)
    .update({ role } as never)
    .eq("id", id)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated_role", entity: "org_member", entity_id: id,
      new_values: { role },
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function removeOrgMember(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("org_members" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "removed_member", entity: "org_member", entity_id: id,
    });
  }

  return { error };
}
