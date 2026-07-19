import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { recruitmentFormSchema, validatePublicApplicationAnswers } from "@/lib/recruitment-form";
import { businessDateAt } from "@/lib/business-time";
import { inspectUpload, removeUploadedPaths, UploadSecurityError } from "@/lib/server/upload-security";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/lib/server/rate-limit";
import { requestIdFromHeaders } from "@/lib/request-id";

const allowedCvTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const maxCvBytes = 10 * 1024 * 1024;
const allowedAnswerFileTypes = new Set([
  ...allowedCvTypes,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
]);
const maxAnswerFileBytes = 10 * 1024 * 1024;
const maxAnswerFileCount = 10;
const maxAnswerFilesTotalBytes = 50 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "cv";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function parsedAnswers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([key, answer]) => /^[A-Za-z0-9_-]{1,80}$/u.test(key) && typeof answer === "string")) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function response(error: string, requestId: string, status: number) {
  return NextResponse.json(
    { error, requestId },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const contentType = request.headers.get("content-type") || "";
  let slug = "";
  let candidateName = "";
  let email = "";
  let phone = "";
  let answers: Record<string, string> = {};
  let cvFile: File | null = null;
  let applicationId = "";
  let commandId = "";
  const answerFiles = new Map<string, File>();

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData().catch(() => null);
    if (!formData) return response("بيانات نموذج التقديم غير صالحة", requestId, 400);
    slug = String(formData.get("slug") || "").trim();
    candidateName = String(formData.get("candidate_name") || "").trim();
    email = normalizeEmail(String(formData.get("email") || ""));
    phone = String(formData.get("phone") || "").trim();
    applicationId = String(formData.get("application_id") || "").trim();
    commandId = String(formData.get("command_id") || "").trim();
    const answersRaw = String(formData.get("answers") || "{}");
    try {
      const candidate = parsedAnswers(JSON.parse(answersRaw));
      if (!candidate) return response("إجابات نموذج التقديم غير صالحة", requestId, 400);
      answers = candidate;
    } catch {
      return response("إجابات نموذج التقديم غير صالحة", requestId, 400);
    }
    const file = formData.get("cv");
    cvFile = file instanceof File && file.size > 0 ? file : null;
    formData.forEach((value, key) => {
      if (!key.startsWith("answer_file:") || !(value instanceof File) || value.size <= 0) return;
      answerFiles.set(key.slice("answer_file:".length), value);
    });
  } else {
    const body = (await request.json().catch(() => ({}))) as {
      slug?: string;
      candidate_name?: string;
      email?: string;
      phone?: string;
      answers?: Record<string, string>;
      cv_url?: string;
      application_id?: string;
      command_id?: string;
    };
    slug = String(body.slug || "").trim();
    candidateName = String(body.candidate_name || "").trim();
    email = normalizeEmail(String(body.email || ""));
    phone = String(body.phone || "").trim();
    const candidate = parsedAnswers(body.answers || {});
    if (!candidate) return response("إجابات نموذج التقديم غير صالحة", requestId, 400);
    answers = candidate;
    applicationId = String(body.application_id || "").trim();
    commandId = String(body.command_id || "").trim();
  }

  if (!slug || slug.length > 160) return response("رابط الوظيفة مطلوب", requestId, 400);
  if (candidateName.length < 2 || candidateName.length > 200) return response("الاسم مطلوب", requestId, 400);
  if (!email || !email.includes("@") || email.length > 320) return response("البريد الإلكتروني مطلوب", requestId, 400);
  if (phone.length > 40) return response("رقم الجوال غير صالح", requestId, 400);
  if (!uuidPattern.test(applicationId) || !uuidPattern.test(commandId)) {
    return response("معرّف طلب التقديم غير صالح", requestId, 400);
  }
  if (JSON.stringify(answers).length > 65_536) {
    return response("إجابات نموذج التقديم غير صالحة", requestId, 400);
  }
  if (answerFiles.size > maxAnswerFileCount
      || [...answerFiles.values()].reduce((total, file) => total + file.size, 0) > maxAnswerFilesTotalBytes) {
    return response("عدد أو حجم مرفقات نموذج التقديم أكبر من المسموح", requestId, 413);
  }

  try {
    const rate = await consumeRateLimit({
      scope: "candidate:application",
      identifier: `${requestIp(request)}:${slug}:${email}`,
      limit: 5,
      windowSeconds: 3600,
      blockSeconds: 3600,
    });
    if (!rate.allowed) return rateLimitResponse(rate, requestId);
  } catch (error) {
    console.error("Candidate application protection unavailable", { requestId, error });
    return response("التقديم غير متاح مؤقتًا.", requestId, 503);
  }

  const admin = createAdminClient();
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const candidateUserId = user?.email?.trim().toLowerCase() === email ? user.id : null;
  const { data: posting, error: postingError } = await admin
    .from("job_postings")
    .select("id, org_id, status, deadline, form_schema")
    .eq("public_slug", slug)
    .maybeSingle();

  if (postingError || !posting) {
    return response("الوظيفة غير موجودة", requestId, 404);
  }

  const p = posting as Record<string, unknown>;
  const postingStatus = String(p.status || "");
  if (!["active", "published", "open"].includes(postingStatus)) {
    return response("هذه الوظيفة لم تعد متاحة للتقديم", requestId, 400);
  }

  const settings = await admin.from("organization_settings").select("timezone")
    .eq("org_id", String(p.org_id)).maybeSingle();
  if (settings.error || !settings.data?.timezone) {
    console.error("Candidate application business-time lookup failed", { requestId, code: settings.error?.code });
    return response("التقديم غير متاح مؤقتًا.", requestId, 503);
  }
  if (p.deadline && String(p.deadline) < businessDateAt(new Date(), settings.data.timezone)) {
    return response("انتهى الموعد النهائي لهذه الوظيفة", requestId, 400);
  }

  const formSchema = recruitmentFormSchema.safeParse(p.form_schema || []);
  if (!formSchema.success) return response("نموذج الوظيفة غير صالح مؤقتًا", requestId, 409);
  const answerValidation = validatePublicApplicationAnswers(formSchema.data, answers, new Set(answerFiles.keys()));
  if (!answerValidation.valid) return response("إجابات نموذج التقديم غير صالحة أو ناقصة", requestId, 422);

  let cvMetadata: Record<string, unknown> | null = null;
  const uploadedNewPaths: string[] = [];
  const commandAnswers: Record<string, unknown> = { ...answers };
  if (cvFile) {
    try {
      const inspected = await inspectUpload(cvFile, { allowedMimeTypes: allowedCvTypes, maxBytes: maxCvBytes });
      const filename = safeFilename(cvFile.name);
      const path = `${String(p.org_id)}/cv/${String(p.id)}/${applicationId}/${commandId}/${inspected.sha256}-${filename}`;
      const upload = await admin.storage.from("recruitment").upload(path, inspected.bytes, {
        contentType: inspected.detectedMime,
        upsert: false,
      });
      if (upload.error) {
        const storageError = upload.error as typeof upload.error & { statusCode?: string | number };
        const duplicate = String(storageError.statusCode || "") === "409"
          || /duplicate|already exists/i.test(storageError.message);
        if (!duplicate) throw new Error(upload.error.message);
      } else {
        uploadedNewPaths.push(path);
      }
      cvMetadata = {
        path,
        filename,
        mime: inspected.detectedMime,
        size_bytes: inspected.bytes.byteLength,
        sha256: inspected.sha256,
        scan_status: inspected.scanStatus,
        scan_engine: inspected.engine,
        scanned_at: inspected.scannedAt,
      };
    } catch (error) {
      const detail = error instanceof UploadSecurityError ? error.message : "تعذر رفع السيرة الذاتية. يرجى المحاولة مرة أخرى.";
      await removeUploadedPaths(admin, "recruitment", uploadedNewPaths).catch(() => undefined);
      return response(detail, requestId, error instanceof UploadSecurityError ? 422 : 500);
    }
  }

  for (const [questionId, file] of answerFiles) {
    try {
      const inspected = await inspectUpload(file, { allowedMimeTypes: allowedAnswerFileTypes, maxBytes: maxAnswerFileBytes });
      const filename = safeFilename(file.name);
      const path = `${String(p.org_id)}/application-files/${String(p.id)}/${applicationId}/${questionId}/${inspected.sha256}-${filename}`;
      const upload = await admin.storage.from("recruitment").upload(path, inspected.bytes, {
        contentType: inspected.detectedMime,
        upsert: false,
      });
      if (upload.error) {
        const storageError = upload.error as typeof upload.error & { statusCode?: string | number };
        const duplicate = String(storageError.statusCode || "") === "409"
          || /duplicate|already exists/i.test(storageError.message);
        if (!duplicate) throw new Error(upload.error.message);
      } else {
        uploadedNewPaths.push(path);
      }
      commandAnswers[questionId] = {
        path,
        filename,
        mime: inspected.detectedMime,
        size_bytes: inspected.bytes.byteLength,
        sha256: inspected.sha256,
        scan_status: inspected.scanStatus,
        scan_engine: inspected.engine,
        scanned_at: inspected.scannedAt,
      };
    } catch (error) {
      await removeUploadedPaths(admin, "recruitment", uploadedNewPaths).catch(() => undefined);
      const detail = error instanceof UploadSecurityError ? error.message : "تعذر رفع مرفق نموذج التقديم.";
      return response(detail, requestId, error instanceof UploadSecurityError ? 422 : 500);
    }
  }

  const result = await (admin as unknown as RpcClient).rpc("submit_public_application", {
    p_posting_id: String(p.id),
    p_application_id: applicationId,
    p_command_id: commandId,
    p_request_id: requestId,
    p_candidate_user_id: candidateUserId,
    p_candidate_name: candidateName,
    p_email: email,
    p_phone: phone || null,
    p_answers: commandAnswers,
    p_cv_metadata: cvMetadata,
  });

  if (result.error) {
    await removeUploadedPaths(admin, "recruitment", uploadedNewPaths).catch(() => undefined);
    const status = result.error.code === "P0002" ? 404
      : ["23505", "23514"].includes(result.error.code || "") ? 409
        : result.error.code === "42501" ? 403
          : ["22023", "22P02"].includes(result.error.code || "") ? 422 : 500;
    const duplicate = result.error.code === "23505"
      || /duplicate|normalized_email|already exists/i.test(result.error.message);
    return NextResponse.json({
      error: duplicate ? "تم إرسال طلب سابق بنفس البريد الإلكتروني لهذه الوظيفة" : result.error.message,
      requestId,
    }, { status, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  }

  const application = Array.isArray(result.data) ? result.data[0] : result.data;
  return NextResponse.json(
    { data: application, requestId },
    { status: 201, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
