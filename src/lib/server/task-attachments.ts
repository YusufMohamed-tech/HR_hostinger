const allowedAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/pdf",
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

export async function uploadTaskUpdateAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  values: {
    taskId: string;
    updateId: string;
    files: File[];
  }
) {
  const attachments: Record<string, unknown>[] = [];

  for (const file of values.files) {
    const filename = safeFilename(file.name);
    const path = `${values.taskId}/${values.updateId}/${Date.now()}-${filename}`;
    const upload = await admin.storage
      .from("task-attachments")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (upload.error) {
      return {
        data: null,
        error: { message: "فشل رفع الملف. يرجى المحاولة مرة أخرى." },
      };
    }

    const publicUrl = admin.storage.from("task-attachments").getPublicUrl(path).data.publicUrl;
    attachments.push({ filename, url: publicUrl, type: file.type, size_bytes: file.size });
  }

  if (attachments.length === 0) {
    return { data: [], error: null };
  }

  const updateResult = await admin
    .from("task_updates")
    .update({ attachments } as never)
    .eq("id", values.updateId)
    .select()
    .single();

  if (updateResult.error) {
    return { data: null, error: updateResult.error };
  }

  return { data: attachments, error: null };
}
