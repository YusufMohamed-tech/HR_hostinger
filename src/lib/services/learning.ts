import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getCourses(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("courses" as never)
    .select("*, enrollments(count), course_modules(count)")
    .eq("org_id", orgId)
    .order("title");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getCourseById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("courses" as never)
    .select("*, course_modules(*), enrollments(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

/* ─── CREATE ─── */

export async function createCourse(
  values: { org_id: string; title: string; description?: string; status?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("courses" as never)
    .insert(values as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "created", entity: "course", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function createEnrollment(
  values: { org_id: string; course_id: string; employee_id: string; due_date?: string },
  actorUserId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("enrollments" as never)
    .insert({ ...values, status: "Assigned", progress: 0 } as never)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && data) {
    await writeAuditLog(supabase, {
      org_id: values.org_id, actor_user_id: actorUserId,
      action: "enrolled", entity: "enrollment", entity_id: data.id as string,
      new_values: values,
    });
  }

  return { data, error };
}

export async function updateEnrollmentProgress(
  id: string,
  orgId: string,
  progress: number,
  actorUserId?: string
) {
  const supabase = createClient();
  const status = progress >= 100 ? "Completed" : progress > 0 ? "In Progress" : "Assigned";
  const result = await supabase
    .from("enrollments" as never)
    .update({ progress, status } as never)
    .eq("id", id)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "updated_progress", entity: "enrollment", entity_id: id,
      new_values: { progress, status },
    });
  }

  return { data, error };
}

/* ─── DELETE ─── */

export async function deleteCourse(id: string, orgId: string, actorUserId?: string) {
  const supabase = createClient();
  const result = await supabase.from("courses" as never).delete().eq("id", id);
  const { error } = result as unknown as { error: { message: string } | null };

  if (!error) {
    await writeAuditLog(supabase, {
      org_id: orgId, actor_user_id: actorUserId,
      action: "deleted", entity: "course", entity_id: id,
    });
  }

  return { error };
}
