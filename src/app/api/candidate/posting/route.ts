import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/candidate/posting?slug=xxx — public, no auth required
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug مطلوب" }, { status: 400 });

  const admin = createAdminClient();

  const { data: posting, error } = await admin
    .from("job_postings")
    .select("*, department:department_id(name), location:location_id(name), org:org_id(name)")
    .eq("public_slug", slug)
    .in("status", ["active", "published", "open"])
    .single();

  if (error || !posting) {
    return NextResponse.json({ data: null }, { status: 200 });
  }

  const p = posting as Record<string, unknown>;
  // Check deadline
  if (p.deadline && new Date(p.deadline as string) < new Date()) {
    return NextResponse.json({ data: null }, { status: 200 });
  }

  return NextResponse.json({ data: p });
}
