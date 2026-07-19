import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFormFiles, uploadTaskAttachments, validateTaskAttachments } from "@/lib/server/task-attachments";
import { removeUploadedPaths } from "@/lib/server/upload-security";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const schema = z.object({
  assignment_id: z.string().uuid(),
  expected_version: z.coerce.number().int().positive(),
  command_id: z.string().uuid(),
  status: z.enum(["in_progress", "completed", "rejected", "delayed"]),
  note: z.string().trim().max(2000).optional(),
});

function status(code?: string) {
  if (code === "40001" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "23514" || code === "22023") return 422;
  return 500;
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;
  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    files = getFormFiles(formData);
    body = Object.fromEntries(["assignment_id", "expected_version", "command_id", "status", "note"]
      .map((key) => [key, formData.get(key)]));
  } else body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: "Task transition data is invalid.", requestId: auth.requestId }, { status: 400 });
  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) return NextResponse.json({ message: attachmentError, requestId: auth.requestId }, { status: 400 });
  const assignment = await auth.admin.from("task_assignments").select("task_id")
    .eq("org_id", auth.orgId).eq("id", parsed.data.assignment_id).eq("employee_id", auth.employeeId).maybeSingle();
  if (assignment.error) return NextResponse.json({ message: assignment.error.message, requestId: auth.requestId }, { status: 500 });
  if (!assignment.data) return NextResponse.json({ message: "Task assignment was not found.", requestId: auth.requestId }, { status: 404 });
  const upload = await uploadTaskAttachments(auth.admin, { orgId: auth.orgId, taskId: assignment.data.task_id,
    uploadScopeId: parsed.data.command_id, files });
  if (upload.error || !upload.data) return NextResponse.json({ message: upload.error?.message || "Attachment upload failed.", requestId: auth.requestId }, { status: 500 });
  const result = await (auth.admin as unknown as RpcClient).rpc("transition_task_assignment", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id, p_assignment_id: parsed.data.assignment_id,
    p_expected_version: parsed.data.expected_version, p_target_status: parsed.data.status,
    p_note: parsed.data.note || null, p_attachments: upload.data,
  });
  if (result.error) {
    await removeUploadedPaths(auth.admin, "task-attachments", upload.paths).catch(() => undefined);
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: status(result.error.code) });
  }
  return NextResponse.json({ data: result.data, requestId: auth.requestId });
}
