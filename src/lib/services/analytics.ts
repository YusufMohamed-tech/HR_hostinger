import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getKpiDefinitions(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_definitions" as never)
    .select("*, kpi_targets(*), kpi_results(*)")
    .eq("org_id", orgId)
    .order("name");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getKpiById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_definitions" as never)
    .select("*, kpi_targets(*), kpi_results(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createKpiDefinition(
  values: { org_id: string; name: string; description?: string; unit?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_definitions" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "kpi_definition", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function createKpiTarget(
  values: { org_id: string; kpi_id: string; target_value: number; period_start?: string; period_end?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_targets" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "kpi_target", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function recordKpiResult(
  values: { org_id: string; kpi_id: string; employee_id?: string; department_id?: string; value: number },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_results" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "recorded", entity: "kpi_result", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteKpiDefinition(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("kpi_definitions" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "kpi_definition", entity_id: id,
    });
  }

  return { error };
}
