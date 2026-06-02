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

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_applications")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
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

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("recruiter_notes" in body) update.recruiter_notes = body.recruiter_notes;
  if ("score" in body) update.score = body.score;
  if ("status" in body) update.status = body.status;

  const { data, error } = await admin
    .from("job_applications")
    .update(update as never)
    .eq("id", params.id)
    .eq("org_id", auth.orgId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
