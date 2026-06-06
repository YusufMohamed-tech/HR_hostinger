import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const STAGE_LABELS: Record<string, string> = {
  submitted: "مُقدَّم",
  screening: "قيد المراجعة",
  shortlisted: "مختصر",
  interview: "مقابلة",
  technical_test: "اختبار تقني",
  offer: "عرض وظيفي",
  hired: "مقبول",
  rejected: "مرفوض",
};

async function authorizeRecruiter() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  const m = membership as { org_id: string; role: string } | null;
  if (!m || !["hr_recruitment", "hr_admin", "admin", "super_admin"].includes(m.role)) return null;
  return { userId: user.id, orgId: m.org_id, role: m.role };
}

function isRecruiterOnly(role: string) {
  return role === "hr_recruitment";
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = (await request.json()) as { stage: string; note?: string };
  if (!body.stage) return NextResponse.json({ error: "المرحلة مطلوبة" }, { status: 400 });

  const admin = createAdminClient();

  const { data: app, error: fetchError } = await admin
    .from("job_applications")
    .select("*, job:job_posting_id(title, created_by)")
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (fetchError || !app) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  const application = app as Record<string, unknown>;
  const postingForAccess = application.job as Record<string, unknown> | null;
  if (isRecruiterOnly(auth.role) && String(postingForAccess?.created_by || "") !== auth.userId) {
    return NextResponse.json({ error: "غير مصرح لك بتعديل هذا الطلب" }, { status: 403 });
  }
  const currentHistory = Array.isArray(application.stage_history)
    ? (application.stage_history as unknown[])
    : [];

  const newEntry = {
    stage: body.stage,
    changed_by: auth.userId,
    changed_at: new Date().toISOString(),
    note: body.note || null,
  };

  const { data: updated, error: updateError } = await admin
    .from("job_applications")
    .update({
      status: body.stage,
      stage_history: [...currentHistory, newEntry],
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", params.id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const candidateId = application.candidate_id as string | null;
  if (candidateId) {
    const posting = application.job as Record<string, unknown> | null;
    const stageLabel = STAGE_LABELS[body.stage] || body.stage;
    await admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: candidateId,
      title: "تحديث حالة طلبك",
      body: `تم تحديث حالة طلبك على وظيفة "${String(posting?.title || "")}" إلى: ${stageLabel}`,
      type: "recruitment",
      link: "/candidate/applications",
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data: updated });
}
