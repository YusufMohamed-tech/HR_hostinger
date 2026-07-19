import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import {
  beginEmployeeOnboarding,
  EmployeeLifecycleError,
  inviteAndLinkEmployeeIdentity,
  offboardEmployee,
} from "@/lib/server/employee-lifecycle";
import { queueIdentityDeletion } from "@/lib/server/identity-reconciliation";

type AuthContext = {
  user: { id: string; email?: string | null };
  orgId: string;
  role: string;
  isManager: boolean;
};

type AssignmentInput = {
  company_id?: string;
  assignment_role?: string;
  start_date?: string;
  end_date?: string | null;
  daily_target?: number | string | null;
  target_notes?: string | null;
  notes?: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function toMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
}

function isOrgSalesAdmin(role: string) {
  return role === "admin" || role === "hr_admin";
}

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = todayIso();
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

function activeEmployeeShift(employee: Record<string, unknown>) {
  const rows = Array.isArray(employee.employee_shifts) ? employee.employee_shifts as Record<string, unknown>[] : [];
  return rows
    .filter(isActiveAssignment)
    .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")))[0] || null;
}

function normalizeAssignment(input: AssignmentInput) {
  const companyId = String(input.company_id || "").trim();
  const role = String(input.assignment_role || "").trim() === "manager" ? "manager" : "sales";
  const startDate = validDate(input.start_date) || todayIso();
  const endDate = validDate(input.end_date) || null;
  const targetNotes = String(input.target_notes || input.notes || "").trim();
  return companyId ? {
    company_id: companyId,
    assignment_role: role,
    start_date: startDate,
    end_date: endDate,
    daily_target: toMoney(input.daily_target),
    target_notes: targetNotes || null,
    notes: input.notes || null,
  } : null;
}

function uniqueAssignments(raw: unknown) {
  const inputs = Array.isArray(raw) ? raw as AssignmentInput[] : [];
  const map = new Map<string, NonNullable<ReturnType<typeof normalizeAssignment>>>();
  for (const input of inputs) {
    const normalized = normalizeAssignment(input);
    if (!normalized) continue;
    map.set(`${normalized.company_id}:${normalized.assignment_role}`, normalized);
  }
  return Array.from(map.values());
}

async function getManagedCompanyIds(
  admin: ReturnType<typeof createAdminClient>,
  auth: AuthContext
) {
  if (isOrgSalesAdmin(auth.role)) return null;

  const result = await admin
    .from("sales_company_assignments")
    .select("company_id, assignment_role, start_date, end_date, is_active")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .eq("assignment_role", "manager")
    .eq("is_active", true);

  if (result.error) throw result.error;

  return ((result.data ?? []) as Record<string, unknown>[])
    .filter(isActiveAssignment)
    .map((assignment) => String(assignment.company_id || ""))
    .filter(Boolean);
}

async function assertCompaniesInScope(
  admin: ReturnType<typeof createAdminClient>,
  auth: AuthContext,
  companyIds: string[]
) {
  if (companyIds.length === 0) return { ok: true as const, managedCompanyIds: await getManagedCompanyIds(admin, auth) };

  const companiesResult = await admin
    .from("sales_companies")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("is_active", true)
    .in("id", companyIds);

  if (companiesResult.error) return { ok: false as const, message: companiesResult.error.message, status: 500 };

  const existingIds = new Set(((companiesResult.data ?? []) as Record<string, unknown>[]).map((company) => String(company.id)));
  if (companyIds.some((companyId) => !existingIds.has(companyId))) {
    return { ok: false as const, message: "اختر شركات مبيعات صحيحة داخل نفس المنظمة.", status: 400 };
  }

  const managedCompanyIds = await getManagedCompanyIds(admin, auth);
  if (Array.isArray(managedCompanyIds)) {
    const managed = new Set(managedCompanyIds);
    if (companyIds.some((companyId) => !managed.has(companyId))) {
      return { ok: false as const, message: "مدير المبيعات لا يستطيع إدارة إلا الشركات المسندة إليه كمدير.", status: 403 };
    }
  }

  return { ok: true as const, managedCompanyIds };
}

