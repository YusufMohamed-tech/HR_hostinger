import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export async function POST(request: NextRequest) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = (await request.json()) as { application_id: string };
  if (!body.application_id) return NextResponse.json({ error: "application_id مطلوب" }, { status: 400 });

  const admin = createAdminClient();

  const { data: app, error: appError } = await admin
    .from("job_applications")
    .select("*, job:job_posting_id(title, department_id, location_id)")
    .eq("id", body.application_id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (appError || !app) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
  const application = app as Record<string, unknown>;
  const posting = application.job as Record<string, unknown> | null;

  const currentHistory = Array.isArray(application.stage_history)
    ? (application.stage_history as unknown[])
    : [];

  await admin.from("job_applications").update({
    status: "hired",
    stage_history: [
      ...currentHistory,
      { stage: "hired", changed_by: auth.userId, changed_at: new Date().toISOString(), note: "تم القبول وإنشاء ملف موظف" },
    ],
    updated_at: new Date().toISOString(),
  } as never).eq("id", body.application_id);

  const email = String(application.email || "");
  const candidateAuthId = (application.candidate_id as string | null) || null;

  // Check if employee already exists with this email in this org
  const { data: existingEmployee } = await admin
    .from("employees")
    .select("id, user_id")
    .eq("email", email)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  let employeeId: string;
  let notifyUserId: string | null = candidateAuthId;

  if (existingEmployee) {
    employeeId = String((existingEmployee as Record<string, unknown>).id);
    notifyUserId = String((existingEmployee as Record<string, unknown>).user_id || notifyUserId || "");
  } else {
    // Check if auth user exists for this email
    // Use candidate_id from the application if available, otherwise search org_members by joining profiles
    let authUserId: string | null = candidateAuthId;
    if (!authUserId) {
      // Search all org_members joined with their auth user email via profiles or employees table
      // The most reliable way: query existing employees in any org with this email to get user_id
      const { data: empWithUserId } = await admin
        .from("employees")
        .select("user_id")
        .eq("email", email)
        .not("user_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (empWithUserId && (empWithUserId as Record<string, unknown>).user_id) {
        authUserId = String((empWithUserId as Record<string, unknown>).user_id);
      }
    }

    if (!authUserId) {
      // Create auth user
      const { data: newUser } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: String(application.candidate_name || "") },
      });
      authUserId = newUser?.user?.id || null;
    }

    if (authUserId) {
      // Ensure org_members entry with employee role
      const { data: existingMember } = await admin
        .from("org_members")
        .select("user_id")
        .eq("org_id", auth.orgId)
        .eq("user_id", authUserId)
        .maybeSingle();
      if (!existingMember) {
        await admin.from("org_members").insert({
          org_id: auth.orgId,
          user_id: authUserId,
          role: "employee",
        } as never);
      }
    }

    const { data: newEmployee, error: empError } = await admin
      .from("employees")
      .insert({
        org_id: auth.orgId,
        user_id: authUserId,
        full_name: String(application.candidate_name || ""),
        email,
        phone: application.phone ? String(application.phone) : null,
        job_title: String(posting?.title || ""),
        department_id: posting?.department_id || null,
        location_id: posting?.location_id || null,
        status: "Active",
        hiring_date: new Date().toISOString().split("T")[0],
        employment_type: "full_time",
      } as never)
      .select()
      .single();

    if (empError) {
      // Rollback application status so it isn't stuck in "hired"
      await admin.from("job_applications").update({
        status: "offer",
        stage_history: currentHistory,
        updated_at: new Date().toISOString(),
      } as never).eq("id", body.application_id);
      return NextResponse.json({ error: empError.message }, { status: 500 });
    }
    employeeId = String((newEmployee as Record<string, unknown>).id);
    notifyUserId = authUserId;
  }

  // Notify candidate
  if (notifyUserId) {
    await admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: notifyUserId,
      title: "تهانينا! تم قبولك",
      body: `تهانينا! تم قبولك للعمل في وظيفة "${String(posting?.title || "")}". تم إنشاء حسابك في نظام الشركة.`,
      type: "recruitment",
      link: "/",
      is_read: false,
    } as never);
  }

  // Notify HR admins
  const { data: hrAdmins } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", auth.orgId)
    .in("role", ["hr_admin", "admin"]);

  const hrNotifications = (hrAdmins || []).map((m: Record<string, unknown>) => ({
    org_id: auth.orgId,
    user_id: m.user_id,
    title: "موظف جديد تم تعيينه",
    body: `تم توظيف "${String(application.candidate_name || "")}" — يرجى إكمال ملف الموظف.`,
    type: "recruitment",
    link: `/employees/${employeeId}`,
    is_read: false,
  }));
  if (hrNotifications.length > 0) {
    await admin.from("notifications").insert(hrNotifications as never);
  }

  return NextResponse.json({ data: { employee_id: employeeId } });
}
