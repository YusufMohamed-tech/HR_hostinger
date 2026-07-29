import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { inspectUpload, UploadSecurityError } from "@/lib/server/upload-security";
import {
  createManagedFileDownloadUrl,
  deleteManagedFile,
  storePersonnelObject,
} from "@/lib/server/personnel-storage";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const maxBytes = 15 * 1024 * 1024;

const fileSchema = z.object({
  mode: z.literal("personnel_file"),
  row_id: z.string().uuid(),
  command_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  category: z.string().trim().min(1).max(120).default("other"),
  expiry_date: z.string().date().optional(),
  notes: z.string().trim().max(2000).optional(),
  onboarding_item_id: z.string().uuid().optional(),
});

const contractSchema = z.object({
  mode: z.literal("employee_contract"),
  row_id: z.string().uuid(),
  command_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  contract_type: z.string().trim().min(1).max(120).default("permanent"),
  start_date: z.string().date(),
  end_date: z.string().date().optional(),
  probation_end_date: z.string().date().optional(),
  salary_at_signing: z.coerce.number().min(0).max(999_999_999_999).optional(),
}).refine((value) => !value.end_date || value.end_date >= value.start_date, {
  message: "Contract end date cannot precede its start date.",
});

function safeFilename(value: string) {
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "document";
}

