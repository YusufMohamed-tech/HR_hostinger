import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFormFiles, uploadTaskAttachments, validateTaskAttachments } from "@/lib/server/task-attachments";
import { removeUploadedPaths } from "@/lib/server/upload-security";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const schema = z.object({
  task_id: z.string().uuid(),
  command_id: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
});

function responseStatus(code?: string) {
  if (code === "P0002") return 404;
  if (code === "40001" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "23514" || code === "22023") return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr" }, request);
  if ("error" in auth) return auth.error;

  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    files = getFormFiles(formData);
    body = {};
    for (const key of ["task_id", "command_id", "note", "progress"]) {
      const val = formData.get(key);
      if (val !== null) body[key] = val;
    }
  } else {
    body = await request.json().catch(() => ({}));
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success || (!parsed.data?.note && files.length === 0)) {
    return NextResponse.json(
      { message: "A valid task, command id, and note or attachment are required.", requestId: auth.requestId },
      { status: 400 }
    );
  }

  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) {
    return NextResponse.json({ message: attachmentError, requestId: auth.requestId }, { status: 400 });
  }

  const task = await auth.admin.from("tasks").select("id")
    .eq("org_id", auth.orgId).eq("id", parsed.data.task_id).maybeSingle();
  if (task.error) {
    return NextResponse.json({ message: task.error.message, requestId: auth.requestId }, { status: 500 });
  }
  if (!task.data) {
    return NextResponse.json({ message: "Task was not found.", requestId: auth.requestId }, { status: 404 });
  }

  const upload = await uploadTaskAttachments(auth.admin, {
    orgId: auth.orgId,
    taskId: parsed.data.task_id,
    uploadScopeId: parsed.data.command_id,
    files,
  });
  if (upload.error || !upload.data) {
    return NextResponse.json(
      { message: upload.error?.message || "Attachment upload failed.", requestId: auth.requestId },
      { status: 500 }
    );
  }

  const result = await (auth.admin as unknown as RpcClient).rpc("add_task_update", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_task_id: parsed.data.task_id,
    p_note: parsed.data.note || null,
    p_progress: parsed.data.progress ?? null,
    p_attachments: upload.data,
  });
  if (result.error) {
    await removeUploadedPaths(auth.admin, "task-attachments", upload.paths).catch(() => undefined);
    return NextResponse.json(
      { message: result.error.message, requestId: auth.requestId },
      { status: responseStatus(result.error.code) }
    );
  }

  const update = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
  return NextResponse.json({ data: { update }, requestId: auth.requestId });
}
