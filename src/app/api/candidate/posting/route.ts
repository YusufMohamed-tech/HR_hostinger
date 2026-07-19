import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/lib/server/rate-limit";
import { businessDateAt } from "@/lib/business-time";
import { requestIdFromHeaders } from "@/lib/request-id";

// GET /api/candidate/posting?slug=xxx — public, no auth required
export async function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim() || "";
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(slug)) {
    return NextResponse.json({ error: "slug مطلوب", requestId }, { status: 400 });
  }

  try {
    const rate = await consumeRateLimit({
      scope: "candidate:posting",
      identifier: `${requestIp(request)}:${slug}`,
      limit: 120,
      windowSeconds: 300,
      blockSeconds: 300,
    });
    if (!rate.allowed) return rateLimitResponse(rate, requestId);
  } catch (error) {
    console.error("Public posting protection unavailable", { requestId, error });
    return NextResponse.json({ error: "الإعلان غير متاح مؤقتًا", requestId }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: posting, error } = await admin
    .from("job_postings")
    .select(`id, org_id, title, description, requirements, employment_type, experience_level,
      salary_range, salary_min, salary_max, deadline, form_schema, company_name, city,
      department:department_id(name), location:location_id(name), org:org_id(name)`)
    .eq("public_slug", slug)
    .in("status", ["active", "published", "open"])
    .single();

  if (error || !posting) {
    return NextResponse.json({ data: null, requestId }, { status: 200 });
  }

  const p = posting as Record<string, unknown>;
  const settings = await admin.from("organization_settings").select("timezone")
    .eq("org_id", String(p.org_id)).maybeSingle();
  if (settings.error || !settings.data?.timezone) {
    console.error("Public posting business-time lookup failed", { requestId, code: settings.error?.code });
    return NextResponse.json({ error: "الإعلان غير متاح مؤقتًا", requestId }, { status: 503 });
  }
  if (p.deadline && String(p.deadline) < businessDateAt(new Date(), settings.data.timezone)) {
    return NextResponse.json({ data: null, requestId }, { status: 200 });
  }

  const publicPosting = { ...p };
  delete publicPosting.org_id;

  return NextResponse.json(
    { data: publicPosting, requestId },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
