import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFormFiles, uploadTaskAttachments, validateTaskAttachments } from "@/lib/server/task-attachments";
import { taskCommandStatus } from "@/lib/server/task-commands";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { removeUploadedPaths } from "@/lib/server/upload-security";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const schema = z.object({
  task_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  command_id: z.string().uuid(),
  message: z.string().trim().min(2).max(2000),
});

function isManagedEmployee(employee: Record<string, unknown>, managerEmployeeId: string) {
  if (String(employee.manager_id || "") === managerEmployeeId) return true;
  const department = employee.department as Record<string, unknown> | null;
  const location = employee.location as Record<string, unknown> | null;
  return String(department?.manager_employee_id || "") === managerEmployeeId
    || String(location?.manager_employee_id || "") === managerEmployeeId;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({
    feature: "hr",
    roles: ["admin", "hr_admin", "training_manager", "super_admin"],
  }, request);
  if ("error" in auth) return auth.error;

  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    files = getFormFiles(formData);
    body = Object.fromEntries(["task_id", "employee_id", "command_id", "message"]
      .map((key) => [key, formData.get(key)]));
  } else body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Task message data is invalid.", requestId: auth.requestId }, { status: 400 });
  }
  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) {
    return NextResponse.json({ message: attachmentError, requestId: auth.requestId }, { status: 400 });
  }

  const [taskResult, assignmentResult, assigneeResult] = await Promise.all([
    auth.admin.from("tasks").select("id, created_by").eq("org_id", auth.orgId)
      .eq("id", parsed.data.task_id).maybeSingle(),
    auth.admin.from("task_assignments").select("id").eq("org_id", auth.orgId)
      .eq("task_id", parsed.data.task_id).eq("employee_id", parsed.data.employee_id).maybeSingle(),
    auth.admin.from("employees").select("id, full_name, manager_id, department:department_id(manager_employee_id), location:location_id(manager_employee_id)")
      .eq("org_id", auth.orgId).eq("id", parsed.data.employee_id).maybeSingle(),
  ]);
  const lookupError = taskResult.error || assignmentResult.error || assigneeResult.error;
  if (lookupError) {
    return NextResponse.json({ message: lookupError.message, requestId: auth.requestId }, { status: 500 });
  }
  if (!taskResult.data || !assignmentResult.data || !assigneeResult.data) {
    return NextResponse.json({ message: "Assigned task was not found.", requestId: auth.requestId }, { status: 404 });
  }
  if (auth.role === "hr_admin" && taskResult.data.created_by !== auth.user.id) {
    return NextResponse.json({ message: "You may message only employees on tasks you created.", requestId: auth.requestId }, { status: 403 });
  }
  if (auth.role === "training_manager" && (!auth.employeeId
      || !isManagedEmployee(assigneeResult.data as unknown as Record<string, unknown>, auth.employeeId))) {
    return NextResponse.json({ message: "You may message only employees managed by you.", requestId: auth.requestId }, { status: 403 });
  }

  const upload = await uploadTaskAttachments(auth.admin, {
    orgId: auth.orgId,
    taskId: parsed.data.task_id,
    uploadScopeId: parsed.data.command_id,
    files,
  });
  if (upload.error || !upload.data) {
    return NextResponse.json({ message: upload.error?.message || "Attachment upload failed.", requestId: auth.requestId }, { status: 500 });
  }
  const result = await (auth.admin as unknown as RpcClient).rpc("add_task_update", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_task_id: parsed.data.task_id,
    p_note: `رسالة إلى ${assigneeResult.data.full_name}: ${parsed.data.message}`,
    p_progress: null,
    p_attachments: upload.data,
  });
  if (result.error) {
    await removeUploadedPaths(auth.admin, "task-attachments", upload.paths).catch(() => undefined);
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId },
      { status: taskCommandStatus(result.error.code) });
  }
  const update = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
  return NextResponse.json({ data: { update }, requestId: auth.requestId });
}
