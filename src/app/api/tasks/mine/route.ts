import { NextRequest, NextResponse } from "next/server";
import { getFormFiles, uploadTaskUpdateAttachments, validateTaskAttachments } from "@/lib/server/task-attachments";
import { notifyTaskStakeholders } from "@/lib/server/task-notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["pending", "in_progress", "completed", "rejected", "delayed"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown> = {};
  let files: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    files = getFormFiles(formData);
    body = {
      assignment_id: formData.get("assignment_id"),
      status: formData.get("status"),
      note: formData.get("note"),
    };
  } else {
    body = asRecord(await request.json().catch(() => ({})));
  }

  const assignmentId = String(body.assignment_id || "").trim();
  const status = String(body.status || "").trim();
  const note = String(body.note || "").trim();

  if (!assignmentId) {
    return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });
  }
  if (!allowedStatuses.has(status)) {
    return NextResponse.json({ message: "Unsupported task status." }, { status: 400 });
  }

  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) {
    return NextResponse.json({ message: attachmentError }, { status: 400 });
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

  const employeeRecord = asRecord(employee);
  const employeeId = String(employeeRecord.id || "");
  const orgId = String(employeeRecord.org_id || "");
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

  const assignmentRecord = asRecord(assignment);
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
  const { data: taskUpdate, error: taskUpdateError } = await admin
    .from("task_updates")
    .insert({
      org_id: orgId,
      task_id: taskId,
      employee_id: employeeId,
      status,
      progress: status === "completed" ? 100 : status === "in_progress" ? 50 : 0,
      note: updateNote,
    } as never)
    .select()
    .single();

  if (taskUpdateError) {
    return NextResponse.json({ message: taskUpdateError.message }, { status: 500 });
  }

  const taskUpdateRecord = taskUpdate as Record<string, unknown>;
  const updateId = String(taskUpdateRecord.id || "");
  if (files.length > 0) {
    const uploadResult = await uploadTaskUpdateAttachments(admin, { orgId, taskId, updateId, files });
    if (uploadResult.error) return NextResponse.json({ message: uploadResult.error.message }, { status: 500 });
    taskUpdateRecord.attachments = uploadResult.data;
  }

  await notifyTaskStakeholders(admin, {
    orgId,
    taskId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "status",
    status,
    note: updateNote,
  });

  return NextResponse.json({ data: { assignment: updatedAssignment, update: taskUpdateRecord } });
}
