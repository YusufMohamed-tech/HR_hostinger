import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function authorizeRecruiter() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
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

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createAdminClient();
  let sourceQuery = admin
    .from("job_postings")
    .select("*")
    .eq("id", id)
    .eq("org_id", auth.orgId);
  if (auth.role === "hr_recruitment") sourceQuery = sourceQuery.eq("created_by", auth.userId);
  const { data: source, error: sourceError } = await sourceQuery.maybeSingle();
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 });
  if (!source) return NextResponse.json({ error: "غير مصرح لك بعرض هذا الإعلان" }, { status: 403 });

  const original = source as Record<string, unknown>;
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      org_id: auth.orgId,
      created_by: auth.userId,
      title: `${String(original.title || "")} - نسخة`,
      description: original.description || null,
      requirements: original.requirements || null,
      form_schema: original.form_schema || [],
      employment_type: original.employment_type || null,
      department_id: original.department_id || null,
      company_name: original.company_name || null,
      city: original.city || null,
      salary_min: original.salary_min || null,
      salary_max: original.salary_max || null,
      location_id: original.location_id || null,
      deadline: null,
      status: "draft",
      public_slug: null,
    } as never)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
