import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const allowedCvTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const maxCvBytes = 10 * 1024 * 1024;

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "cv";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  let slug = "";
  let candidateName = "";
  let email = "";
  let phone = "";
  let answers: Record<string, string> = {};
  let cvFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    slug = String(formData.get("slug") || "").trim();
    candidateName = String(formData.get("candidate_name") || "").trim();
    email = normalizeEmail(String(formData.get("email") || ""));
    phone = String(formData.get("phone") || "").trim();
    const answersRaw = String(formData.get("answers") || "{}");
    try {
      answers = JSON.parse(answersRaw) as Record<string, string>;
    } catch {
      return NextResponse.json({ error: "إجابات نموذج التقديم غير صالحة" }, { status: 400 });
    }
    const file = formData.get("cv");
    cvFile = file instanceof File && file.size > 0 ? file : null;
  } else {
    const body = (await request.json().catch(() => ({}))) as {
      slug?: string;
      candidate_name?: string;
      email?: string;
      phone?: string;
      answers?: Record<string, string>;
      cv_url?: string;
    };
    slug = String(body.slug || "").trim();
    candidateName = String(body.candidate_name || "").trim();
    email = normalizeEmail(String(body.email || ""));
    phone = String(body.phone || "").trim();
    answers = body.answers || {};
  }

  if (!slug) return NextResponse.json({ error: "رابط الوظيفة مطلوب" }, { status: 400 });
  if (candidateName.length < 2) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
  if (!email || !email.includes("@")) return NextResponse.json({ error: "البريد الإلكتروني مطلوب" }, { status: 400 });
  if (cvFile && (cvFile.size > maxCvBytes || !allowedCvTypes.has(cvFile.type))) {
    return NextResponse.json({ error: "السيرة الذاتية يجب أن تكون PDF أو Word وأقل من 10MB." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: posting, error: postingError } = await admin
    .from("job_postings")
    .select("id, org_id, status, title, deadline, created_by")
    .eq("public_slug", slug)
    .maybeSingle();

  if (postingError || !posting) {
    return NextResponse.json({ error: "الوظيفة غير موجودة" }, { status: 404 });
  }

  const p = posting as Record<string, unknown>;
  const postingStatus = String(p.status || "");
  if (!["active", "published", "open"].includes(postingStatus)) {
    return NextResponse.json({ error: "هذه الوظيفة لم تعد متاحة للتقديم" }, { status: 400 });
  }

  if (p.deadline && new Date(String(p.deadline)) < new Date()) {
    return NextResponse.json({ error: "انتهى الموعد النهائي لهذه الوظيفة" }, { status: 400 });
  }

  const { data: existing } = await admin
    .from("job_applications")
    .select("id")
    .eq("job_posting_id", String(p.id))
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "تم إرسال طلب سابق بنفس البريد الإلكتروني لهذه الوظيفة" }, { status: 409 });
  }

  let cvUrl: string | null = null;
  if (cvFile) {
    const filename = safeFilename(cvFile.name);
    const path = `cv/${String(p.id)}/${Date.now()}-${filename}`;
    const upload = await admin.storage.from("recruitment").upload(path, cvFile, {
      contentType: cvFile.type,
      upsert: false,
    });
    if (upload.error) {
      return NextResponse.json({ error: "تعذر رفع السيرة الذاتية. يرجى المحاولة مرة أخرى." }, { status: 500 });
    }
    cvUrl = admin.storage.from("recruitment").getPublicUrl(path).data.publicUrl;
  }

  const { data: application, error: insertError } = await admin
    .from("job_applications")
    .insert({
      org_id: p.org_id,
      job_posting_id: p.id,
      candidate_id: null,
      candidate_name: candidateName,
      email,
      phone: phone || null,
      status: "submitted",
      answers,
      cv_url: cvUrl,
      resume_url: cvUrl,
      stage_history: [
        { stage: "submitted", changed_by: null, changed_at: new Date().toISOString(), note: "تم التقديم من الرابط العام" },
      ],
    } as never)
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (p.created_by) {
    await admin.from("notifications").insert({
      org_id: p.org_id,
      user_id: p.created_by,
      title: "تقديم جديد على وظيفة",
      body: `قدم ${candidateName} على وظيفة "${String(p.title || "")}"`,
      type: "recruitment",
      link: `/recruitment/${String(p.id)}`,
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data: application }, { status: 201 });
}
