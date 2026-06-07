import { NextRequest, NextResponse } from "next/server";
import { getFormFiles, uploadTaskUpdateAttachments, validateTaskAttachments } from "@/lib/server/task-attachments";
import { notifyTaskStakeholders } from "@/lib/server/task-notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["pending", "in_progress", "completed", "rejected", "delayed"]);
const elevatedRoles = new Set(["admin", "hr_admin", "training_manager"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isManagedEmployee(employee: Record<string, unknown> | null | undefined, managerEmployeeId: string) {
  if (!employee || !managerEmployeeId) return false;
  if (String(employee.manager_id || "") === managerEmployeeId) return true;

  const department = employee.department as Record<string, unknown> | null | undefined;
  if (String(department?.manager_employee_id || "") === managerEmployeeId) return true;

  const location = employee.location as Record<string, unknown> | null | undefined;
  return String(location?.manager_employee_id || "") === managerEmployeeId;
}

async function canAddTaskUpdate(values: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  userId: string;
  role: string;
  orgId: string;
  employeeId: string;
  task: Record<string, unknown>;
}) {
  const taskId = String(values.task.id || "");

  if (values.employeeId) {
    const assignmentResult = await values.admin
      .from("task_assignments")
      .select("id")
      .eq("org_id", values.orgId)
      .eq("task_id", taskId)
      .eq("employee_id", values.employeeId)
      .maybeSingle();

    if (assignmentResult.error) return { allowed: false, error: assignmentResult.error.message };
    if (assignmentResult.data) return { allowed: true, error: "" };
  }

  if (!elevatedRoles.has(values.role)) return { allowed: false, error: "" };
  if (values.role === "admin") return { allowed: true, error: "" };
  if (values.role === "hr_admin") {
    return { allowed: String(values.task.created_by || "") === values.userId, error: "" };
  }

  const managerResult = await values.admin
    .from("employees")
    .select("id")
    .eq("org_id", values.orgId)
    .eq("user_id", values.userId)
    .maybeSingle();

  if (managerResult.error) return { allowed: false, error: managerResult.error.message };
  const managerEmployeeId = String(asRecord(managerResult.data).id || "");
  if (!managerEmployeeId) return { allowed: false, error: "" };

  const assignmentsResult = await values.admin
    .from("task_assignments")
    .select("employee:employee_id(id, manager_id, department:department_id(manager_employee_id), location:location_id(manager_employee_id))")
    .eq("org_id", values.orgId)
    .eq("task_id", taskId);

  if (assignmentsResult.error) return { allowed: false, error: assignmentsResult.error.message };

  const assignments = (assignmentsResult.data ?? []) as Record<string, unknown>[];
  return {
    allowed: assignments.some((assignment) => isManagedEmployee(assignment.employee as Record<string, unknown> | null, managerEmployeeId)),
    error: "",
  };
}

export async function POST(request: NextRequest) {
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
      task_id: formData.get("task_id"),
      status: formData.get("status"),
      note: formData.get("note"),
      progress: formData.get("progress"),
    };
  } else {
    body = asRecord(await request.json().catch(() => ({})));
  }

  const taskId = String(body.task_id || "").trim();
  const status = String(body.status || "in_progress").trim();
  const note = String(body.note || "").trim();
  const progressValue = Number(body.progress ?? 50);
  const progress = Number.isFinite(progressValue) ? Math.max(0, Math.min(100, progressValue)) : 50;

  if (!taskId) {
    return NextResponse.json({ message: "Task id is required." }, { status: 400 });
  }
  if (!note && files.length === 0) {
    return NextResponse.json({ message: "Note or attachment is required." }, { status: 400 });
  }
  if (!allowedStatuses.has(status)) {
    return NextResponse.json({ message: "Unsupported task status." }, { status: 400 });
  }

  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) {
    return NextResponse.json({ message: attachmentError }, { status: 400 });
  }

  const admin = createAdminClient();
  const [employeeResult, membershipResult] = await Promise.all([
    admin.from("employees").select("id, org_id").eq("user_id", user.id).maybeSingle(),
    admin.from("org_members").select("org_id, role").eq("user_id", user.id).maybeSingle(),
  ]);

  if (employeeResult.error) {
    return NextResponse.json({ message: employeeResult.error.message }, { status: 500 });
  }
  if (membershipResult.error) {
    return NextResponse.json({ message: membershipResult.error.message }, { status: 500 });
  }

  const employeeRecord = asRecord(employeeResult.data);
  const membershipRecord = asRecord(membershipResult.data);
  const employeeId = String(employeeRecord.id || "");
  const orgId = String(employeeRecord.org_id || membershipRecord.org_id || "");
  const role = String(membershipRecord.role || "");

  if (!orgId) {
    return NextResponse.json({ message: "Organization membership is required." }, { status: 403 });
  }

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select("id, org_id, created_by, status")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();

  if (taskError) return NextResponse.json({ message: taskError.message }, { status: 500 });
  if (!task) return NextResponse.json({ message: "Task was not found." }, { status: 404 });

  const access = await canAddTaskUpdate({
    admin,
    userId: user.id,
    role,
    orgId,
    employeeId,
    task: asRecord(task),
  });

  if (access.error) return NextResponse.json({ message: access.error }, { status: 500 });
  if (!access.allowed) {
    return NextResponse.json({ message: "You are not allowed to update this task." }, { status: 403 });
  }

  const { data: update, error: updateError } = await admin
    .from("task_updates")
    .insert({
      org_id: orgId,
      task_id: taskId,
      employee_id: employeeId || null,
      status,
      progress,
      note: note || "تم إرفاق ملف على المهمة.",
    } as never)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ message: updateError.message }, { status: 500 });
  }

  const updateRecord = update as Record<string, unknown>;
  const updateId = String(updateRecord.id || "");
  if (files.length > 0) {
    const uploadResult = await uploadTaskUpdateAttachments(admin, { taskId, updateId, files });
    if (uploadResult.error) return NextResponse.json({ message: uploadResult.error.message }, { status: 500 });
    updateRecord.attachments = uploadResult.data;
  }

  await notifyTaskStakeholders(admin, {
    orgId,
    taskId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "note",
    status,
    note: note || "تم إرفاق ملف على المهمة.",
  });

  return NextResponse.json({ data: { update: updateRecord } });
}
