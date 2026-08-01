import { NextRequest, NextResponse } from "next/server";
import { productReturnSubmissionManifestSchema } from "@/lib/product-inventory/schemas";
import { executeProductReturnCommand, productInventoryError } from "@/lib/server/product-inventory-api";
import { requireProductInventoryReturnAccess } from "@/lib/server/product-inventory-auth";
import { loadProductReturnWorkspace } from "@/lib/server/product-inventory-returns";
import { storeObject, removeObjects } from "@/lib/server/file-storage";
import { inspectUpload, UploadSecurityError } from "@/lib/server/upload-security";

const evidenceBucket = "product-return-evidence";
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 8 * 1024 * 1024;
const maxTotalBytes = 40 * 1024 * 1024;

function safeFilename(value: string) {
  return value.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/gu, "_").slice(0, 160) || "return-photo";
}

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryReturnAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const data = await loadProductReturnWorkspace(auth.admin, {
      orgId: auth.orgId,
      userId: auth.user.id,
      role: auth.role,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل دورة المرتجعات.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryReturnAccess(request);
  if ("error" in auth) return auth.error;
  const uploadedPaths: string[] = [];
  try {
    const formData = await request.formData();
    const manifestValue = JSON.parse(String(formData.get("manifest") || "{}")) as unknown;
    const parsed = productReturnSubmissionManifestSchema.safeParse(manifestValue);
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues[0]?.message || "بيانات طلب المرتجع غير صالحة." },
        { status: 400 }
      );
    }
    const photos = parsed.data.lines.flatMap((line) => line.photos.map((photo) => ({ line, photo })));
    const files = photos.map(({ photo }) => formData.get(photo.field));
    if (files.some((file) => !(file instanceof File))) {
      return NextResponse.json({ message: "كل سيريال مرتجع يحتاج صورة إثبات صالحة." }, { status: 400 });
    }
    const typedFiles = files as File[];
    if (typedFiles.reduce((total, file) => total + file.size, 0) > maxTotalBytes) {
      return NextResponse.json({ message: "إجمالي صور المرتجع يتجاوز 40MB." }, { status: 400 });
    }
    const inspected = await Promise.all(
      typedFiles.map((file) => inspectUpload(file, { allowedMimeTypes, maxBytes }))
    );
    const attachmentsByLine = new Map<string, Array<Record<string, unknown>>>();
    for (let index = 0; index < photos.length; index += 1) {
      const item = photos[index];
      const file = typedFiles[index];
      const scan = inspected[index];
      if (!item || !file || !scan) throw new Error("Return photo inspection result is incomplete.");
      const filename = safeFilename(file.name);
      const objectPath = `${auth.orgId}/${parsed.data.return_request_id}/${item.line.line_id}/${item.photo.managed_file_id}-${filename}`;
      const stored = await storeObject(auth.admin, {
        bucket: evidenceBucket,
        path: objectPath,
        bytes: scan.bytes,
        contentType: scan.detectedMime,
      });
      uploadedPaths.push(stored.path);
      const attachments = attachmentsByLine.get(item.line.line_id) ?? [];
      attachments.push({
        attachment_id: item.photo.attachment_id,
        managed_file_id: item.photo.managed_file_id,
        captured_at: item.photo.captured_at,
        file: {
          bucket: evidenceBucket,
          path: stored.path,
          filename,
          type: scan.detectedMime,
          size_bytes: file.size,
          sha256: scan.sha256,
          scan_status: scan.scanStatus,
          scan_engine: scan.engine,
          scanned_at: scan.scannedAt,
          provider: stored.provider,
        },
      });
      attachmentsByLine.set(item.line.line_id, attachments);
    }
    const data = await executeProductReturnCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId: parsed.data.command_id,
      action: "return_request_submit",
      payload: {
        return_request_id: parsed.data.return_request_id,
        warehouse_id: parsed.data.warehouse_id,
        reason_summary: parsed.data.reason_summary,
        lines: parsed.data.lines.map((line) => ({
          line_id: line.line_id,
          unit_id: line.unit_id,
          requester_note: line.requester_note,
          claimed_condition: line.claimed_condition,
          attachments: attachmentsByLine.get(line.line_id) ?? [],
        })),
      },
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await removeObjects(auth.admin, evidenceBucket, uploadedPaths).catch((cleanupError) => {
        console.error("Product return evidence cleanup failed", { requestId: auth.requestId, cleanupError });
      });
    }
    if (error instanceof UploadSecurityError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.code === "scanner_unavailable" ? 503 : 400 }
      );
    }
    return productInventoryError(error, "تعذر إرسال طلب المرتجع.");
  }
}
