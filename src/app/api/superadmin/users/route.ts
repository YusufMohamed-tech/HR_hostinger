import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPlatformAudit, requireSuperadmin } from "@/lib/superadmin/server";

const allowedRoles = new Set(["admin", "hr_admin", "hr_recruitment"]);
const allowedActions = new Set(["suspend", "activate", "reset_password"]);

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
  const password = String(body.password || "");
  const fullName = String(body.full_name || "").trim();
  const role = String(body.role || "");
  const targetOrgId = String(body.target_org_id || "").trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ message: "Valid email is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ message: "Full name is required." }, { status: 400 });
  }
  if (!allowedRoles.has(role)) {
    return NextResponse.json({ message: "Only Admin, HR Admin, and HR Recruitment roles can be created here." }, { status: 400 });
  }
  if (!targetOrgId) {
    return NextResponse.json({ message: "Target organization is required." }, { status: 400 });
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

  const authResult = existing
    ? await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
    : await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

  if (authResult.error) {
    return NextResponse.json({ message: authResult.error.message }, { status: 500 });
  }

  const authUser = authResult.data.user;

  if (!authUser) {
    return NextResponse.json({ message: "Unable to create user." }, { status: 500 });
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      user_id: authUser.id,
      org_id: targetOrgId,
      full_name: fullName,
      email,
      title: role === "admin" ? "Organization Admin" : role === "hr_admin" ? "HR Admin" : "HR Recruiter",
      account_status: "active",
    } as never,
    { onConflict: "user_id" }
  );
  if (profileError) {
    return NextResponse.json({ message: profileError.message }, { status: 500 });
  }

  const { error: memberError } = await admin.from("org_members").upsert(
    {
      org_id: targetOrgId,
      user_id: authUser.id,
      role,
    } as never,
    { onConflict: "org_id,user_id" }
  );
  if (memberError) {
    return NextResponse.json({ message: memberError.message }, { status: 500 });
  }

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: existing ? "organization_user.updated" : "organization_user.created",
    targetOrgId,
    targetUserId: authUser.id,
    targetType: "org_member",
    targetId: authUser.id,
    metadata: {
      email,
      full_name: fullName,
      role,
    },
  });

  return NextResponse.json({
    user: {
      id: authUser.id,
      email,
      full_name: fullName,
      role,
      org_id: targetOrgId,
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
  const password = String(body.password || "");

  if (!userId) {
    return NextResponse.json({ message: "User id is required." }, { status: 400 });
  }
  if (!targetOrgId) {
    return NextResponse.json({ message: "Target organization is required." }, { status: 400 });
  }
  if (!allowedActions.has(action)) {
    return NextResponse.json({ message: "Unsupported user action." }, { status: 400 });
  }
  if (action === "reset_password" && password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
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
  let nextStatus: string | null = null;

  if (action === "suspend" || action === "activate") {
    nextStatus = action === "suspend" ? "suspended" : "active";
    const { error: profileError } = await admin
      .from("profiles")
      .update({ account_status: nextStatus, updated_at: new Date().toISOString() } as never)
      .eq("user_id", userId)
      .eq("org_id", targetOrgId);

    if (profileError) {
      return NextResponse.json({ message: profileError.message }, { status: 500 });
    }
  }

  if (action === "reset_password") {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ message: authError.message }, { status: 500 });
    }
  }

  await recordPlatformAudit({
    actorUserId: auth.user.id,
    action: action === "suspend"
      ? "organization_user.suspended"
      : action === "activate"
        ? "organization_user.activated"
        : "organization_user.password_reset",
    targetOrgId,
    targetUserId: userId,
    targetType: "org_member",
    targetId: userId,
    metadata: {
      email: String(profileRecord?.email || ""),
      full_name: String(profileRecord?.full_name || ""),
      role: String(membershipRecord.role || ""),
      previous_status: String(profileRecord?.account_status || "active"),
      next_status: nextStatus,
    },
  });

  return NextResponse.json({
    user: {
      id: userId,
      org_id: targetOrgId,
      role: String(membershipRecord.role || ""),
      account_status: nextStatus || String(profileRecord?.account_status || "active"),
    },
  });
}
