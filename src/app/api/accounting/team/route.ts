import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/types/database";
import {
  beginEmployeeOnboarding,
  EmployeeLifecycleError,
  inviteAndLinkEmployeeIdentity,
  offboardEmployee,
} from "@/lib/server/employee-lifecycle";

const financeRoles = new Set(["finance_manager", "accountant", "finance_viewer"]);
const financeTeamViewRoles = new Set(["admin", "hr_admin", "finance_manager"]);
const financeTeamManageRoles = new Set(["admin", "hr_admin"]);

type FinanceTeamAction = "view" | "manage";

function json(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function message(error: unknown, status = 500) {
  return NextResponse.json(
    { message: error instanceof Error ? error.message : String(error || "حدث خطأ غير متوقع.") },
    { status }
  );
}

function titleForRole(role: string) {
  if (role === "finance_manager") return "Finance Manager";
  if (role === "accountant") return "Accountant";
  if (role === "finance_viewer") return "Finance Viewer";
  return "Finance";
}

function roleLabel(role: string) {
  if (role === "finance_manager") return "مدير المالية";
  if (role === "accountant") return "محاسب";
  if (role === "finance_viewer") return "مشاهد المالية";
  return "فريق المالية";
}

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

async function requireFinanceTeamAccess(action: FinanceTeamAction, request?: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: message("غير مصرح بالدخول.", 401) };
  }

  const [{ data: platformAdmin }, { data: membership, error: membershipError }] = await Promise.all([
    supabase
      .from("platform_admins")
      .select("role, status")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const platform = platformAdmin as Record<string, unknown> | null;
  const member = membership as Record<string, unknown> | null;
  const isSuperadmin = platform?.role === "superadmin" && platform?.status === "active";
  const role = String(member?.role || "");
  const requestedOrgId = request?.nextUrl.searchParams.get("org_id") || "";
  const orgId = String(member?.org_id || (isSuperadmin ? requestedOrgId : ""));

  if (membershipError && !isSuperadmin) {
    return { error: message("لا توجد صلاحية منظمة.", 403) };
  }

  if (!orgId) {
    return { error: message("لا توجد منظمة حالية لإدارة فريق المالية.", 403) };
  }

  const canView = isSuperadmin || financeTeamViewRoles.has(role);
  const canManage = isSuperadmin || financeTeamManageRoles.has(role);

  if ((action === "view" && !canView) || (action === "manage" && !canManage)) {
    return { error: message("ليست لديك صلاحية لإدارة فريق المالية.", 403) };
  }

  return {
    user: { id: user.id, email: user.email },
    orgId,
    role,
    isSuperadmin,
    canManage,
  };
}

async function loadFinanceTeam(orgId: string, userId?: string) {
  const admin = createAdminClient();

  let membersQuery = admin
    .from("org_members")
    .select("org_id, user_id, role")
    .eq("org_id", orgId)
    .in("role", Array.from(financeRoles) as OrgRole[]);
  if (userId) membersQuery = membersQuery.eq("user_id", userId);

  const { data: members, error: membersError } = await membersQuery;
  if (membersError) throw new Error(membersError.message);

  const userIds = ((members || []) as Record<string, unknown>[])
    .map((member) => String(member.user_id || ""))
    .filter(Boolean);

  if (userIds.length === 0) return [];

  const [{ data: profiles, error: profilesError }, { data: employees, error: employeesError }] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, org_id, full_name, email, phone, title, account_status, created_at")
      .eq("org_id", orgId)
      .in("user_id", userIds),
    admin
      .from("employees")
      .select("id, user_id, job_title, status, lifecycle_version")
      .eq("org_id", orgId)
      .in("user_id", userIds),
  ]);

  if (profilesError) throw new Error(profilesError.message);
  if (employeesError) throw new Error(employeesError.message);

  const profilesByUser = new Map(
    ((profiles || []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id || ""), profile])
  );
  const employeesByUser = new Map(
    ((employees || []) as Record<string, unknown>[]).map((employee) => [String(employee.user_id || ""), employee])
  );

  return ((members || []) as Record<string, unknown>[])
    .map((member) => {
      const memberUserId = String(member.user_id || "");
      const profile = profilesByUser.get(memberUserId) || {};
      const employee = employeesByUser.get(memberUserId) || {};
      return {
        user_id: memberUserId,
        org_id: String(member.org_id || ""),
        role: String(member.role || ""),
        full_name: String(profile.full_name || profile.email || roleLabel(String(member.role || ""))),
        email: String(profile.email || ""),
        phone: typeof profile.phone === "string" ? profile.phone : null,
        title: typeof profile.title === "string" ? profile.title : titleForRole(String(member.role || "")),
        status: String(profile.account_status || employee.status || "active"),
        employee_id: employee.id ? String(employee.id) : null,
        lifecycle_version: Number(employee.lifecycle_version || 1),
        job_title: typeof employee.job_title === "string" ? employee.job_title : null,
        created_at: typeof profile.created_at === "string" ? profile.created_at : null,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
}

async function loadSingleFinanceMember(orgId: string, userId: string) {
  const rows = await loadFinanceTeam(orgId, userId);
  return rows[0] || null;
}

export async function GET(request: NextRequest) {
  const auth = await requireFinanceTeamAccess("view", request);
  if ("error" in auth) return auth.error;

  try {
    return json(await loadFinanceTeam(auth.orgId));
  } catch (error) {
    return message(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFinanceTeamAccess("manage", request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const fullName = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const role = String(body.role || "").trim().toLowerCase();

  if (fullName.length < 2) return message("اسم المستخدم مطلوب.", 400);
  if (!email.includes("@")) return message("بريد إلكتروني صحيح مطلوب.", 400);
  if (!financeRoles.has(role)) return message("يمكن تعيين أدوار المالية فقط من هذه الصفحة.", 400);

  const admin = createAdminClient();

  try {
    if (auth.isSuperadmin && !auth.role) {
      return message("يجب تنفيذ إنشاء عضو المالية من حساب Admin أو HR Admin داخل المنظمة لضمان تسجيل مسؤول دورة الحياة.", 403);
    }
    const commandId = typeof body.command_id === "string" && /^[0-9a-f-]{36}$/i.test(body.command_id)
      ? body.command_id
      : crypto.randomUUID();
    const employee = await beginEmployeeOnboarding(admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      commandId,
      sourceType: "accounting",
      sourceId: commandId,
      employee: {
        full_name: fullName,
        email,
        phone: phone || undefined,
        job_title: titleForRole(role),
        hiring_date: new Date().toISOString().slice(0, 10),
        leave_accrual_start_date: new Date().toISOString().slice(0, 10),
        employment_type: "full_time",
        status: "Active",
      },
    });
    const identity = await inviteAndLinkEmployeeIdentity(admin, {
      orgId: auth.orgId,
      employeeId: String(employee.id || ""),
      actorUserId: auth.user.id,
      commandId: crypto.randomUUID(),
      email,
      fullName,
      role: role as OrgRole,
    });
    const userId = identity.user.id;
    return json(await loadSingleFinanceMember(auth.orgId, userId), 201);
  } catch (error) {
    return message(error, error instanceof EmployeeLifecycleError ? error.status : 500);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFinanceTeamAccess("manage", request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || "").trim();
  const requestedRole = String(body.role || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  const phone = String(body.phone || "").trim();
  const status = String(body.status || "").trim().toLowerCase();
  const commandId = validUuid(body.command_id) ? String(body.command_id) : "";
  const expectedVersion = Number(body.expected_version);

  if (!userId) return message("معرف المستخدم مطلوب.", 400);
  if (!commandId) return message("معرف عملية صالح مطلوب لحماية التعديل من التكرار.", 400);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return message("أعد تحميل عضو فريق المالية ثم حاول مجدداً.", 409);
  if (requestedRole && !financeRoles.has(requestedRole)) return message("يمكن تعيين أدوار المالية فقط من هذه الصفحة.", 400);
  if (status && !["active", "inactive", "suspended"].includes(status)) return message("حالة الحساب غير صحيحة.", 400);

  const admin = createAdminClient();

  try {
    const { data: membership, error: membershipError } = await admin
      .from("org_members")
      .select("org_id, user_id, role")
      .eq("org_id", auth.orgId)
      .eq("user_id", userId)
      .in("role", Array.from(financeRoles) as OrgRole[])
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) return message("عضو فريق المالية غير موجود داخل هذه المنظمة.", 404);

    const previous = membership as Record<string, unknown>;
    if (status) {
      if (status === "active") return message("إعادة التفعيل تتطلب بدء دورة إعادة تعيين موثقة من HR.", 409);
      const employeeResult = await admin
        .from("employees")
        .select("id, lifecycle_version")
        .eq("org_id", auth.orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (employeeResult.error) throw new Error(employeeResult.error.message);
      if (!employeeResult.data) return message("لا يوجد ملف موظف مرتبط بهذا الحساب؛ راجع HR.", 409);
      if (employeeResult.data.lifecycle_version !== expectedVersion) {
        return message("تم تعديل ملف الموظف في جلسة أخرى؛ أعد التحميل ثم حاول مجدداً.", 409);
      }
      await offboardEmployee(admin, {
        orgId: auth.orgId,
        employeeId: employeeResult.data.id,
        actorUserId: auth.user.id,
        commandId,
        effectiveDate: new Date().toISOString().slice(0, 10),
        reason: "Finance team access ended by an authorized administrator.",
        terminationType: "termination",
      });
      return json(null);
    }
    const employeeResult = await admin
      .from("employees")
      .select("id")
      .eq("org_id", auth.orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    if (!employeeResult.data) return message("لا يوجد ملف موظف مرتبط بهذا الحساب؛ راجع HR.", 409);
    const roleTouched = Object.prototype.hasOwnProperty.call(body, "role");
    const fullNameTouched = Object.prototype.hasOwnProperty.call(body, "full_name");
    const phoneTouched = Object.prototype.hasOwnProperty.call(body, "phone");
    if (!roleTouched && !fullNameTouched && !phoneTouched) return message("لا توجد تغييرات للحفظ.", 400);

    const result = await admin.rpc("execute_finance_team_command", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: validUuid(request.headers.get("x-request-id"))
        ? request.headers.get("x-request-id")!
        : crypto.randomUUID(),
      p_command_id: commandId,
      p_target_user_id: userId,
      p_employee_id: employeeResult.data.id,
      p_expected_version: expectedVersion,
      p_payload: {
        role_touched: roleTouched,
        role: requestedRole || String(previous.role || ""),
        full_name_touched: fullNameTouched,
        full_name: fullName,
        phone_touched: phoneTouched,
        phone: phone || null,
      },
    });
    if (result.error) return message(result.error.message, rpcStatus(result.error.code));

    return json(await loadSingleFinanceMember(auth.orgId, userId));
  } catch (error) {
    return message(error);
  }
}
