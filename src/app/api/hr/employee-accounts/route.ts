import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedCreatorRoles = new Set(["admin", "hr_admin"]);
const allowedEmployeeRoles = new Set(["employee", "training_manager"]);
const privilegedRoles = new Set(["admin", "hr_admin", "hr_recruitment"]);

async function requireHrAccess() {
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
  const role = String(membershipRecord?.role || "");

  if (membershipError || !membershipRecord || !allowedCreatorRoles.has(role)) {
    return { error: NextResponse.json({ message: "HR Admin access is required." }, { status: 403 }) };
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
  const auth = await requireHrAccess();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const employeeId = String(body.employee_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "employee");

  if (!employeeId) {
    return NextResponse.json({ message: "Employee is required." }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ message: "Valid email is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!allowedEmployeeRoles.has(role)) {
    return NextResponse.json({ message: "Only Employee and Training Manager accounts can be created here." }, { status: 400 });
  }

  const admin = createAdminClient();
  const orgId = String(auth.membership.org_id);

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, org_id, user_id, full_name, email, phone, job_title")
    .eq("id", employeeId)
    .maybeSingle();

  const employeeRecord = employee as unknown as Record<string, unknown> | null;

  if (employeeError || !employeeRecord) {
    return NextResponse.json({ message: "Employee was not found." }, { status: 404 });
  }
  if (String(employeeRecord.org_id) !== orgId) {
    return NextResponse.json({ message: "Employee is outside your organization." }, { status: 403 });
  }
  if (employeeRecord.user_id) {
    return NextResponse.json({ message: "Employee already has a login account." }, { status: 409 });
  }

  const existing = await getAuthUserByEmail(email);

  if (existing) {
    const { data: existingMembership, error: existingMembershipError } = await admin
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", existing.id)
      .maybeSingle();

    const existingMembershipRecord = existingMembership as unknown as Record<string, unknown> | null;

    if (existingMembershipError) {
      return NextResponse.json({ message: existingMembershipError.message }, { status: 500 });
    }
    if (existingMembershipRecord && String(existingMembershipRecord.org_id) !== orgId) {
      return NextResponse.json({ message: "This email is already attached to another organization." }, { status: 409 });
    }
    if (existingMembershipRecord && privilegedRoles.has(String(existingMembershipRecord.role || ""))) {
      return NextResponse.json({ message: "This email belongs to an admin/recruitment account." }, { status: 409 });
    }
  }

  const fullName = String(body.full_name || employeeRecord.full_name || "").trim();
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

  const title = role === "training_manager" ? "Training Manager" : String(employeeRecord.job_title || "Employee");

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      user_id: authUser.id,
      org_id: orgId,
      full_name: fullName,
      email,
      phone: employeeRecord.phone || null,
      title,
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

  const { data: updatedEmployee, error: updateError } = await admin
    .from("employees")
    .update({ user_id: authUser.id, email } as never)
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ message: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      id: authUser.id,
      email,
      full_name: fullName,
      role,
    },
    employee: updatedEmployee,
  });
}
