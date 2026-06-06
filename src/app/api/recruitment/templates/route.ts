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

export async function GET() {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const admin = createAdminClient();
  let query = admin
    .from("job_templates")
    .select("*, department:department_id(name)")
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });
  if (auth.role === "hr_recruitment") query = query.eq("created_by", auth.userId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("job_templates")
    .insert({
      organization_id: auth.orgId,
      created_by: auth.userId,
      title: String(body.title || ""),
      description: body.description || null,
      requirements: body.requirements || null,
      form_schema: body.form_schema || [],
      employment_type: body.employment_type || null,
      department_id: body.department_id || null,
      company_name: body.company_name || null,
    } as never)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
