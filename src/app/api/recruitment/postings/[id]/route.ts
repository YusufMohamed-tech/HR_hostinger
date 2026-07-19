import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recruitmentFormSchema } from "@/lib/recruitment-form";

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

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createAdminClient();
  let query = admin
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name)")
    .eq("id", id)
    .eq("org_id", auth.orgId);
  if (isRecruiterOnly(auth.role)) query = query.eq("created_by", auth.userId);
  const { data, error } = await query.maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: isRecruiterOnly(auth.role) ? "غير مصرح لك بعرض هذا الإعلان" : "الوظيفة غير موجودة" }, { status: isRecruiterOnly(auth.role) ? 403 : 404 });
  return NextResponse.json({ data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const formSchema = "form_schema" in body
    ? recruitmentFormSchema.safeParse(body.form_schema)
    : null;
  if (formSchema && !formSchema.success) {
    return NextResponse.json({ error: "نموذج التقديم يحتوي أسئلة أو خيارات غير صالحة" }, { status: 400 });
  }
  const admin = createAdminClient();

  let slugUpdate: Record<string, string> = {};
  if (body.status === "active") {
    let currentQuery = admin
      .from("job_postings")
      .select("public_slug")
      .eq("id", id);
    if (isRecruiterOnly(auth.role)) currentQuery = currentQuery.eq("created_by", auth.userId);
    const { data: current } = await currentQuery.maybeSingle();
    if (!(current as Record<string, unknown> | null)?.public_slug) {
      let slug: string | null = null;
      let attempts = 0;
      while (attempts < 5) {
        const candidate = generateSlug();
        const { data: collision } = await admin
          .from("job_postings")
          .select("id")
          .eq("public_slug", candidate)
          .maybeSingle();
        if (!collision) {
          slug = candidate;
          break;
        }
        attempts++;
      }
      if (!slug) return NextResponse.json({ error: "تعذر إنشاء رابط فريد" }, { status: 500 });
      slugUpdate = { public_slug: slug };
    }
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    ...slugUpdate,
  };

  const allowed = [
    "title", "department_id", "location_id", "company_name", "city", "employment_type", "description",
    "requirements", "salary_min", "salary_max", "deadline", "status", "form_schema",
  ];
  for (const key of allowed) {
    if (key in body) update[key] = body[key] ?? null;
  }
  if (formSchema?.success) update.form_schema = formSchema.data;

  let updateQuery = admin
    .from("job_postings")
    .update(update as never)
    .eq("id", id)
    .eq("org_id", auth.orgId);
  if (isRecruiterOnly(auth.role)) updateQuery = updateQuery.eq("created_by", auth.userId);
  const { data, error } = await updateQuery.select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
