import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFormFiles, validateTaskAttachments } from "@/lib/server/task-attachments";
import { executeTaskSave, taskCommandStatus } from "@/lib/server/task-commands";
import { requireTenantContext } from "@/lib/server/tenant-context";

const baseSchema = z.object({
  task_id: z.string().uuid(),
  command_id: z.string().uuid(),
  expected_version: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  due_date: z.string().date().optional().or(z.literal("")),
  employee_id: z.string().uuid(),
  initial_message: z.string().trim().max(2000).optional(),
});

async function save(request: NextRequest, mode: "create" | "update") {
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
    body = {};
    for (const key of ["task_id", "command_id", "expected_version", "title", "description", "priority",
      "due_date", "employee_id", "initial_message"]) {
      const val = formData.get(key);
      if (val !== null) body[key] = val;
    }
  } else {
    body = await request.json().catch(() => ({}));
  }
  const parsed = baseSchema.safeParse(body);
  if (!parsed.success || (mode === "create" && parsed.data?.expected_version !== undefined)
      || (mode === "update" && parsed.data?.expected_version === undefined)) {
    return NextResponse.json({ message: "Task command data is invalid.", requestId: auth.requestId }, { status: 400 });
  }
  const attachmentError = validateTaskAttachments(files);
  if (attachmentError) {
    return NextResponse.json({ message: attachmentError, requestId: auth.requestId }, { status: 400 });
  }
  const result = await executeTaskSave(auth.admin, {
    orgId: auth.orgId,
    actorUserId: auth.user.id,
    requestId: auth.requestId,
    commandId: parsed.data.command_id,
    taskId: parsed.data.task_id,
    expectedVersion: parsed.data.expected_version,
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    dueDate: parsed.data.due_date || undefined,
    assigneeEmployeeId: parsed.data.employee_id,
    note: parsed.data.initial_message,
    files,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId },
      { status: taskCommandStatus("code" in result.error ? String(result.error.code || "") : undefined) });
  }
  return NextResponse.json({ data: result.data, requestId: auth.requestId }, { status: mode === "create" ? 201 : 200 });
}

export function POST(request: NextRequest) {
  return save(request, "create");
}

export function PATCH(request: NextRequest) {
  return save(request, "update");
}
