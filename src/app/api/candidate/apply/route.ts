import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });

  const body = (await request.json()) as {
    slug: string;
    candidate_name: string;
    email: string;
    phone?: string;
    answers: Record<string, string>;
    cv_url?: string;
  };

  if (!body.slug) return NextResponse.json({ error: "رابط الوظيفة مطلوب" }, { status: 400 });
  if (!body.candidate_name) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  const admin = createAdminClient();

  const { data: posting, error: postingError } = await admin
    .from("job_postings")
    .select("id, org_id, status, title, deadline, created_by")
    .eq("public_slug", body.slug)
    .maybeSingle();

  if (postingError || !posting)
    return NextResponse.json({ error: "الوظيفة غير موجودة" }, { status: 404 });

  const p = posting as Record<string, unknown>;

  if (p.status !== "active")
    return NextResponse.json({ error: "هذه الوظيفة لم تعد متاحة للتقديم" }, { status: 400 });

  if (p.deadline && new Date(String(p.deadline)) < new Date())
    return NextResponse.json({ error: "انتهى الموعد النهائي لهذه الوظيفة" }, { status: 400 });

  // Check duplicate
  const { data: existing } = await admin
    .from("job_applications")
    .select("id")
    .eq("job_posting_id", String(p.id))
    .eq("candidate_id", user.id)
    .maybeSingle();

  if (existing)
    return NextResponse.json({ error: "لقد قدّمت على هذه الوظيفة بالفعل" }, { status: 409 });

  const { data: application, error: insertError } = await admin
    .from("job_applications")
    .insert({
      org_id: p.org_id,
      job_posting_id: p.id,
      candidate_id: user.id,
      candidate_name: body.candidate_name,
      email: body.email || user.email || "",
      phone: body.phone || null,
      status: "submitted",
      answers: body.answers || {},
      cv_url: body.cv_url || null,
      resume_url: body.cv_url || null,
      stage_history: [
        { stage: "submitted", changed_by: user.id, changed_at: new Date().toISOString(), note: "تم التقديم" },
      ],
    } as never)
    .select()
    .single();

  if (insertError) {
    if (insertError.message.includes("unique") || insertError.code === "23505")
      return NextResponse.json({ error: "لقد قدّمت على هذه الوظيفة بالفعل" }, { status: 409 });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Notify recruiter
  if (p.created_by) {
    await admin.from("notifications").insert({
      org_id: p.org_id,
      user_id: p.created_by,
      title: "تقديم جديد على وظيفة",
      body: `قدّم ${body.candidate_name} على وظيفة "${String(p.title || "")}"`,
      type: "recruitment",
      link: `/recruitment/${String(p.id)}`,
      is_read: false,
    } as never);
  }

  // Confirm to candidate
  await admin.from("notifications").insert({
    org_id: p.org_id,
    user_id: user.id,
    title: "تم استلام طلبك",
    body: `تم استلام طلبك على وظيفة "${String(p.title || "")}" بنجاح. سنراجعه ونُعلمك بالنتيجة.`,
    type: "recruitment",
    link: "/candidate/applications",
    is_read: false,
  } as never);

  return NextResponse.json({ data: application }, { status: 201 });
}
