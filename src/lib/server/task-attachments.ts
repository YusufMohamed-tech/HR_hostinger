import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";
import { createObjectAccessUrl, storeObject } from "@/lib/server/file-storage";

const allowedAttachmentTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const maxAttachmentBytes = 10 * 1024 * 1024;

export function getFormFiles(formData: FormData, key = "attachments") {
  return formData.getAll(key).filter((item): item is File => item instanceof File && item.size > 0);
}

export function validateTaskAttachments(files: File[]) {
  for (const file of files) {
    if (file.size > maxAttachmentBytes || !allowedAttachmentTypes.has(file.type)) {
      return "نوع الملف غير مدعوم أو حجمه أكبر من 10MB.";
    }
  }
  return null;
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "attachment";
}

export async function uploadTaskAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  values: { orgId: string; taskId: string; uploadScopeId: string; files: File[] }
) {
  const attachments: Record<string, unknown>[] = [];
  const paths: string[] = [];
  try {
    for (const file of values.files) {
      const inspected = await inspectUpload(file, { allowedMimeTypes: allowedAttachmentTypes, maxBytes: maxAttachmentBytes });
      const filename = safeFilename(file.name);
      const path = `${values.orgId}/${values.taskId}/${values.uploadScopeId}/${crypto.randomUUID()}-${filename}`;
      await storeObject(admin, {
        bucket: "task-attachments", path, bytes: inspected.bytes,
        contentType: inspected.detectedMime, upsert: false,
      });
      paths.push(path);
      attachments.push({ bucket: "task-attachments", path, filename,
        url: createObjectAccessUrl("task-attachments", path, { expiresIn: 3600 }),
        type: inspected.detectedMime, size_bytes: file.size, sha256: inspected.sha256,
        scan_status: inspected.scanStatus, scan_engine: inspected.engine, scanned_at: inspected.scannedAt });
    }
    return { data: attachments, paths, error: null };
  } catch (error) {
    await removeUploadedPaths(admin, "task-attachments", paths).catch(() => undefined);
    return { data: null, paths: [], error: { message: error instanceof UploadSecurityError
      ? error.message : error instanceof Error ? error.message : "فشل رفع الملف. يرجى المحاولة مرة أخرى." } };
  }
}

export async function uploadTaskUpdateAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  values: { orgId: string; taskId: string; updateId: string; files: File[] }
) {
  const upload = await uploadTaskAttachments(admin, {
    orgId: values.orgId, taskId: values.taskId, uploadScopeId: values.updateId, files: values.files,
  });
  if (upload.error || !upload.data) return { data: null, error: upload.error };
  if (upload.data.length === 0) return { data: [], error: null };
  const updateResult = await admin.from("task_updates").update({ attachments: upload.data } as never)
    .eq("id", values.updateId).select().single();
  if (updateResult.error) {
    await removeUploadedPaths(admin, "task-attachments", upload.paths).catch(() => undefined);
    return { data: null, error: updateResult.error };
  }
  return { data: upload.data, error: null };
}
