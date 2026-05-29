import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin/server";

export async function GET(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const limitParam = Number(request.nextUrl.searchParams.get("limit") || 100);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 100;
  const admin = createAdminClient();

  const { data: logs, error } = await admin
    .from("platform_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  const logRows = (logs ?? []) as Record<string, unknown>[];
  const actorIds = Array.from(new Set(logRows.map((log) => String(log.actor_user_id || "")).filter(Boolean)));
  const orgIds = Array.from(new Set(logRows.map((log) => String(log.target_org_id || "")).filter(Boolean)));

  const [profilesResult, organizationsResult] = await Promise.all([
    actorIds.length
      ? admin.from("profiles").select("user_id, full_name, email").in("user_id", actorIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? admin.from("organizations").select("id, name, slug").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error) {
    return NextResponse.json({ message: profilesResult.error.message }, { status: 500 });
  }

  if (organizationsResult.error) {
    return NextResponse.json({ message: organizationsResult.error.message }, { status: 500 });
  }

  const profilesByUserId = new Map(
    ((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [
      String(profile.user_id || ""),
      profile,
    ])
  );
  const organizationsById = new Map(
    ((organizationsResult.data ?? []) as Record<string, unknown>[]).map((organization) => [
      String(organization.id || ""),
      organization,
    ])
  );

  return NextResponse.json({
    data: logRows.map((log) => ({
      ...log,
      actor_profile: profilesByUserId.get(String(log.actor_user_id || "")) ?? null,
      target_organization: organizationsById.get(String(log.target_org_id || "")) ?? null,
    })),
  });
}
