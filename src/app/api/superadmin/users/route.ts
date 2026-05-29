import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["hr_admin", "hr_recruitment"]);

async function requireSuperadmin() {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const membershipRecord = membership as unknown as Record<string, unknown> | null;

  if (membershipError || !membershipRecord || String(membershipRecord.role) !== "super_admin") {
    return { error: NextResponse.json({ message: "Superadmin access is required." }, { status: 403 }) };
  }

  return { user, membership: membershipRecord };
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
  const password = String(body.password || "");
  const fullName = String(body.full_name || "").trim();
  const role = String(body.role || "");

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
    return NextResponse.json({ message: "Only HR Admin and HR Recruitment roles can be created here." }, { status: 400 });
  }

  const admin = createAdminClient();
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

  const orgId = String(auth.membership.org_id);

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      user_id: authUser.id,
      org_id: orgId,
      full_name: fullName,
      email,
      title: role === "hr_admin" ? "HR Admin" : "HR Recruiter",
      account_status: "active",
    } as never,
    { onConflict: "user_id" }
  );
  if (profileError) {
    return NextResponse.json({ message: profileError.message }, { status: 500 });
  }

  const { error: memberError } = await admin.from("org_members").upsert(
    {
      org_id: orgId,
      user_id: authUser.id,
      role,
    } as never,
    { onConflict: "org_id,user_id" }
  );
  if (memberError) {
    return NextResponse.json({ message: memberError.message }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      id: authUser.id,
      email,
      full_name: fullName,
      role,
    },
  });
}