function roleAssignmentsAreValid(role: string, assignments: ReturnType<typeof uniqueAssignments>) {
  if (role === "sales") return assignments.every((assignment) => assignment.assignment_role === "sales");
  return assignments.some((assignment) => assignment.assignment_role === "manager");
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505" || code === "40001") return 409;
  if (["22023", "23503", "23514", "23502"].includes(code || "")) return 400;
  return 500;
}

async function executeSalesTeamCommand(
  admin: ReturnType<typeof createAdminClient>,
  auth: AuthContext,
  values: {
    commandId: string;
    targetUserId: string;
    employeeId: string;
    expectedVersion: number;
    fullName: string;
    phone: string;
    nationalId: string;
    role: "sales" | "sales_manager";
    locationId: string;
    shiftId: string;
    locationTouched: boolean;
    shiftTouched: boolean;
    assignments: ReturnType<typeof uniqueAssignments>;
  }
) {
  return admin.rpc("execute_sales_team_command", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: crypto.randomUUID(),
    p_command_id: values.commandId,
    p_target_user_id: values.targetUserId,
    p_employee_id: values.employeeId,
    p_expected_version: values.expectedVersion,
    p_payload: {
      full_name: values.fullName,
      phone: values.phone || null,
      national_id: values.nationalId || null,
      role: values.role,
      location_touched: values.locationTouched,
      location_id: values.locationId || null,
      shift_touched: values.shiftTouched,
      shift_id: values.shiftId || null,
      company_assignments: values.assignments,
    },
  });
}

async function loadTeam(orgId: string, visibleCompanyIds?: string[] | null) {
  const admin = createAdminClient();
  if (Array.isArray(visibleCompanyIds) && visibleCompanyIds.length === 0) {
    return { data: [], error: null };
  }

  const [membersResult, profilesResult, employeesResult, assignmentsResult, companiesResult] = await Promise.all([
    admin.from("org_members").select("user_id, role, org_id").eq("org_id", orgId).in("role", ["sales", "sales_manager"]),
    admin.from("profiles").select("user_id, full_name, email, phone, account_status").eq("org_id", orgId),
    admin
      .from("employees")
      .select("id, user_id, national_id, status, job_title, location_id, lifecycle_version, location:location_id(id, name, city, radius_meters), employee_shifts(id, shift_id, start_date, end_date, shift:shift_id(id, name, start_time, end_time, location_id))")
      .eq("org_id", orgId),
    admin
      .from("sales_company_assignments")
      .select("id, user_id, company_id, assignment_role, start_date, end_date, daily_target, target_notes, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    admin.from("sales_companies").select("id, name, slug, code, brand_color, is_active").eq("organization_id", orgId),
  ]);

  if (membersResult.error) return { data: null, error: membersResult.error };
  if (profilesResult.error) return { data: null, error: profilesResult.error };
  if (employeesResult.error) return { data: null, error: employeesResult.error };
  if (assignmentsResult.error) return { data: null, error: assignmentsResult.error };
  if (companiesResult.error) return { data: null, error: companiesResult.error };

  const visibleSet = Array.isArray(visibleCompanyIds) ? new Set(visibleCompanyIds) : null;
  const companyById = new Map(((companiesResult.data ?? []) as Record<string, unknown>[]).map((company) => [String(company.id), company]));
  const profiles = new Map(((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id), profile]));
  const employees = new Map(((employeesResult.data ?? []) as Record<string, unknown>[]).map((employee) => [String(employee.user_id), employee]));
  const assignmentsByUser = new Map<string, Record<string, unknown>[]>();

  for (const assignment of ((assignmentsResult.data ?? []) as Record<string, unknown>[]).filter(isActiveAssignment)) {
    const companyId = String(assignment.company_id || "");
    if (visibleSet && !visibleSet.has(companyId)) continue;
    const userId = String(assignment.user_id || "");
    const company = companyById.get(companyId) || null;
    const list = assignmentsByUser.get(userId) || [];
    list.push({ ...assignment, company });
    assignmentsByUser.set(userId, list);
  }

  const team = ((membersResult.data ?? []) as Record<string, unknown>[])
    .map((member) => {
      const userId = String(member.user_id || "");
      const profile = profiles.get(userId) || {};
      const employee = employees.get(userId) || {};
      const activeShift = activeEmployeeShift(employee);
      const shiftRecord = (activeShift?.shift ?? null) as Record<string, unknown> | null;
      return {
        user_id: userId,
        org_id: String(member.org_id || ""),
        role: String(member.role || ""),
        full_name: String(profile.full_name || profile.email || "بائع"),
        email: String(profile.email || ""),
        phone: typeof profile.phone === "string" ? profile.phone : null,
        national_id: typeof employee.national_id === "string" ? employee.national_id : null,
        status: String(profile.account_status || employee.status || "active"),
        employee_id: String(employee.id || ""),
        lifecycle_version: Number(employee.lifecycle_version || 1),
        location_id: typeof employee.location_id === "string" ? employee.location_id : null,
        location: employee.location || null,
        shift_id: typeof activeShift?.shift_id === "string" ? activeShift.shift_id : null,
        shift: shiftRecord,
        company_assignments: assignmentsByUser.get(userId) || [],
      };
    })
    .filter((agent) => !visibleSet || agent.company_assignments.length > 0);

  return { data: team, error: null };
}

