import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── EARNINGS ─── */

export async function getEarnings(payrollItemId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("earnings" as never)
    .select("*")
    .eq("payroll_item_id", payrollItemId);
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createEarning(
  values: { org_id: string; payroll_item_id: string; earning_type: string; amount: number; notes?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("earnings" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "earning", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function deleteEarning(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("earnings" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };
  if (!error) {
    await writeAuditLog(supabase, { org_id: orgId, actor_user_id: actorUserId, action: "deleted", entity: "earning", entity_id: id });
  }
  return { error };
}

/* ─── DEDUCTIONS ─── */

export async function getDeductions(payrollItemId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("deductions" as never)
    .select("*")
    .eq("payroll_item_id", payrollItemId);
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createDeduction(
  values: { org_id: string; payroll_item_id: string; deduction_type: string; amount: number; notes?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("deductions" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "deduction", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function deleteDeduction(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("deductions" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };
  if (!error) {
    await writeAuditLog(supabase, { org_id: orgId, actor_user_id: actorUserId, action: "deleted", entity: "deduction", entity_id: id });
  }
  return { error };
}
