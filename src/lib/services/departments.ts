import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getDepartments(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("departments" as never)
    .select("*, head:head_employee_id(full_name)")
    .eq("org_id", orgId)
    .order("name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getDepartmentById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("departments" as never)
    .select("*, head:head_employee_id(full_name)")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createDepartment(
  values: { org_id: string; name: string; head_employee_id?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase.from("departments" as never).insert(values as never).select().single();
  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "department", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── UPDATE ─── */

export async function updateDepartment(id: string, orgId: string, values: Record<string, unknown>, actorUserId?: string) {
  const supabase = createClient();
  const oldResult = await supabase.from("departments" as never).select("*").eq("id", id).single();
  const old = (oldResult as unknown as { data: Record<string, unknown> | null }).data;

  const result = await supabase.from("departments" as never).update(values as never).eq("id", id).select().single();
  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated", entity: "department", entity_id: id,
      old_values: old, new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteDepartment(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const oldResult = await supabase.from("departments" as never).select("*").eq("id", id).single();
  const old = (oldResult as unknown as { data: Record<string, unknown> | null }).data;

  const result = await supabase.from("departments" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "department", entity_id: id,
      old_values: old,
    });
  }

  return { error };
}
