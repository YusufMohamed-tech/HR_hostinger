import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getShifts(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts" as never)
    .select("*, location:location_id(name), shift_assignments(*, employee:employee_id(full_name, role))")
    .eq("org_id", orgId)
    .order("shift_date", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getShiftById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts" as never)
    .select("*, location:location_id(name), shift_assignments(*, employee:employee_id(full_name, role, email))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createShift(
  values: {
    org_id: string;
    location_id?: string;
    shift_date?: string;
    start_time?: string;
    end_time?: string;
    required_headcount?: number;
    status?: string;
  },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "created",
      entity: "shift",
      entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── UPDATE ─── */

export async function updateShift(
  id: string,
  orgId: string,
  values: Record<string, unknown>,
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts" as never)
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated", entity: "shift", entity_id: id,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteShift(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("shifts" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "shift", entity_id: id,
    });
  }

  return { error };
}

/* ─── ASSIGNMENTS ─── */

export async function createShiftAssignment(
  values: { org_id: string; shift_id: string; employee_id: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("shift_assignments" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "assigned_to_shift",
      entity: "shift_assignment",
      entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function deleteShiftAssignment(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("shift_assignments" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "removed_from_shift", entity: "shift_assignment", entity_id: id,
    });
  }

  return { error };
}
