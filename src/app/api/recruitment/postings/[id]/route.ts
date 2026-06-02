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

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name)")
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "الوظيفة غير موجودة" }, { status: 404 });
  return NextResponse.json({ data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const admin = createAdminClient();

  let slugUpdate: Record<string, string> = {};
  if (body.status === "active") {
    const { data: current } = await admin
      .from("job_postings")
      .select("public_slug")
      .eq("id", params.id)
      .maybeSingle();
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
    "title", "department_id", "location_id", "employment_type", "description",
    "requirements", "salary_min", "salary_max", "deadline", "status", "form_schema",
  ];
  for (const key of allowed) {
    if (key in body) update[key] = body[key] ?? null;
  }

  const { data, error } = await admin
    .from("job_postings")
    .update(update as never)
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
