import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { notifyTaskStakeholders } from "@/lib/server/task-notifications";

const allowedStatuses = new Set(["pending", "in_progress", "completed", "rejected", "delayed"]);

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const taskId = String((body as Record<string, unknown>).task_id || "").trim();
  const status = String((body as Record<string, unknown>).status || "in_progress").trim();
  const note = String((body as Record<string, unknown>).note || "").trim();
  const progressValue = Number((body as Record<string, unknown>).progress ?? 50);
  const progress = Number.isFinite(progressValue) ? Math.max(0, Math.min(100, progressValue)) : 50;

  if (!taskId) {
    return NextResponse.json({ message: "Task id is required." }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ message: "Note is required." }, { status: 400 });
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
    .select("id")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (assignmentError) {
    return NextResponse.json({ message: assignmentError.message }, { status: 500 });
  }
  if (!assignment) {
    return NextResponse.json({ message: "Task assignment was not found for this employee." }, { status: 404 });
  }

  const { data: update, error: updateError } = await admin
    .from("task_updates")
    .insert({
      org_id: orgId,
      task_id: taskId,
      employee_id: employeeId,
      status,
      progress,
      note,
    } as never)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ message: updateError.message }, { status: 500 });
  }

  await notifyTaskStakeholders(admin, {
    orgId,
    taskId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "note",
    status,
    note,
  });

  return NextResponse.json({ data: { update } });
}
