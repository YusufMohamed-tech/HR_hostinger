import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getEmployees(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees" as never)
    .select("*, departments:department_id(name), locations:location_id(name)")
    .eq("org_id", orgId)
    .order("full_name");

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employees" as never)
    .select("*, departments:department_id(name), locations:location_id(name), contracts(*)")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createEmployee(
  values: {
    org_id: string;
    full_name: string;
    email?: string;
    phone?: string;
    role?: string;
    status?: string;
    department_id?: string;
    location_id?: string;
    manager_id?: string;
    hire_date?: string;
    employee_code?: string;
  },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("employees" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "created",
      entity: "employee",
      entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── UPDATE ─── */

export async function updateEmployee(
  id: string,
  orgId: string,
  values: Record<string, unknown>,
  actorUserId?: string
) {
  const supabase = createClient();

  const oldResult = await supabase.from("employees" as never).select("*").eq("id", id).single();
  const old = (oldResult as unknown as { data: Record<string, unknown> | null }).data;

  const result = await supabase
    .from("employees" as never)
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated", entity: "employee", entity_id: id,
      old_values: old, new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteEmployee(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();

  const oldResult = await supabase.from("employees" as never).select("*").eq("id", id).single();
  const old = (oldResult as unknown as { data: Record<string, unknown> | null }).data;

  const result = await supabase.from("employees" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "employee", entity_id: id,
      old_values: old,
    });
  }

  return { error };
}
