import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { armIdentityDeletion, cancelIdentityDeletion } from "@/lib/server/identity-reconciliation";
import { recordPlatformAudit, requireSuperadmin } from "@/lib/superadmin/server";

const allowedRoles = new Set([
  "admin",
  "hr_admin",
  "hr_recruitment",
  "onground_agent_manager",
  "promoter",
  "finance_manager",
  "accountant",
  "finance_viewer",
  "supervisor",
]);
const allowedCreationRoles = new Set(["admin"]);
const allowedActions = new Set(["suspend", "activate", "reset_password", "update_role"]);

function validUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002" || code === "23503") return 404;
  if (code === "23505" || code === "40001") return 409;
  if (["22023", "23514", "23502"].includes(code || "")) return 400;
  return 500;
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }, { data: organizations, error: organizationsError }] = await Promise.all([
    admin.from("profiles").select("user_id, org_id, full_name, email, account_status, created_at, last_login_at"),
    admin.from("org_members").select("org_id, user_id, role"),
    admin.from("organizations").select("id, name, slug, status"),
  ]);

  if (profilesError) return NextResponse.json({ message: profilesError.message }, { status: 500 });
  if (membershipsError) return NextResponse.json({ message: membershipsError.message }, { status: 500 });
  if (organizationsError) return NextResponse.json({ message: organizationsError.message }, { status: 500 });

  const orgMap = new Map((organizations || []).map((org: Record<string, unknown>) => [String(org.id), org]));
  const membershipMap = new Map((memberships || []).map((member: Record<string, unknown>) => [`${member.user_id}:${member.org_id}`, member]));

  const users = (profiles || []).map((profile: Record<string, unknown>) => {
    const orgId = String(profile.org_id || "");
    const membership = membershipMap.get(`${profile.user_id}:${orgId}`) as Record<string, unknown> | undefined;
    const organization = orgMap.get(orgId) as Record<string, unknown> | undefined;
    return {
      id: String(profile.user_id || ""),
      name: String(profile.full_name || ""),
      email: String(profile.email || ""),
      role: String(membership?.role || ""),
      organization_id: orgId,
      organization_name: String(organization?.name || ""),
      status: String(profile.account_status || "active"),
      created_at: String(profile.created_at || ""),
      last_login_at: profile.last_login_at ? String(profile.last_login_at) : "",
    };
  });

  return NextResponse.json({ users });
}