export async function GET() {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  let visibleCompanyIds: string[] | null = null;
  if (!isOrgSalesAdmin(auth.role)) {
    visibleCompanyIds = await getManagedCompanyIds(admin, auth);
  }

  const result = await loadTeam(auth.orgId, visibleCompanyIds);
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const fullName = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const nationalId = String(body.national_id || "").trim();
  const requestedRole = String(body.role || "sales").trim().toLowerCase();
  const salesRole = requestedRole === "sales_manager" ? "sales_manager" : "sales";
  const salesTitle = salesRole === "sales_manager" ? "Sales Manager" : "Sales";
  const locationId = typeof body.location_id === "string" ? body.location_id.trim() : "";
  const shiftId = typeof body.shift_id === "string" ? body.shift_id.trim() : "";
  const locationTouched = Object.prototype.hasOwnProperty.call(body, "location_id");
  const shiftTouched = Object.prototype.hasOwnProperty.call(body, "shift_id");
  const commandId = typeof body.command_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.command_id)
    ? body.command_id
    : "";

  if (fullName.length < 2) return NextResponse.json({ message: "اسم البائع مطلوب." }, { status: 400 });
  if (!email.includes("@")) return NextResponse.json({ message: "بريد إلكتروني صحيح مطلوب." }, { status: 400 });
  if (!commandId) return NextResponse.json({ message: "معرف عملية صالح مطلوب لحماية إنشاء الحساب من التكرار." }, { status: 400 });

  const admin = createAdminClient();
  const requestedAssignments = uniqueAssignments(body.company_assignments);
  if (requestedAssignments.length === 0) {
    return NextResponse.json({ message: "اسند البائع إلى شركة واحدة على الأقل." }, { status: 400 });
  }
  if (!roleAssignmentsAreValid(salesRole, requestedAssignments)) {
    return NextResponse.json({
      message: salesRole === "sales_manager"
        ? "مدير المبيعات يحتاج تعيين مدير لشركة واحدة على الأقل."
        : "حساب البائع لا يمكن أن يحمل تعيين مدير شركة.",
    }, { status: 400 });
  }

  const scope = await assertCompaniesInScope(admin, auth, requestedAssignments.map((assignment) => assignment.company_id));
  if (!scope.ok) return NextResponse.json({ message: scope.message }, { status: scope.status });

  let salesEmployeeId = "";
  let userId = "";
  let employeeVersion = 0;
  let invitedUser = false;
  try {
    const employee = await beginEmployeeOnboarding(admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      commandId,
      sourceType: "sales",
      sourceId: commandId,
      employee: {
        full_name: fullName,
        email,
        phone: phone || undefined,
        national_id: nationalId || undefined,
        job_title: salesTitle,
        location_id: locationId || undefined,
        hiring_date: todayIso(),
        leave_accrual_start_date: todayIso(),
        employment_type: "full_time",
        status: "Active",
      },
    });
    salesEmployeeId = String(employee.id || "");
    const identity = await inviteAndLinkEmployeeIdentity(admin, {
      orgId: auth.orgId,
      employeeId: salesEmployeeId,
      actorUserId: auth.user.id,
      commandId: crypto.randomUUID(),
      email,
      fullName,
      role: salesRole,
    });
    userId = identity.user.id;
    employeeVersion = Number(identity.employee.lifecycle_version || 0);
    invitedUser = identity.invited;
  } catch (error) {
    const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
    return NextResponse.json({ message: lifecycleError?.message || "تعذر بدء إعداد حساب المبيعات." }, { status: lifecycleError?.status || 500 });
  }

  const configuration = await executeSalesTeamCommand(admin, auth, {
    commandId,
    targetUserId: userId,
    employeeId: salesEmployeeId,
    expectedVersion: employeeVersion,
    fullName,
    phone,
    nationalId,
    role: salesRole,
    locationId,
    shiftId,
    locationTouched,
    shiftTouched,
    assignments: requestedAssignments,
  });
  if (configuration.error) {
    if (invitedUser) {
      try {
        await queueIdentityDeletion(admin, {
          orgId: auth.orgId,
          userId,
          sourceType: "failed_provisioning_cleanup",
          sourceId: commandId,
          reason: "Sales-team configuration failed after identity linking.",
          actorUserId: auth.user.id,
          requestId: auth.requestId,
        });
      } catch (error) {
        console.error("Unable to queue failed sales-team identity cleanup.", { userId, error });
      }
    }
    return NextResponse.json({ message: configuration.error.message }, { status: rpcStatus(configuration.error.code) });
  }

  const team = await loadTeam(auth.orgId, Array.isArray(scope.managedCompanyIds) ? scope.managedCompanyIds : null);
  if (team.error) return NextResponse.json({ message: team.error.message }, { status: 500 });
  const created = (team.data || []).find((agent) => agent.user_id === userId) || null;
  return NextResponse.json({ data: created, onboarding_required: true }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || "").trim();
  if (!userId) return NextResponse.json({ message: "معرف البائع مطلوب." }, { status: 400 });

  const admin = createAdminClient();
  const memberResult = await admin
    .from("org_members")
    .select("org_id, role")
    .eq("org_id", auth.orgId)
    .eq("user_id", userId)
    .in("role", ["sales", "sales_manager"])
    .maybeSingle();

  if (memberResult.error) return NextResponse.json({ message: memberResult.error.message }, { status: 500 });
  if (!memberResult.data) return NextResponse.json({ message: "البائع غير موجود داخل منظمتك." }, { status: 404 });

  const previousRole = String((memberResult.data as Record<string, unknown>).role || "");
  const employeeResult = await admin
    .from("employees")
    .select("id, lifecycle_version")
    .eq("org_id", auth.orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (employeeResult.error) return NextResponse.json({ message: employeeResult.error.message }, { status: 500 });

  const employeeRecord = (employeeResult.data || null) as Record<string, unknown> | null;
  const employeeId = String(employeeRecord?.id || "");

  const fullName = String(body.full_name || "").trim();
  const phone = String(body.phone || "").trim();
  const nationalId = String(body.national_id || "").trim();
  const status = String(body.status || "").trim().toLowerCase();
  const requestedRole = String(body.role || "").trim().toLowerCase();
  const nextRole = requestedRole === "sales" || requestedRole === "sales_manager" ? requestedRole : previousRole;
  const locationId = typeof body.location_id === "string" ? body.location_id.trim() : "";
  const shiftId = typeof body.shift_id === "string" ? body.shift_id.trim() : "";
  const locationTouched = Object.prototype.hasOwnProperty.call(body, "location_id");
  const shiftTouched = Object.prototype.hasOwnProperty.call(body, "shift_id");
  const commandId = typeof body.command_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.command_id)
    ? body.command_id
    : "";

  if (status) {
    if (status === "active" || status === "نشط") {
      return NextResponse.json({ message: "إعادة التفعيل تتطلب دورة إعادة تعيين موثقة من HR." }, { status: 409 });
    }
    if (!employeeId) return NextResponse.json({ message: "لا يوجد ملف موظف مرتبط بحساب المبيعات." }, { status: 409 });
    if (!isOrgSalesAdmin(auth.role)) {
      return NextResponse.json({ message: "إنهاء الخدمة قرار موارد بشرية ويتطلب مسؤول المنظمة أو مسؤول HR." }, { status: 403 });
    }
    if (!commandId) return NextResponse.json({ message: "معرف عملية صالح مطلوب لحماية إنهاء الخدمة من التكرار." }, { status: 400 });
    try {
      await offboardEmployee(admin, {
        orgId: auth.orgId,
        employeeId,
        actorUserId: auth.user.id,
        commandId,
        effectiveDate: todayIso(),
        reason: "Sales team access ended by an authorized administrator.",
        terminationType: "termination",
      });
      return NextResponse.json({ data: null });
    } catch (error) {
      const lifecycleError = error instanceof EmployeeLifecycleError ? error : null;
      return NextResponse.json({ message: lifecycleError?.message || "تعذر إنهاء خدمة عضو المبيعات." }, { status: lifecycleError?.status || 500 });
    }
  }

  const expectedVersion = Number(body.expected_version);
  const requestedAssignments = uniqueAssignments(body.company_assignments);
  if (!employeeId || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !commandId || fullName.length < 2) {
    return NextResponse.json({ message: "بيانات الموظف وإصدار السجل ومعرف العملية مطلوبة لإتمام التعديل بأمان." }, { status: 400 });
  }
  if (requestedAssignments.length === 0) {
    return NextResponse.json({ message: "اسند عضو المبيعات إلى شركة واحدة على الأقل." }, { status: 400 });
  }
  if (!roleAssignmentsAreValid(nextRole, requestedAssignments)) {
    return NextResponse.json({
      message: nextRole === "sales_manager"
        ? "مدير المبيعات يحتاج تعيين مدير لشركة واحدة على الأقل."
        : "حساب البائع لا يمكن أن يحمل تعيين مدير شركة.",
    }, { status: 400 });
  }
  const scope = await assertCompaniesInScope(admin, auth, requestedAssignments.map((assignment) => assignment.company_id));
  if (!scope.ok) return NextResponse.json({ message: scope.message }, { status: scope.status });

  const configuration = await executeSalesTeamCommand(admin, auth, {
    commandId,
    targetUserId: userId,
    employeeId,
    expectedVersion,
    fullName,
    phone,
    nationalId,
    role: nextRole as "sales" | "sales_manager",
    locationId,
    shiftId,
    locationTouched,
    shiftTouched,
    assignments: requestedAssignments,
  });
  if (configuration.error) {
    return NextResponse.json({ message: configuration.error.message }, { status: rpcStatus(configuration.error.code) });
  }

  const visibleCompanyIds = isOrgSalesAdmin(auth.role) ? null : await getManagedCompanyIds(admin, auth);
  const team = await loadTeam(auth.orgId, visibleCompanyIds);
  if (team.error) return NextResponse.json({ message: team.error.message }, { status: 500 });
  const updated = (team.data || []).find((agent) => agent.user_id === userId) || null;
  return NextResponse.json({ data: updated });
}
