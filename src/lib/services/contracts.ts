import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getContracts(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("contracts" as never)
    .select("*, employee:employee_id(full_name, role)")
    .eq("org_id", orgId)
    .order("start_date", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getContractById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("contracts" as never)
    .select("*, employee:employee_id(full_name, role)")
    .eq("id", id)
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createContract(
  values: {
    org_id: string; employee_id: string; start_date: string;
    end_date?: string; base_salary?: number; currency?: string; status?: string;
  },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase.from("contracts" as never).insert(values as never).select().single();
  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "contract", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── UPDATE ─── */

export async function updateContract(id: string, orgId: string, values: Record<string, unknown>, actorUserId?: string) {
  const supabase = createClient();
  const oldResult = await supabase.from("contracts" as never).select("*").eq("id", id).single();
  const old = (oldResult as unknown as { data: Record<string, unknown> | null }).data;

  const result = await supabase.from("contracts" as never).update(values as never).eq("id", id).select().single();
  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated", entity: "contract", entity_id: id,
      old_values: old, new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteContract(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const oldResult = await supabase.from("contracts" as never).select("*").eq("id", id).single();
  const old = (oldResult as unknown as { data: Record<string, unknown> | null }).data;

  const result = await supabase.from("contracts" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "contract", entity_id: id,
      old_values: old,
    });
  }

  return { error };
}
