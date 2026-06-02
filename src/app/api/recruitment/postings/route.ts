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
  if (!m) return null;
  if (!["hr_recruitment", "hr_admin", "admin", "super_admin"].includes(m.role)) return null;
  return { userId: user.id, orgId: m.org_id, role: m.role };
}

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function GET() {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createAdminClient();
  const { data: postings, error } = await admin
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name)")
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (postings || []).map((p: Record<string, unknown>) => p.id as string);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: apps } = await admin
      .from("job_applications")
      .select("job_posting_id")
      .in("job_posting_id", ids);
    (apps || []).forEach((a: Record<string, unknown>) => {
      const pid = a.job_posting_id as string;
      counts[pid] = (counts[pid] || 0) + 1;
    });
  }

  const thisWeek = new Date();
  thisWeek.setDate(thisWeek.getDate() - 7);
  const weekCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: weekApps } = await admin
      .from("job_applications")
      .select("job_posting_id, applied_at")
      .in("job_posting_id", ids)
      .gte("applied_at", thisWeek.toISOString());
    (weekApps || []).forEach((a: Record<string, unknown>) => {
      const pid = a.job_posting_id as string;
      weekCounts[pid] = (weekCounts[pid] || 0) + 1;
    });
  }

  const result = (postings || []).map((p: Record<string, unknown>) => ({
    ...p,
    application_count: counts[p.id as string] || 0,
    new_this_week: weekCounts[p.id as string] || 0,
  }));

  return NextResponse.json({ data: result });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const admin = createAdminClient();
  const isPublishing = body.status === "active";

  let slug: string | null = null;
  if (isPublishing) {
    let attempts = 0;
    while (attempts < 5) {
      const candidate = generateSlug();
      const { data: existing } = await admin
        .from("job_postings")
        .select("id")
        .eq("public_slug", candidate)
        .maybeSingle();
      if (!existing) {
        slug = candidate;
        break;
      }
      attempts++;
    }
    if (!slug)
      return NextResponse.json({ error: "تعذر إنشاء رابط فريد، حاول مجددًا" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("job_postings")
    .insert({
      org_id: auth.orgId,
      created_by: auth.userId,
      title: String(body.title || ""),
      department_id: body.department_id || null,
      location_id: body.location_id || null,
      employment_type: body.employment_type || null,
      description: body.description || null,
      requirements: body.requirements || null,
      salary_min: body.salary_min ?? null,
      salary_max: body.salary_max ?? null,
      deadline: body.deadline || null,
      status: String(body.status || "draft"),
      form_schema: body.form_schema || [],
      public_slug: slug,
    } as never)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
