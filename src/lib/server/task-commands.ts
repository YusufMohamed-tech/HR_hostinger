import { uploadTaskAttachments } from "@/lib/server/task-attachments";
import { removeUploadedPaths } from "@/lib/server/upload-security";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export function taskCommandStatus(code?: string) {
  if (code === "P0002") return 404;
  if (code === "40001" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "23514" || code === "22023") return 422;
  return 500;
}

export async function executeTaskSave(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    taskId: string;
    expectedVersion?: number;
    title: string;
    description?: string;
    priority: string;
    dueDate?: string;
    assigneeEmployeeId: string;
    note?: string;
    files: File[];
  }
) {
  const upload = await uploadTaskAttachments(admin, {
    orgId: values.orgId,
    taskId: values.taskId,
    uploadScopeId: values.commandId,
    files: values.files,
  });
  if (upload.error || !upload.data) {
    return { data: null, error: upload.error || { message: "Attachment upload failed." }, paths: [] };
  }

  const result = await (admin as RpcClient).rpc("save_task", {
    p_org_id: values.orgId,
    p_actor_user_id: values.actorUserId,
    p_request_id: values.requestId,
    p_command_id: values.commandId,
    p_task_id: values.taskId,
    p_expected_version: values.expectedVersion ?? null,
    p_title: values.title,
    p_description: values.description || null,
    p_priority: values.priority,
    p_due_date: values.dueDate || null,
    p_assignee_employee_id: values.assigneeEmployeeId,
    p_note: values.note || null,
    p_attachments: upload.data,
  });
  if (result.error) {
    await removeUploadedPaths(admin, "task-attachments", upload.paths).catch(() => undefined);
    return { data: null, error: result.error, paths: [] };
  }
  return { data: result.data, error: null, paths: upload.paths };
}
