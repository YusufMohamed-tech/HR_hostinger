import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["pending", "in_progress", "completed", "rejected", "delayed"]);

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const assignmentId = String((body as Record<string, unknown>).assignment_id || "").trim();
  const status = String((body as Record<string, unknown>).status || "").trim();
  const note = String((body as Record<string, unknown>).note || "").trim();

  if (!assignmentId) {
    return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });
  }
  if (!allowedStatuses.has(status)) {
    return NextResponse.json({ message: "Unsupported task status." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, org_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (employeeError) {
    return NextResponse.json({ message: employeeError.message }, { status: 500 });
  }

  const employeeRecord = employee as Record<string, unknown> | null;
  const employeeId = String(employeeRecord?.id || "");
  const orgId = String(employeeRecord?.org_id || "");
  if (!employeeId || !orgId) {
    return NextResponse.json({ message: "Employee profile is required." }, { status: 403 });
  }

  const { data: assignment, error: assignmentError } = await admin
    .from("task_assignments")
    .select("id, task_id")
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (assignmentError) {
    return NextResponse.json({ message: assignmentError.message }, { status: 500 });
  }
  if (!assignment) {
    return NextResponse.json({ message: "Task assignment was not found for this employee." }, { status: 404 });
  }

  const assignmentRecord = assignment as Record<string, unknown>;
  const taskId = String(assignmentRecord.task_id || "");

  const { data: updatedAssignment, error: updateError } = await admin
    .from("task_assignments")
    .update({ status } as never)
    .eq("id", assignmentId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ message: updateError.message }, { status: 500 });
  }

  const updateNote = note || (status === "completed" ? "تم الإنجاز" : status === "in_progress" ? "بدأ العمل" : "تم تحديث الحالة");
  const { error: taskUpdateError } = await admin.from("task_updates").insert({
    org_id: orgId,
    task_id: taskId,
    employee_id: employeeId,
    status,
    progress: status === "completed" ? 100 : status === "in_progress" ? 50 : 0,
    note: updateNote,
  } as never);

  if (taskUpdateError) {
    return NextResponse.json({ message: taskUpdateError.message }, { status: 500 });
  }

  return NextResponse.json({ data: { assignment: updatedAssignment } });
}
