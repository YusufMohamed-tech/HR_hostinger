import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin/server";

type OrganizationRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

function validUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002" || code === "23503") return 404;
  if (code === "23505" || code === "40001") return 409;
  if (["22023", "23514", "23502"].includes(code || "")) return 400;
  return 500;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId: rawOrgId } = await params;
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const orgId = String(rawOrgId || "").trim();
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
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId: rawOrgId } = await params;
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const orgId = String(rawOrgId || "").trim();
  if (!orgId) {
    return NextResponse.json({ message: "Organization id is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof (body as Record<string, unknown>).reason === "string"
    ? String((body as Record<string, unknown>).reason).trim()
    : "";
  const commandId = (body as Record<string, unknown>).command_id;
  if (!validUuid(commandId)) {
    return NextResponse.json({ message: "A valid command id is required." }, { status: 400 });
  }
  const admin = createAdminClient();

  const currentResult = await admin
    .from("organizations")
    .select("version, deleted_at")
    .eq("id", orgId)
    .maybeSingle();

  if (currentResult.error) {
    return NextResponse.json({ message: currentResult.error.message }, { status: 500 });
  }
  if (!currentResult.data || currentResult.data.deleted_at) {
    return NextResponse.json({ message: "Organization was not found or is already deleted." }, { status: 404 });
  }

  const command = await (admin as unknown as OrganizationRpcClient).rpc("execute_organization_command", {
    p_actor_user_id: auth.user.id,
    p_request_id: validUuid(request.headers.get("x-request-id"))
      ? request.headers.get("x-request-id")!
      : crypto.randomUUID(),
    p_command_id: commandId,
    p_action: "platform_update",
    p_target_org_id: orgId,
    p_expected_org_version: Number(currentResult.data.version ?? 0),
    p_expected_settings_version: null,
    p_payload: { status: "Deleted", deletion_reason: reason || null },
  });
  if (command.error) {
    return NextResponse.json({ message: command.error.message }, { status: rpcStatus(command.error.code) });
  }

  return NextResponse.json({ data: command.data });
}
