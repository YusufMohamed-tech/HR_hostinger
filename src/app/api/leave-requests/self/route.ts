import { NextRequest, NextResponse } from "next/server";
import { getValidationMessage, leaveRequestFormSchema } from "@/lib/validation";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";

const allowedSelfServiceRoles = new Set(["employee", "training_manager", "hr_admin", "hr_recruitment", "sales", "sales_manager"]);
const allowedLeaveAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const maxLeaveAttachmentBytes = 10 * 1024 * 1024;

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "attachment";
}

function statusFor(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23P01" || code === "23505" || code === "40001") return 409;
  if (code === "23514" || code === "22023") return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;
  if (!allowedSelfServiceRoles.has(auth.role)) {
    return NextResponse.json({ message: "Self-service leave requests are not available for this role.", requestId: auth.requestId }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") || "";
  let attachment: File | null = null;
  let raw: Record<string, unknown>;
  let commandId = crypto.randomUUID();
  let rowId = crypto.randomUUID();
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    raw = Object.fromEntries(["leave_type", "start_date", "end_date", "reason"]
      .map((key) => [key, String(form.get(key) || "")]));
    const file = form.get("attachment");
    if (file instanceof File && file.size > 0) attachment = file;
    if (typeof form.get("command_id") === "string" && /^[0-9a-f-]{36}$/i.test(String(form.get("command_id")))) commandId = String(form.get("command_id"));
    if (typeof form.get("row_id") === "string" && /^[0-9a-f-]{36}$/i.test(String(form.get("row_id")))) rowId = String(form.get("row_id"));
  } else {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    raw = { leave_type: body.leave_type, start_date: body.start_date, end_date: body.end_date, reason: body.reason };
    if (typeof body.command_id === "string" && /^[0-9a-f-]{36}$/i.test(body.command_id)) commandId = body.command_id;
    if (typeof body.row_id === "string" && /^[0-9a-f-]{36}$/i.test(body.row_id)) rowId = body.row_id;
  }
  const parsed = leaveRequestFormSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ message: getValidationMessage(parsed.error), requestId: auth.requestId }, { status: 400 });
  }

  let uploadedPath = "";
  try {
    let attachmentName: string | null = null;
    if (attachment) {
      const inspected = await inspectUpload(attachment, {
        allowedMimeTypes: allowedLeaveAttachmentTypes,
        maxBytes: maxLeaveAttachmentBytes,
      });
      attachmentName = safeFilename(attachment.name);
      uploadedPath = `leave-requests/${auth.orgId}/${auth.employeeId}/${commandId}/${crypto.randomUUID()}-${attachmentName}`;
      const upload = await auth.admin.storage.from("balance-attachments").upload(uploadedPath, inspected.bytes, {
        contentType: inspected.detectedMime,
        upsert: false,
      });
      if (upload.error) throw new Error(upload.error.message);
    }
    const result = await (auth.admin as unknown as RpcClient).rpc("submit_leave_request", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: commandId,
      p_leave_request_id: rowId,
      p_employee_id: auth.employeeId,
      p_leave_type: parsed.data.leave_type,
      p_start_date: parsed.data.start_date,
      p_end_date: parsed.data.end_date,
      p_reason: parsed.data.reason || null,
      p_attachment_path: uploadedPath || null,
      p_attachment_name: attachmentName,
    });
    if (result.error) {
      if (uploadedPath) await removeUploadedPaths(auth.admin, "balance-attachments", [uploadedPath]).catch(() => undefined);
      return NextResponse.json(
        { message: result.error.code === "23P01" ? "This leave period overlaps another pending or approved request." : result.error.message,
          requestId: auth.requestId },
        { status: statusFor(result.error.code) },
      );
    }
    const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
    return NextResponse.json({ request: data, requestId: auth.requestId }, { status: 201 });
  } catch (error) {
    if (uploadedPath) await removeUploadedPaths(auth.admin, "balance-attachments", [uploadedPath]).catch(() => undefined);
    const message = error instanceof UploadSecurityError ? error.message
      : error instanceof Error ? error.message : "Leave submission failed.";
    return NextResponse.json({ message, requestId: auth.requestId }, { status: 422 });
  }
}
