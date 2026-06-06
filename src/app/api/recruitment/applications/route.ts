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
  return { userId: user.id, orgId: m.org_id, role: m.role };
}

function isRecruiterOnly(role: string) {
  return role === "hr_recruitment";
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRecruiter();
  if (!auth) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const postingId = searchParams.get("posting_id");

  const admin = createAdminClient();
  let allowedPostingIds: string[] | null = null;
  if (isRecruiterOnly(auth.role)) {
    const { data: postings, error: postingsError } = await admin
      .from("job_postings")
      .select("id")
      .eq("org_id", auth.orgId)
      .eq("created_by", auth.userId);
    if (postingsError) return NextResponse.json({ error: postingsError.message }, { status: 500 });
    allowedPostingIds = (postings || []).map((posting: Record<string, unknown>) => String(posting.id));
    if (allowedPostingIds.length === 0) return NextResponse.json({ data: [] });
  }
  let query = admin
    .from("job_applications")
    .select("*")
    .eq("org_id", auth.orgId)
    .order("applied_at", { ascending: false });

  if (postingId) query = query.eq("job_posting_id", postingId);
  if (allowedPostingIds) query = query.in("job_posting_id", allowedPostingIds);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}
