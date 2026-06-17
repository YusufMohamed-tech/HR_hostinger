import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function actionLabel(action: string) {
  if (action === "check_out") return "تسجيل الانصراف";
  return "تسجيل الحضور";
}

function isActiveLocation(row: Record<string, unknown>, today: string) {
  const locationId = String(row.location_id || "");
  const assignedTo = typeof row.assigned_to === "string" ? row.assigned_to : "";
  return Boolean(locationId) && (!assignedTo || assignedTo >= today);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return NextResponse.json({ message: "غير مصرح بالدخول." }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const member = membership as Record<string, unknown> | null;
  const orgId = String(member?.org_id || "");
  if (membershipError || !orgId) {
    return NextResponse.json({ message: "لا توجد صلاحية منظمة." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String((body as Record<string, unknown>).action || "check_in");
  const admin = createAdminClient();
  const today = todayIso();

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, full_name, employee_code, email, location_id, employee_locations(location_id, assigned_to)")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (employeeError) return NextResponse.json({ message: employeeError.message }, { status: 500 });

  const employeeRecord = employee as Record<string, unknown> | null;
  const employeeId = String(employeeRecord?.id || "");
  if (!employeeId) {
    return NextResponse.json({ message: "ملف الموظف غير موجود." }, { status: 404 });
  }

  const assignedRows = Array.isArray(employeeRecord?.employee_locations)
    ? employeeRecord.employee_locations as Record<string, unknown>[]
    : [];
  const hasLocation = Boolean(employeeRecord?.location_id) || assignedRows.some((row) => isActiveLocation(row, today));
  if (hasLocation) {
    return NextResponse.json({ data: { notified: false, hasLocation: true } });
  }

  const { data: hrMembers, error: hrError } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["admin", "hr_admin"]);

  if (hrError) return NextResponse.json({ message: hrError.message }, { status: 500 });

  const recipients = Array.from(new Set(((hrMembers ?? []) as Record<string, unknown>[])
    .map((row) => String(row.user_id || ""))
    .filter((userId) => userId && userId !== user.id)));

  if (recipients.length === 0) {
    return NextResponse.json({ data: { notified: false, hasLocation: false, recipients: 0 } });
  }

  const employeeName = String(employeeRecord?.full_name || user.email || "موظف");
  const employeeCode = String(employeeRecord?.employee_code || "").trim();
  const title = "موظف بدون موقع حضور";
  const link = `/employees/${employeeId}`;
  const bodyText = `حاول ${employeeName}${employeeCode ? ` (${employeeCode})` : ""} ${actionLabel(action)} لكن لا يوجد موقع حضور مسند له.`;
  const dayStart = `${today}T00:00:00.000Z`;

  const { data: existingRows } = await admin
    .from("notifications")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("type", "attendance")
    .eq("title", title)
    .eq("link", link)
    .gte("created_at", dayStart)
    .in("user_id", recipients);

  const alreadyNotified = new Set(((existingRows ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || "")));
  const missingRecipients = recipients.filter((userId) => !alreadyNotified.has(userId));

  if (missingRecipients.length > 0) {
    const insertResult = await admin.from("notifications").insert(missingRecipients.map((userId) => ({
      org_id: orgId,
      user_id: userId,
      title,
      body: bodyText,
      type: "attendance",
      link,
      is_read: false,
    })) as never);
    if (insertResult.error) return NextResponse.json({ message: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      notified: missingRecipients.length > 0,
      hasLocation: false,
      recipients: missingRecipients.length,
    },
  });
}
