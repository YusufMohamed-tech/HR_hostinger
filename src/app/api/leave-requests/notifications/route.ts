import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "hr_admin", "training_manager", "sales_manager"]);

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const event = typeof body.event === "string" ? body.event : "";

  if (!requestId || event !== "manager_approved") {
    return NextResponse.json({ message: "Invalid notification request." }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const membershipRecord = membership as Record<string, unknown> | null;
  const orgId = String(membershipRecord?.org_id || "");
  const role = String(membershipRecord?.role || "");

  if (membershipError || !orgId || !allowedRoles.has(role)) {
    return NextResponse.json({ message: "You cannot send this workflow notification." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: leaveRequest, error: leaveError } = await admin
    .from("leave_requests")
    .select("id, org_id, employee_id, current_step, status, employee:employee_id(full_name)")
    .eq("id", requestId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (leaveError) {
    return NextResponse.json({ message: leaveError.message }, { status: 500 });
  }

  const requestRecord = leaveRequest as Record<string, unknown> | null;
  if (!requestRecord || String(requestRecord.status || "") !== "pending" || Number(requestRecord.current_step || 1) < 2) {
    return NextResponse.json({ message: "Leave request is not waiting for HR review." }, { status: 400 });
  }

  const { data: hrMembers, error: hrError } = await admin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["hr_admin", "admin"]);

  if (hrError) {
    return NextResponse.json({ message: hrError.message }, { status: 500 });
  }

  const employee = requestRecord.employee as Record<string, unknown> | null;
  const employeeName = String(employee?.full_name || "موظف");
  const recipients = Array.from(new Set((hrMembers || []).map((member) => String((member as Record<string, unknown>).user_id || "")).filter(Boolean)));

  if (recipients.length > 0) {
    await admin.from("notifications").insert(recipients.map((userId) => ({
      org_id: orgId,
      user_id: userId,
      title: "طلب إجازة بانتظار HR",
      body: `تمت موافقة المدير على طلب إجازة ${employeeName}. الطلب الآن بانتظار مراجعة HR.`,
      type: "leave",
      link: "/leave",
      is_read: false,
    })) as never);
  }

  return NextResponse.json({ notified: recipients.length });
}