function statusFor(code?: string) {
  if (code === "P0002") return 404;
  if (code === "40001" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "23514" || code === "22023") return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "personnel" }, request);
  if ("error" in auth) return auth.error;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({
      message: "A personnel document is required.",
      requestId: auth.requestId,
    }, { status: 400 });
  }

  const raw = Object.fromEntries([
    "mode", "row_id", "command_id", "employee_id", "category", "expiry_date",
    "notes", "onboarding_item_id", "contract_type", "start_date", "end_date",
    "probation_end_date", "salary_at_signing",
  ].map((key) => [key, formData.get(key)]));
  for (const key of [
    "expiry_date", "notes", "onboarding_item_id", "end_date",
    "probation_end_date", "salary_at_signing",
  ]) {
    if (!raw[key]) delete raw[key];
  }

  const mode = String(raw.mode || "");
  const parsed = mode === "personnel_file"
    ? fileSchema.safeParse(raw)
    : contractSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      message: parsed.error.issues[0]?.message || "Personnel record is invalid.",
      requestId: auth.requestId,
    }, { status: 400 });
  }

  const employee = await auth.admin.from("employees").select("id").eq("org_id", auth.orgId)
    .eq("id", parsed.data.employee_id).maybeSingle();
  if (employee.error) {
    return NextResponse.json({ message: employee.error.message, requestId: auth.requestId }, { status: 500 });
  }
  if (!employee.data) {
    return NextResponse.json({ message: "Employee was not found.", requestId: auth.requestId }, { status: 404 });
  }

  const isHr = ["admin", "hr_admin"].includes(auth.role);
  if (!isHr && (mode !== "personnel_file" || auth.employeeId !== parsed.data.employee_id)) {
    return NextResponse.json({ message: "File access is forbidden.", requestId: auth.requestId }, { status: 403 });
  }
  const onboardingItemId = mode === "personnel_file"
    ? (parsed.data as z.infer<typeof fileSchema>).onboarding_item_id
    : undefined;
  if (!isHr && !onboardingItemId) {
    return NextResponse.json({
      message: "Employees may upload only a requested onboarding document.",
      requestId: auth.requestId,
    }, { status: 403 });
  }
  if (onboardingItemId) {
    const item = await auth.admin.from("employee_onboarding_items")
      .select("id, employee_id, evidence_kind, employee_can_submit, status")
      .eq("org_id", auth.orgId)
      .eq("id", onboardingItemId)
      .maybeSingle();
    if (item.error) {
      return NextResponse.json({ message: item.error.message, requestId: auth.requestId }, { status: 500 });
    }
    if (!item.data
      || item.data.employee_id !== parsed.data.employee_id
      || item.data.evidence_kind !== "document"
      || (!isHr && item.data.employee_can_submit !== true)
      || (!isHr && !["requested", "rejected"].includes(String(item.data.status)))
      || ["verified", "waived", "not_applicable"].includes(String(item.data.status))) {
      return NextResponse.json({
        message: "Onboarding document request was not found.",
        requestId: auth.requestId,
      }, { status: 404 });
    }
  }

  let stored: Awaited<ReturnType<typeof storePersonnelObject>> | null = null;
  try {
    const inspected = await inspectUpload(file, { allowedMimeTypes, maxBytes });
    const path = `${auth.orgId}/${parsed.data.employee_id}/${parsed.data.command_id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
    stored = await storePersonnelObject(auth.admin, {
      key: path,
      bytes: inspected.bytes,
      contentType: inspected.detectedMime,
      sha256: inspected.sha256,
    });
    const metadata = {
      provider: stored.provider,
      bucket: stored.bucket,
      path: stored.path,
      version: stored.version,
      etag: stored.etag,
      encryption_status: stored.encryptionStatus,
      filename: safeFilename(file.name),
      type: inspected.detectedMime,
      size_bytes: file.size,
      sha256: inspected.sha256,
      scan_status: inspected.scanStatus,
      scan_engine: inspected.engine,
      scanned_at: inspected.scannedAt,
    };
    const common = {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_row_id: parsed.data.row_id,
      p_employee_id: parsed.data.employee_id,
      p_file: metadata,
    };
    const fileData = parsed.data as z.infer<typeof fileSchema>;
    const contractData = parsed.data as z.infer<typeof contractSchema>;
    const result = mode === "personnel_file"
      ? await (auth.admin as unknown as RpcClient).rpc("register_personnel_file", {
          ...common,
          p_category: fileData.category,
          p_expiry_date: fileData.expiry_date || null,
          p_notes: fileData.notes || null,
        })
      : await (auth.admin as unknown as RpcClient).rpc("register_employee_contract", {
          ...common,
          p_contract_type: contractData.contract_type,
          p_start_date: contractData.start_date,
          p_end_date: contractData.end_date || null,
          p_probation_end_date: contractData.probation_end_date || null,
          p_salary: contractData.salary_at_signing ?? null,
        });
    if (result.error) {
      await deleteManagedFile(auth.admin, {
        storage_provider: stored.provider,
        storage_container: stored.bucket,
        storage_path: stored.path,
        storage_version: stored.version,
        bucket_id: "personnel-files",
      }).catch(() => undefined);
      return NextResponse.json({
        message: result.error.message,
        requestId: auth.requestId,
      }, { status: statusFor(result.error.code) });
    }

    const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
    if (onboardingItemId && data && typeof data === "object") {
      const managedFileId = String((data as Record<string, unknown>).managed_file_id || "");
      const attached = await (auth.admin as unknown as RpcClient).rpc("update_employee_onboarding_item", {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_request_id: auth.requestId,
        p_item_id: onboardingItemId,
        p_action: "attach_file",
        p_reason: null,
        p_due_at: null,
        p_managed_file_id: managedFileId,
      });
      if (attached.error) {
        return NextResponse.json({
          message: `File was stored, but the onboarding item could not be linked: ${attached.error.message}`,
          data,
          requestId: auth.requestId,
        }, { status: 409 });
      }
    }
    return NextResponse.json({ data, requestId: auth.requestId }, { status: 201 });
  } catch (error) {
    if (stored) {
      await deleteManagedFile(auth.admin, {
        storage_provider: stored.provider,
        storage_container: stored.bucket,
        storage_path: stored.path,
        storage_version: stored.version,
        bucket_id: "personnel-files",
      }).catch(() => undefined);
    }
    const message = error instanceof UploadSecurityError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Personnel upload failed.";
    const status = error instanceof UploadSecurityError && error.code === "scanner_unavailable"
      ? 503
      : 422;
    return NextResponse.json({ message, requestId: auth.requestId }, { status });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "personnel" }, request);
  if ("error" in auth) return auth.error;
  const id = request.nextUrl.searchParams.get("id") || "";
  const ownerType = request.nextUrl.searchParams.get("owner_type") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)
    || !["personnel_file", "employee_contract", "employee_document"].includes(ownerType)) {
    return NextResponse.json({
      message: "Managed file reference is invalid.",
      requestId: auth.requestId,
    }, { status: 400 });
  }
  const managed = await auth.admin.from("managed_files")
    .select("bucket_id, storage_path, storage_provider, storage_container, storage_version, original_name, employee_id, deleted_at")
    .eq("org_id", auth.orgId)
    .eq("owner_type", ownerType)
    .eq("owner_id", id)
    .maybeSingle();
  if (managed.error) {
    return NextResponse.json({ message: managed.error.message, requestId: auth.requestId }, { status: 500 });
  }
  if (!managed.data || managed.data.deleted_at) {
    return NextResponse.json({ message: "Managed file was not found.", requestId: auth.requestId }, { status: 404 });
  }
  if (!["admin", "hr_admin"].includes(auth.role) && managed.data.employee_id !== auth.employeeId) {
    return NextResponse.json({ message: "File access is forbidden.", requestId: auth.requestId }, { status: 403 });
  }
  try {
    const signedUrl = await createManagedFileDownloadUrl(auth.admin, {
      bucket_id: String(managed.data.bucket_id),
      storage_path: String(managed.data.storage_path),
      storage_provider: typeof managed.data.storage_provider === "string" ? managed.data.storage_provider : null,
      storage_container: typeof managed.data.storage_container === "string" ? managed.data.storage_container : null,
      storage_version: typeof managed.data.storage_version === "string" ? managed.data.storage_version : null,
    }, typeof managed.data.original_name === "string" ? managed.data.original_name : null);
    return NextResponse.json({ data: { signedUrl }, requestId: auth.requestId });
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : "Signed file access failed.",
      requestId: auth.requestId,
    }, { status: 500 });
  }
}
