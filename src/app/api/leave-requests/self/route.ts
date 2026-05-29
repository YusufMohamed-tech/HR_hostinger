import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getValidationMessage, leaveRequestFormSchema } from "@/lib/validation";

const allowedSelfServiceRoles = new Set(["employee", "training_manager", "hr_admin", "hr_recruitment"]);

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const membershipRecord = membership as unknown as Record<string, unknown> | null;
  const orgId = String(membershipRecord?.org_id || "");
  const rawRole = String(membershipRecord?.role || "");

  if (membershipError || !membershipRecord || !orgId) {
    return NextResponse.json({ message: "Organization membership is required." }, { status: 403 });
  }

  if (!allowedSelfServiceRoles.has(rawRole)) {
    return NextResponse.json({ message: "Self-service leave requests are not available for this role." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = leaveRequestFormSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: getValidationMessage(parsed.error) }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("full_name, email, title")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ message: profileError.message }, { status: 500 });
  }

  const { data: existingEmployee, error: employeeLookupError } = await admin
    .from("employees")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (employeeLookupError) {
    return NextResponse.json({ message: employeeLookupError.message }, { status: 500 });
  }

  const existingEmployeeRecord = existingEmployee as Record<string, unknown> | null;
  let employeeId = typeof existingEmployeeRecord?.id === "string"
    ? String(existingEmployeeRecord.id)
    : "";

  if (!employeeId) {
    const profileRecord = profile as unknown as Record<string, unknown> | null;
    const fullName = String(profileRecord?.full_name || user.user_metadata?.full_name || user.email || "Employee");
    const email = String(profileRecord?.email || user.email || "");
    const jobTitle = typeof profileRecord?.title === "string" ? profileRecord.title : null;

    const { data: createdEmployee, error: employeeCreateError } = await admin
      .from("employees")
      .insert({
        org_id: orgId,
        user_id: user.id,
        full_name: fullName,
        email: email || null,
        job_title: jobTitle,
      } as never)
      .select("id")
      .single();

    if (employeeCreateError) {
      return NextResponse.json({ message: employeeCreateError.message }, { status: 500 });
    }

    employeeId = String((createdEmployee as Record<string, unknown> | null)?.id || "");
  }

  if (!employeeId) {
    return NextResponse.json({ message: "Unable to determine the requester employee profile." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const totalSteps = rawRole === "hr_admin" || rawRole === "hr_recruitment" ? 1 : 2;

  const { data: leaveRequest, error: leaveRequestError } = await admin
    .from("leave_requests")
    .insert({
      org_id: orgId,
      employee_id: employeeId,
      ...parsed.data,
      status: "pending",
      manager_approval_status: "pending",
      hr_approval_status: "pending",
      current_step: 1,
      total_steps: totalSteps,
      approval_history: [{ step: 1, status: "submitted", at: now }],
    } as never)
    .select()
    .single();

  if (leaveRequestError) {
    return NextResponse.json({ message: leaveRequestError.message }, { status: 500 });
  }

  return NextResponse.json({ request: leaveRequest });
}
