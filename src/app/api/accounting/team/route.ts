import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/utils/audit";

const financeRoles = new Set(["finance_manager", "accountant", "finance_viewer"]);
const financeTeamViewRoles = new Set(["admin", "hr_admin", "finance_manager"]);
const financeTeamManageRoles = new Set(["admin", "hr_admin"]);
const protectedExistingRoles = new Set(["admin", "hr_admin", "hr_recruitment", "sales", "sales_manager"]);

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
    .in("role", Array.from(financeRoles));
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
      .select("id, user_id, job_title, status")
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
  const password = String(body.password || "");
  const phone = String(body.phone || "").trim();
  const role = String(body.role || "").trim().toLowerCase();

  if (fullName.length < 2) return message("اسم المستخدم مطلوب.", 400);
  if (!email.includes("@")) return message("بريد إلكتروني صحيح مطلوب.", 400);
  if (password.length < 8) return message("كلمة المرور يجب ألا تقل عن 8 أحرف.", 400);
  if (!financeRoles.has(role)) return message("يمكن تعيين أدوار المالية فقط من هذه الصفحة.", 400);

  const admin = createAdminClient();

  try {
    const existing = await getAuthUserByEmail(email);
    if (existing) {
      const { data: membership, error: membershipError } = await admin
        .from("org_members")
        .select("org_id, role")
        .eq("user_id", existing.id)
        .maybeSingle();
      if (membershipError) throw new Error(membershipError.message);

      const member = membership as Record<string, unknown> | null;
      if (member && String(member.org_id || "") !== auth.orgId) {
        return message("هذا البريد مرتبط بمنظمة أخرى.", 409);
      }
      if (member && protectedExistingRoles.has(String(member.role || ""))) {
        return message("هذا الحساب لديه دور إداري أو مبيعات. غيّر الدور من شاشة إدارة المستخدمين العامة.", 409);
      }
    }

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

    if (authResult.error || !authResult.data.user) {
      return message(authResult.error?.message || "تعذر إنشاء حساب المستخدم.", 500);
    }

    const userId = authResult.data.user.id;
    const profileError = (await admin.from("profiles").upsert({
      user_id: userId,
      org_id: auth.orgId,
      full_name: fullName,
      email,
      phone: phone || null,
      title: titleForRole(role),
      account_status: "active",
    } as never, { onConflict: "user_id" })).error;
    if (profileError) throw new Error(profileError.message);

    const memberError = (await admin.from("org_members").upsert({
      org_id: auth.orgId,
      user_id: userId,
      role,
    } as never, { onConflict: "org_id,user_id" })).error;
    if (memberError) throw new Error(memberError.message);

    await writeAuditLog(admin, {
      org_id: auth.orgId,
      actor_user_id: auth.user.id,
      action: existing ? "accounting.finance_team_user_updated" : "accounting.finance_team_user_created",
      entity: "org_members",
      entity_id: userId,
      new_values: { email, full_name: fullName, role },
    });

    return json(await loadSingleFinanceMember(auth.orgId, userId), existing ? 200 : 201);
  } catch (error) {
    return message(error);
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

  if (!userId) return message("معرف المستخدم مطلوب.", 400);
  if (requestedRole && !financeRoles.has(requestedRole)) return message("يمكن تعيين أدوار المالية فقط من هذه الصفحة.", 400);
  if (status && !["active", "inactive", "suspended"].includes(status)) return message("حالة الحساب غير صحيحة.", 400);

  const admin = createAdminClient();

  try {
    const { data: membership, error: membershipError } = await admin
      .from("org_members")
      .select("org_id, user_id, role")
      .eq("org_id", auth.orgId)
      .eq("user_id", userId)
      .in("role", Array.from(financeRoles))
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) return message("عضو فريق المالية غير موجود داخل هذه المنظمة.", 404);

    const previous = membership as Record<string, unknown>;
    const profileValues: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const employeeValues: Record<string, unknown> = {};

    if (fullName) {
      profileValues.full_name = fullName;
      employeeValues.full_name = fullName;
    }
    if ("phone" in body) {
      profileValues.phone = phone || null;
      employeeValues.phone = phone || null;
    }
    if (status) {
      profileValues.account_status = status;
      employeeValues.status = status === "active" ? "Active" : "Inactive";
    }
    if (requestedRole) {
      profileValues.title = titleForRole(requestedRole);
      employeeValues.job_title = titleForRole(requestedRole);
    }

    if (requestedRole) {
      const roleError = (await admin
        .from("org_members")
        .update({ role: requestedRole } as never)
        .eq("org_id", auth.orgId)
        .eq("user_id", userId)
        .in("role", Array.from(financeRoles))).error;
      if (roleError) throw new Error(roleError.message);
    }

    if (Object.keys(profileValues).length > 1) {
      const profileError = (await admin
        .from("profiles")
        .update(profileValues as never)
        .eq("org_id", auth.orgId)
        .eq("user_id", userId)).error;
      if (profileError) throw new Error(profileError.message);
    }

    if (Object.keys(employeeValues).length > 0) {
      const employeeError = (await admin
        .from("employees")
        .update(employeeValues as never)
        .eq("org_id", auth.orgId)
        .eq("user_id", userId)).error;
      if (employeeError) throw new Error(employeeError.message);
    }

    await writeAuditLog(admin, {
      org_id: auth.orgId,
      actor_user_id: auth.user.id,
      action: status && status !== "active"
        ? "accounting.finance_team_user_deactivated"
        : status === "active"
          ? "accounting.finance_team_user_activated"
          : requestedRole
            ? "accounting.finance_team_role_updated"
            : "accounting.finance_team_user_updated",
      entity: "org_members",
      entity_id: userId,
      old_values: { role: String(previous.role || "") },
      new_values: {
        role: requestedRole || String(previous.role || ""),
        full_name: fullName || undefined,
        phone: "phone" in body ? phone || null : undefined,
        status: status || undefined,
      },
    });

    return json(await loadSingleFinanceMember(auth.orgId, userId));
  } catch (error) {
    return message(error);
  }
}
