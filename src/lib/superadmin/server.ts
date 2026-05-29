import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PlatformAdminRecord = {
  user_id: string;
  role: string;
  status: string;
};

export type SuperadminAuth = {
  user: User;
  platformAdmin: PlatformAdminRecord | null;
  source: "platform_admins" | "legacy_org_members";
};

export async function requireSuperadmin(): Promise<SuperadminAuth | { error: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: platformAdmin, error: platformError } = await admin
    .from("platform_admins")
    .select("user_id, role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const platformRecord = platformAdmin as unknown as PlatformAdminRecord | null;
  const platformTableMissing = platformError && platformError.code === "42P01";

  if (platformError && !platformTableMissing) {
    return { error: NextResponse.json({ message: platformError.message }, { status: 500 }) };
  }

  if (platformRecord?.role === "superadmin" && platformRecord.status === "active") {
    return { user, platformAdmin: platformRecord, source: "platform_admins" };
  }

  if (platformRecord?.status === "suspended") {
    return { error: NextResponse.json({ message: "Superadmin account is suspended." }, { status: 403 }) };
  }

  if (!platformTableMissing) {
    return { error: NextResponse.json({ message: "Superadmin access is required." }, { status: 403 }) };
  }

  const { data: membership, error: membershipError } = await admin
    .from("org_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "super_admin")
    .maybeSingle();

  if (membershipError || !membership) {
    return { error: NextResponse.json({ message: "Superadmin access is required." }, { status: 403 }) };
  }

  return { user, platformAdmin: null, source: "legacy_org_members" };
}

export async function recordPlatformAudit(values: {
  actorUserId: string;
  action: string;
  targetOrgId?: string | null;
  targetUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("platform_audit_logs").insert({
    actor_user_id: values.actorUserId,
    actor_role: "superadmin",
    action: values.action,
    target_org_id: values.targetOrgId ?? null,
    target_user_id: values.targetUserId ?? null,
    target_type: values.targetType ?? null,
    target_id: values.targetId ?? null,
    metadata: values.metadata ?? {},
  } as never);

  if (error && error.code !== "42P01") {
    console.error("Unable to write platform audit log:", error.message);
  }
}