async function getAuthUserByEmail(email: string) {
  const admin = createAdminClient();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const found = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  const role = String(body.role || "");
  const targetOrgId = String(body.target_org_id || "").trim();
  const commandId = validUuid(body.command_id) ? String(body.command_id) : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ message: "Valid email is required." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ message: "Full name is required." }, { status: 400 });
  }
  if (!allowedCreationRoles.has(role)) {
    return NextResponse.json({ message: "Platform provisioning may only bootstrap an organization administrator. Employee roles must be invited through HR onboarding." }, { status: 400 });
  }
  if (!targetOrgId) {
    return NextResponse.json({ message: "Target organization is required." }, { status: 400 });
  }
  if (!commandId) {
    return NextResponse.json({ message: "A valid command id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const organizationResult = await admin
    .from("organizations")
    .select("id")
    .eq("id", targetOrgId)
    .maybeSingle();

  if (organizationResult.error) {
    return NextResponse.json({ message: organizationResult.error.message }, { status: 500 });
  }

  if (!organizationResult.data) {
    return NextResponse.json({ message: "Target organization was not found." }, { status: 404 });
  }

  const existing = await getAuthUserByEmail(email);

  if (existing) {
    const existingMembership = await admin.from("org_members").select("org_id").eq("user_id", existing.id).maybeSingle();
    if (existingMembership.error) return NextResponse.json({ message: existingMembership.error.message }, { status: 500 });
    if (existingMembership.data && existingMembership.data.org_id !== targetOrgId) {
      return NextResponse.json({ message: "This login already belongs to another organization." }, { status: 409 });
    }
  }

  const invite = existing ? null : await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, identity_command_id: commandId },
  });
  if (invite?.error || (!existing && !invite?.data.user)) {
    return NextResponse.json({ message: invite?.error?.message || "Unable to invite organization administrator." }, { status: 500 });
  }
  const authUser = existing || invite?.data.user;
  if (!authUser) return NextResponse.json({ message: "Unable to resolve invited user." }, { status: 500 });

  let cleanupJobId = "";
  if (!existing) {
    try {
      cleanupJobId = await armIdentityDeletion(admin, {
        orgId: targetOrgId,
        userId: authUser.id,
        sourceType: "provisioning_safety",
        sourceId: commandId,
        reason: "Delete invited administrator if organization provisioning never completes.",
        actorUserId: auth.user.id,
        requestId: commandId,
      });
    } catch (error) {
      await admin.auth.admin.deleteUser(authUser.id).catch(() => undefined);
      return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to arm invitation cleanup." }, { status: 500 });
    }
  }

  const { error: provisioningError } = await admin.rpc("provision_organization_admin_identity", {
    p_org_id: targetOrgId,
    p_actor_user_id: auth.user.id,
    p_user_id: authUser.id,
    p_email: email,
    p_full_name: fullName,
  });
  if (provisioningError) {
    const status = provisioningError.code === "23505" ? 409
      : provisioningError.code === "P0002" ? 404
        : provisioningError.code === "42501" ? 403
          : provisioningError.code === "22023" ? 400 : 500;
    return NextResponse.json({ message: provisioningError.message }, { status });
  }
  if (cleanupJobId) {
    try {
      await cancelIdentityDeletion(admin, cleanupJobId, "Organization administrator provisioned successfully.");
    } catch (error) {
      console.error("Organization administrator was provisioned but cleanup cancellation must be reconciled.", {
        cleanupJobId,
        userId: authUser.id,
        error,
      });
    }
  }

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: existing ? "organization_admin.linked" : "organization_admin.invited",
    targetOrgId,
    targetUserId: authUser.id,
    targetType: "org_member",
    targetId: authUser.id,
    metadata: {
      email,
      full_name: fullName,
      role,
      delivery: existing ? "existing_account_linked" : "invitation_sent",
    },
  });

  return NextResponse.json({
    user: {
      id: authUser.id,
      email,
      full_name: fullName,
      role,
      org_id: targetOrgId,
      delivery: existing ? "existing_account_linked" : "invitation_sent",
    },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || "").trim();
  const targetOrgId = String(body.target_org_id || "").trim();
  const action = String(body.action || "").trim();
  const nextRole = String(body.role || "").trim();
  const commandId = validUuid(body.command_id) ? String(body.command_id) : "";

  if (!userId) {
    return NextResponse.json({ message: "User id is required." }, { status: 400 });
  }
  if (!targetOrgId) {
    return NextResponse.json({ message: "Target organization is required." }, { status: 400 });
  }
  if (!allowedActions.has(action)) {
    return NextResponse.json({ message: "Unsupported user action." }, { status: 400 });
  }
  if (action === "update_role" && !allowedRoles.has(nextRole)) {
    return NextResponse.json({ message: "Unsupported organization role." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("org_members")
    .select("org_id, user_id, role")
    .eq("org_id", targetOrgId)
    .eq("user_id", userId)
    .maybeSingle();

  const membershipRecord = membership as unknown as Record<string, unknown> | null;

  if (membershipError) {
    return NextResponse.json({ message: membershipError.message }, { status: 500 });
  }
  if (!membershipRecord || String(membershipRecord.role || "") === "super_admin") {
    return NextResponse.json({ message: "Managed organization user was not found." }, { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name, account_status")
    .eq("user_id", userId)
    .maybeSingle();

  const profileRecord = profile as unknown as Record<string, unknown> | null;
  if (action === "reset_password") {
    const email = String(profileRecord?.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ message: "Managed user has no recovery email." }, { status: 409 });
    const { error: authError } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/reset-password", request.nextUrl.origin).toString(),
    });
    if (authError) {
      return NextResponse.json({ message: authError.message }, { status: 500 });
    }
    await recordPlatformAudit({
      actorUserId: auth.user.id,
      action: "organization_user.recovery_sent",
      targetOrgId,
      targetUserId: userId,
      targetType: "org_member",
      targetId: userId,
      metadata: { email, full_name: String(profileRecord?.full_name || ""), delivery: "recovery_email" },
    });
    return NextResponse.json({
      user: {
        id: userId,
        org_id: targetOrgId,
        role: String(membershipRecord.role || ""),
        account_status: String(profileRecord?.account_status || "active"),
        delivery: "recovery_email_sent",
      },
    });
  }

  if (!commandId) {
    return NextResponse.json({ message: "A valid command id is required for organization user changes." }, { status: 400 });
  }
  const employee = await admin.from("employees").select("id, lifecycle_version")
    .eq("org_id", targetOrgId).eq("user_id", userId).maybeSingle();
  if (employee.error) return NextResponse.json({ message: employee.error.message }, { status: 500 });

  const command = await admin.rpc("execute_platform_user_command", {
    p_actor_user_id: auth.user.id,
    p_request_id: validUuid(request.headers.get("x-request-id"))
      ? request.headers.get("x-request-id")!
      : crypto.randomUUID(),
    p_command_id: commandId,
    p_target_org_id: targetOrgId,
    p_target_user_id: userId,
    p_action: action,
    p_next_role: action === "update_role" ? nextRole : null,
    p_expected_employee_version: employee.data?.lifecycle_version ?? null,
  });
  if (command.error) {
    return NextResponse.json({ message: command.error.message }, { status: rpcStatus(command.error.code) });
  }
  return NextResponse.json({
    user: command.data,
    auth_sync: action === "suspend" || action === "activate" ? "queued" : "not_required",
  });
}
