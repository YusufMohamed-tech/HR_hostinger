import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getValidationMessage, leaveRequestFormSchema } from "@/lib/validation";
import { ensureEmployeeLeaveBalanceServer } from "@/lib/server/leave-balances";
import { inclusiveDays, leaveTypeRequiresAttachment } from "@/lib/hr-options";

const allowedSelfServiceRoles = new Set(["employee", "training_manager", "hr_admin", "hr_recruitment", "sales", "sales_manager"]);
const allowedLeaveAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const maxLeaveAttachmentBytes = 10 * 1024 * 1024;

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()[\]\u0600-\u06FF ]+/g, "_").slice(0, 160) || "attachment";
}

function getEmployeeApprovalManagerId(employee: Record<string, unknown> | null | undefined) {
  if (!employee) return "";
  const directManagerId = typeof employee.manager_id === "string" ? employee.manager_id : "";
  if (directManagerId) return directManagerId;

  const department = employee.department as Record<string, unknown> | null | undefined;
  const departmentManagerId = typeof department?.manager_employee_id === "string" ? department.manager_employee_id : "";
  if (departmentManagerId) return departmentManagerId;

  const location = employee.location as Record<string, unknown> | null | undefined;
  const locationManagerId = typeof location?.manager_employee_id === "string" ? location.manager_employee_id : "";
  return locationManagerId;
}

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

  const contentType = request.headers.get("content-type") || "";
  let attachmentFile: File | null = null;
  let body: Record<string, unknown> = {};
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    body = {
      leave_type: String(formData.get("leave_type") || ""),
      start_date: String(formData.get("start_date") || ""),
      end_date: String(formData.get("end_date") || ""),
      reason: String(formData.get("reason") || ""),
      attachment_url: String(formData.get("attachment_url") || ""),
      attachment_name: String(formData.get("attachment_name") || ""),
    };
    const file = formData.get("attachment");
    if (file instanceof File && file.size > 0) attachmentFile = file;
  } else {
    body = await request.json().catch(() => ({}));
  }
  const parsed = leaveRequestFormSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: getValidationMessage(parsed.error) }, { status: 400 });
  }

  const attachmentRequired = leaveTypeRequiresAttachment(parsed.data.leave_type);
  if (attachmentRequired && !attachmentFile && !parsed.data.attachment_url) {
    return NextResponse.json({ message: "هذا النوع من الإجازات يتطلب إرفاق مستند قبل الإرسال." }, { status: 400 });
  }

  if (attachmentFile) {
    if (attachmentFile.size > maxLeaveAttachmentBytes || !allowedLeaveAttachmentTypes.has(attachmentFile.type)) {
      return NextResponse.json({ message: "نوع الملف غير مدعوم أو حجمه أكبر من 10MB." }, { status: 400 });
    }
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
    .select("id, full_name, hiring_date, leave_accrual_start_date, leave_balance_manual_adjustment, manager_id, department:department_id(manager_employee_id), location:location_id(manager_employee_id)")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (employeeLookupError) {
    return NextResponse.json({ message: employeeLookupError.message }, { status: 500 });
  }

  const existingEmployeeRecord = existingEmployee as Record<string, unknown> | null;
  let employeeRecord = existingEmployeeRecord;
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
        hiring_date: new Date().toISOString().split("T")[0],
        leave_accrual_start_date: new Date().toISOString().split("T")[0],
      } as never)
      .select("id, full_name, hiring_date, leave_accrual_start_date, leave_balance_manual_adjustment")
      .single();

    if (employeeCreateError) {
      return NextResponse.json({ message: employeeCreateError.message }, { status: 500 });
    }

    employeeId = String((createdEmployee as Record<string, unknown> | null)?.id || "");
    employeeRecord = createdEmployee as Record<string, unknown> | null;
  }

  if (!employeeId) {
    return NextResponse.json({ message: "Unable to determine the requester employee profile." }, { status: 500 });
  }

  const balanceEnsure = await ensureEmployeeLeaveBalanceServer(admin, {
    orgId,
    employeeId,
    hiringDate: typeof employeeRecord?.hiring_date === "string" ? employeeRecord.hiring_date : null,
    accrualStartDate: typeof employeeRecord?.leave_accrual_start_date === "string" ? employeeRecord.leave_accrual_start_date : null,
    manualAdjustment: typeof employeeRecord?.leave_balance_manual_adjustment === "number" || typeof employeeRecord?.leave_balance_manual_adjustment === "string"
      ? employeeRecord.leave_balance_manual_adjustment
      : 0,
    actorUserId: user.id,
  });

  if (balanceEnsure.error) {
    return NextResponse.json({ message: balanceEnsure.error.message }, { status: 500 });
  }

  const now = new Date().toISOString();
  const directHrReview = rawRole === "sales_manager";
  const totalSteps = rawRole === "hr_admin" || rawRole === "hr_recruitment" ? 1 : 2;
  const currentStep = directHrReview ? 2 : 1;
  const managerApprovalStatus = directHrReview ? "approved" : "pending";
  let attachmentUrl = parsed.data.attachment_url || "";
  let attachmentName = parsed.data.attachment_name || "";

  if (attachmentFile) {
    const filename = safeFilename(attachmentFile.name);
    const path = `leave-requests/${orgId}/${employeeId}/${Date.now()}-${filename}`;
    const upload = await admin.storage
      .from("balance-attachments")
      .upload(path, attachmentFile, { contentType: attachmentFile.type, upsert: false });

    if (upload.error) {
      return NextResponse.json({ message: upload.error.message }, { status: 500 });
    }

    attachmentUrl = path;
    attachmentName = filename;
  }

  const { data: leaveRequest, error: leaveRequestError } = await admin
    .from("leave_requests")
    .insert({
      org_id: orgId,
      employee_id: employeeId,
      ...parsed.data,
      days_count: inclusiveDays(parsed.data.start_date, parsed.data.end_date),
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      attachment_required: attachmentRequired,
      status: "pending",
      manager_approval_status: managerApprovalStatus,
      hr_approval_status: "pending",
      current_step: currentStep,
      total_steps: totalSteps,
      approval_history: [{ step: currentStep, status: "submitted", at: now }],
    } as never)
    .select()
    .single();

  if (leaveRequestError) {
    return NextResponse.json({ message: leaveRequestError.message }, { status: 500 });
  }

  if (rawRole === "sales") {
    const { data: salesManagers } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("role", "sales_manager");
    const employeeName = String(employeeRecord?.full_name || user.email || "Employee");
    const rows = ((salesManagers ?? []) as Record<string, unknown>[])
      .map((member) => String(member.user_id || ""))
      .filter(Boolean)
      .map((userId) => ({
        org_id: orgId,
        user_id: userId,
        title: "طلب إجازة جديد",
        body: `${employeeName} أرسل طلب إجازة بانتظار موافقة مدير المبيعات.`,
        type: "leave",
        link: "/leave",
        is_read: false,
      }));
    if (rows.length > 0) await admin.from("notifications").insert(rows as never);
  } else if (rawRole === "sales_manager") {
    const { data: hrMembers } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .in("role", ["hr_admin", "admin"]);
    const employeeName = String(employeeRecord?.full_name || user.email || "Employee");
    const rows = ((hrMembers ?? []) as Record<string, unknown>[])
      .map((member) => String(member.user_id || ""))
      .filter(Boolean)
      .map((userId) => ({
        org_id: orgId,
        user_id: userId,
        title: "طلب إجازة بانتظار HR",
        body: `${employeeName} أرسل طلب إجازة بانتظار مراجعة HR.`,
        type: "leave",
        link: "/leave",
        is_read: false,
      }));
    if (rows.length > 0) await admin.from("notifications").insert(rows as never);
  } else {
    const managerEmployeeId = getEmployeeApprovalManagerId(employeeRecord);
    if (managerEmployeeId) {
    const { data: manager } = await admin
      .from("employees")
      .select("user_id")
      .eq("id", managerEmployeeId)
      .maybeSingle();
    const managerUserId = String((manager as Record<string, unknown> | null)?.user_id || "");
    if (managerUserId) {
      const employeeName = String(employeeRecord?.full_name || user.email || "Employee");
      await admin.from("notifications").insert({
        org_id: orgId,
        user_id: managerUserId,
        title: "طلب إجازة جديد",
        body: `${employeeName} أرسل طلب إجازة بانتظار موافقة المدير.`,
        type: "leave",
        link: "/leave",
        is_read: false,
      } as never);
    }
  }
  }

  return NextResponse.json({ request: leaveRequest });
}
