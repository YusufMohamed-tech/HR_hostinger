import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TYPE_LABELS: Record<string, string> = {
  in_person: "حضوري",
  video: "عن بُعد",
  phone: "هاتفي",
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
  return { userId: user.id, orgId: m.org_id };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const appId = searchParams.get("application_id");
  if (!appId) return NextResponse.json({ error: "application_id مطلوب" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("interviews")
    .select("*")
    .eq("job_application_id", appId)
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = (await request.json()) as {
    application_id: string;
    scheduled_at: string;
    type: string;
    location?: string;
    notes?: string;
  };

  if (!body.application_id || !body.scheduled_at) {
    return NextResponse.json({ error: "بيانات المقابلة غير مكتملة" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: app, error: appError } = await admin
    .from("job_applications")
    .select("*, job:job_posting_id(title)")
    .eq("id", body.application_id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (appError || !app) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
  const application = app as Record<string, unknown>;

  const { data: interview, error } = await admin
    .from("interviews")
    .insert({
      org_id: auth.orgId,
      job_application_id: body.application_id,
      interview_date: body.scheduled_at,
      scheduled_at: body.scheduled_at,
      type: body.type || null,
      location: body.location || null,
      notes: body.notes || null,
      created_by: auth.userId,
      result: "pending",
    } as never)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const currentHistory = Array.isArray(application.stage_history)
    ? (application.stage_history as unknown[])
    : [];
  await admin.from("job_applications").update({
    status: "interview",
    stage_history: [
      ...currentHistory,
      { stage: "interview", changed_by: auth.userId, changed_at: new Date().toISOString(), note: "تم جدولة مقابلة" },
    ],
    updated_at: new Date().toISOString(),
  } as never).eq("id", body.application_id);

  const candidateId = application.candidate_id as string | null;
  if (candidateId) {
    const posting = application.job as Record<string, unknown> | null;
    const scheduledDate = new Date(body.scheduled_at).toLocaleDateString("ar-SA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const typeLabel = TYPE_LABELS[body.type] || body.type;
    await admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: candidateId,
      title: "تم جدولة مقابلة",
      body: `تمت جدولة مقابلة ${typeLabel} لوظيفة "${String(posting?.title || "")}" بتاريخ ${scheduledDate}`,
      type: "recruitment",
      link: "/candidate/applications",
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data: interview }, { status: 201 });
}
