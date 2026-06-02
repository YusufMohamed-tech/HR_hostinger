import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_applications")
    .select(
      `*, job:job_posting_id(id, title, employment_type, deadline, status, department:department_id(name), location:location_id(name))`
    )
    .eq("candidate_id", user.id)
    .order("applied_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const appIds = (data || []).map((a: Record<string, unknown>) => String(a.id));
  let interviews: Record<string, unknown>[] = [];
  if (appIds.length > 0) {
    const { data: ivData } = await admin
      .from("interviews")
      .select("*")
      .in("job_application_id", appIds)
      .order("scheduled_at", { ascending: true });
    interviews = (ivData || []) as Record<string, unknown>[];
  }

  const byApp: Record<string, Record<string, unknown>[]> = {};
  for (const iv of interviews) {
    const appId = String(iv.job_application_id);
    if (!byApp[appId]) byApp[appId] = [];
    byApp[appId].push(iv);
  }

  const result = (data || []).map((a: Record<string, unknown>) => ({
    ...a,
    interviews: byApp[String(a.id)] || [],
  }));

  return NextResponse.json({ data: result });
}
