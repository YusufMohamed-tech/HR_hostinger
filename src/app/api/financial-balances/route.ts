import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
const schema = z.object({
  command_id: z.string().uuid(), balance_id: z.string().uuid(), employee_id: z.string().uuid(),
  balance_type: z.enum(["deficit", "loan", "advance_payment", "reimbursement"]),
  amount: z.coerce.number().positive().max(999_999_999_999), description: z.string().trim().max(2000).optional(),
});
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

function statusFor(code?: string) {
  if (code === "42501") return 403; if (code === "P0002") return 404;
  if (["23505", "40001"].includes(code || "")) return 409;
  if (["23514", "22023"].includes(code || "")) return 422; return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"] }, request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(["command_id", "balance_id", "employee_id", "balance_type", "amount", "description"]
    .map((key) => [key, form.get(key)])));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Balance is invalid.", requestId: auth.requestId }, { status: 400 });
  const fileValue = form.get("attachment");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  let path = "";
  try {
    let attachment: Record<string, unknown> | null = null;
    if (file) {
      const inspected = await inspectUpload(file, { allowedMimeTypes: allowedTypes, maxBytes: 10 * 1024 * 1024 });
      const filename = file.name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "attachment";
      path = `balances/${auth.orgId}/${parsed.data.balance_id}/${parsed.data.command_id}/${crypto.randomUUID()}-${filename}`;
      const upload = await auth.admin.storage.from("balance-attachments").upload(path, inspected.bytes,
        { contentType: inspected.detectedMime, upsert: false });
      if (upload.error) throw new Error(upload.error.message);
      attachment = { path, filename, type: inspected.detectedMime, size_bytes: file.size,
        sha256: inspected.sha256, scan_status: inspected.scanStatus, scan_engine: inspected.engine,
        scanned_at: inspected.scannedAt };
    }
    const result = await (auth.admin as unknown as RpcClient).rpc("create_financial_balance", {
      p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id, p_balance_id: parsed.data.balance_id,
      p_employee_id: parsed.data.employee_id, p_balance_type: parsed.data.balance_type,
      p_amount: parsed.data.amount, p_description: parsed.data.description || null, p_attachment: attachment,
    });
    if (result.error) {
      if (path) await removeUploadedPaths(auth.admin, "balance-attachments", [path]).catch(() => undefined);
      return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: statusFor(result.error.code) });
    }
    const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
    return NextResponse.json({ data, requestId: auth.requestId }, { status: 201 });
  } catch (error) {
    if (path) await removeUploadedPaths(auth.admin, "balance-attachments", [path]).catch(() => undefined);
    const message = error instanceof UploadSecurityError ? error.message : error instanceof Error ? error.message : "Balance creation failed.";
    return NextResponse.json({ message, requestId: auth.requestId }, { status: 422 });
  }
}
