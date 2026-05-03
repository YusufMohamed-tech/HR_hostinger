import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getPayrollCycles(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_cycles" as never)
    .select("*")
    .eq("org_id", orgId)
    .order("period_start", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getPayrollCycleById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_cycles" as never)
    .select("*, payroll_items(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getPayrollItems(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_items" as never)
    .select("*, employee:employee_id(full_name), payroll_cycle:payroll_cycle_id(name)")
    .eq("org_id", orgId);
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createPayrollCycle(
  values: {
    org_id: string;
    name?: string;
    period_start?: string;
    period_end?: string;
    status?: string;
  },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_cycles" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "created",
      entity: "payroll_cycle",
      entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function createPayrollItem(
  values: {
    org_id: string;
    payroll_cycle_id: string;
    employee_id: string;
    base_salary?: number;
    bonuses?: number;
    deductions?: number;
    total?: number;
  },
  actorUserId?: string
) {
  const supabase = createClient();
  const computed = {
    ...values,
    total: (values.base_salary || 0) + (values.bonuses || 0) - (values.deductions || 0),
  };
  const result = await supabase
    .from("payroll_items" as never)
    .insert(computed as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "created",
      entity: "payroll_item",
      entity_id: data.id as string,
      new_values: computed,
    });
  }

  return { data, error };
}

/* ─── UPDATE ─── */

export async function updatePayrollCycle(
  id: string,
  orgId: string,
  values: Record<string, unknown>,
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_cycles" as never)
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated", entity: "payroll_cycle", entity_id: id,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deletePayrollCycle(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("payroll_cycles" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "payroll_cycle", entity_id: id,
    });
  }

  return { error };
}
