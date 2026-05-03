import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getAvailability(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("availability" as never)
    .select("*, employee:employee_id(full_name)")
    .eq("org_id", orgId)
    .order("weekday");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeAvailability(employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("availability" as never)
    .select("*")
    .eq("employee_id", employeeId)
    .order("weekday");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createAvailability(
  values: {
    org_id: string;
    employee_id: string;
    weekday: number;
    start_time?: string;
    end_time?: string;
    notes?: string;
  },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("availability" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id,
      actor_user_id: actorUserId,
      action: "created",
      entity: "availability",
      entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteAvailability(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("availability" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "availability", entity_id: id,
    });
  }

  return { error };
}

/* ─── CONFLICT DETECTION ─── */

export async function detectShiftConflicts(orgId: string, employeeId: string, shiftDate: string, startTime: string, endTime: string) {
  const supabase = createClient();

  // Check for overlapping shifts for this employee on the same date
  const result = await supabase
    .from("shift_assignments" as never)
    .select("*, shift:shift_id(shift_date, start_time, end_time, location:location_id(name))")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId);

  const { data } = result as unknown as { data: Record<string, unknown>[] | null };

  if (!data) return { conflicts: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conflicts = data.filter((assignment: any) => {
    const shift = assignment.shift;
    if (!shift || shift.shift_date !== shiftDate) return false;

    const existingStart = new Date(shift.start_time).getTime();
    const existingEnd = new Date(shift.end_time).getTime();
    const newStart = new Date(startTime).getTime();
    const newEnd = new Date(endTime).getTime();

    // Overlap check
    return newStart < existingEnd && newEnd > existingStart;
  });

  return {
    conflicts: conflicts.map((c: Record<string, unknown>) => ({
      type: "double_booking",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details: `Already assigned to shift at ${(c.shift as any)?.location?.name || "unknown"} on ${shiftDate}`,
    })),
  };
}
