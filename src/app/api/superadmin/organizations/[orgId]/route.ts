import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPlatformAudit, requireSuperadmin } from "@/lib/superadmin/server";

export async function GET(
  _request: Request,
  { params }: { params: { orgId: string } }
) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const orgId = String(params.orgId || "").trim();
  if (!orgId) {
    return NextResponse.json({ message: "Organization id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const [organizationResult, membersResult, employeesResult] = await Promise.all([
    admin.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    admin
      .from("org_members")
      .select("id, org_id, user_id, role, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    admin.from("employees").select("id").eq("org_id", orgId),
  ]);

  if (organizationResult.error) {
    return NextResponse.json({ message: organizationResult.error.message }, { status: 500 });
  }

  if (!organizationResult.data) {
    return NextResponse.json({ message: "Organization was not found." }, { status: 404 });
  }

  if (membersResult.error) {
    return NextResponse.json({ message: membersResult.error.message }, { status: 500 });
  }

  if (employeesResult.error) {
    return NextResponse.json({ message: employeesResult.error.message }, { status: 500 });
  }

  const members = ((membersResult.data ?? []) as Record<string, unknown>[]).filter(
    (member) => String(member.role || "") !== "super_admin"
  );
  const userIds = members.map((member) => String(member.user_id || "")).filter(Boolean);

  const profilesResult = userIds.length
    ? await admin
        .from("profiles")
        .select("user_id, full_name, email, title, account_status")
        .in("user_id", userIds)
    : { data: [], error: null };

  if (profilesResult.error) {
    return NextResponse.json({ message: profilesResult.error.message }, { status: 500 });
  }

  const profilesByUserId = new Map(
    ((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [
      String(profile.user_id || ""),
      profile,
    ])
  );

  const membersWithProfiles = members.map((member) => ({
    ...member,
    profile: profilesByUserId.get(String(member.user_id || "")) ?? null,
  }));
  const counts = {
    memberCount: members.length,
    employeeCount: (employeesResult.data ?? []).length,
    adminCount: members.filter((member) => String(member.role || "") === "admin").length,
    hrAdminCount: members.filter((member) => String(member.role || "") === "hr_admin").length,
    hrRecruitmentCount: members.filter((member) => String(member.role || "") === "hr_recruitment").length,
  };

  return NextResponse.json({
    data: {
      organization: {
        ...(organizationResult.data as Record<string, unknown>),
        ...counts,
      },
      members: membersWithProfiles,
      counts,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const orgId = String(params.orgId || "").trim();
  if (!orgId) {
    return NextResponse.json({ message: "Organization id is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof (body as Record<string, unknown>).reason === "string"
    ? String((body as Record<string, unknown>).reason).trim()
    : "";
  const now = new Date().toISOString();
  const admin = createAdminClient();

  const updateResult = await admin
    .from("organizations")
    .update({
      status: "Deleted",
      deleted_at: now,
      deletion_requested_at: now,
      deletion_requested_by: auth.user.id,
      deletion_reason: reason || null,
      updated_at: now,
    } as never)
    .eq("id", orgId)
    .is("deleted_at", null)
    .select()
    .maybeSingle();

  if (updateResult.error) {
    return NextResponse.json({ message: updateResult.error.message }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ message: "Organization was not found or is already deleted." }, { status: 404 });
  }

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: "organization.deleted",
    targetOrgId: orgId,
    targetType: "organization",
    targetId: orgId,
    metadata: {
      reason: reason || null,
      soft_delete: true,
    },
  });

  return NextResponse.json({ data: updateResult.data });
}
