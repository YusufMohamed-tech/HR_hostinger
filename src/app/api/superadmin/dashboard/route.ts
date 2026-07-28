import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperadmin } from "@/lib/superadmin/server";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  gte: (column: string, value: unknown) => QueryBuilder;
  lte: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  range: (from: number, to: number) => QueryBuilder;
  then: PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null; count?: number | null }>["then"];
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function monthStartKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isActive(value: unknown) {
  return String(value || "active").trim().toLowerCase() === "active";
}

function isDoneStatus(value: unknown) {
  const status = String(value || "").toLowerCase();
  return ["done", "completed", "complete", "closed", "approved", "reviewed", "hired"].includes(status);
}

function isPendingStatus(value: unknown) {
  const status = String(value || "").toLowerCase();
  return status.includes("pending") || ["new", "submitted", "in_progress", "open"].includes(status);
}

function money(value: number) {
  return Math.round(value).toLocaleString("ar-SA");
}

function labelRole(role: string) {
  const labels: Record<string, string> = {
    admin: "Admin",
    hr_admin: "HR Admin",
    hr_recruitment: "HR Recruitment",
    training_manager: "Training Manager",
    sales: "Sales",
    sales_manager: "Sales Manager",
    onground_agent_manager: "On-ground Agent Manager",
    inventory_receiver: "Inventory Receiver",
    promoter: "Promoter",
    employee: "Employee",
  };
  return labels[role] || role || "غير محدد";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "organization.created": "إنشاء منظمة",
    "organization.updated": "تحديث منظمة",
    "organization.suspended": "إيقاف منظمة",
    "organization.activated": "تفعيل منظمة",
    "organization_user.created": "إنشاء مستخدم",
    "organization_user.updated": "تحديث مستخدم",
    "organization_user.suspended": "إيقاف مستخدم",
    "organization_user.activated": "تفعيل مستخدم",
    "organization_user.password_reset": "إعادة تعيين كلمة مرور",
    "superadmin.leave.approved": "اعتماد إجازة من المشرف العام",
    "superadmin.leave.rejected": "رفض إجازة من المشرف العام",
    "superadmin.task.created": "إسناد مهمة من المشرف العام",
  };
  return labels[action] || action || "نشاط";
}

function statusLabel(status: unknown) {
  const value = String(status || "").toLowerCase();
  const labels: Record<string, string> = {
    active: "نشط",
    inactive: "غير نشط",
    suspended: "موقوف",
    pending: "معلق",
    approved: "معتمد",
    rejected: "مرفوض",
    completed: "مكتمل",
    done: "مكتمل",
    in_progress: "قيد التنفيذ",
    open: "مفتوح",
    new: "جديد",
    submitted: "مرسل",
    reviewed: "تمت المراجعة",
    assigned: "مسلم",
    returned: "مرتجع",
  };
  return labels[value] || String(status || "غير محدد");
}

function fromTable(table: string) {
  const admin = createAdminClient();
  return (admin.from as unknown as (tableName: string) => QueryBuilder)(table);
}

async function safeRows(table: string, configure?: (query: QueryBuilder) => QueryBuilder, limit = 2000): Promise<Row[]> {
  try {
    let query = fromTable(table).select("*").range(0, Math.max(0, limit - 1));
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) {
      console.warn(`Superadmin dashboard skipped ${table}: ${error.message || error.code}`);
      return [];
    }
    return Array.isArray(data) ? (data as Row[]) : [];
  } catch (error) {
    console.warn(`Superadmin dashboard skipped ${table}:`, error);
    return [];
  }
}

async function safeCount(table: string, configure?: (query: QueryBuilder) => QueryBuilder): Promise<number> {
  try {
    let query = fromTable(table).select("id", { count: "exact", head: true });
    if (configure) query = configure(query);
    const { count, error } = await query;
    if (error) {
      console.warn(`Superadmin dashboard count skipped ${table}: ${error.message || error.code}`);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    console.warn(`Superadmin dashboard count skipped ${table}:`, error);
    return 0;
  }
}

function countBy<T extends Row>(rows: T[], predicate: (row: T) => boolean) {
  return rows.reduce((sum, row) => sum + (predicate(row) ? 1 : 0), 0);
}

function sumBy<T extends Row>(rows: T[], getter: (row: T) => number) {
  return rows.reduce((sum, row) => sum + getter(row), 0);
}

function createOrgMap(organizations: Row[]) {
  return new Map(organizations.map((org) => [String(org.id || ""), org]));
}

function createProfileMap(profiles: Row[]) {
  return new Map(profiles.map((profile) => [String(profile.user_id || ""), profile]));
}

function createEmployeeMap(employees: Row[]) {
  return new Map(employees.map((employee) => [String(employee.id || ""), employee]));
}

function profileName(profile: Row | undefined) {
  return asText(profile?.full_name, asText(profile?.email, "مستخدم غير معروف"));
}

function employeeName(employee: Row | undefined) {
  return asText(employee?.full_name, asText(employee?.email, "موظف غير معروف"));
}

export async function GET() {
  const auth = await requireSuperadmin();
  if ("error" in auth) return auth.error;

  const today = new Date();
  const todayIso = dateKey(today);
  const monthStart = monthStartKey(today);
  const last30Start = dateKey(addDays(today, -29));

  const [
    organizations,
    memberships,
    profiles,
    employees,
    departmentsCount,
    locationsCount,
    shiftsCount,
    attendanceToday,
    attendanceRecent,
    leaveRequests,
    tasks,
    taskUpdates,
    jobPostings,
    jobApplications,
    salesLogs,
    salesProductsCount,
    salesCompanies,
    salesAssignments,
    salesEditRequests,
    assets,
    payslips,
    balances,
    advanceRequests,
    chatConversationsCount,
    chatMessages,
    notifications,
    platformAudits,
    auditLogs,
  ] = await Promise.all([
    safeRows("organizations", (query) => query.order("created_at", { ascending: false }), 1000),
    safeRows("org_members", undefined, 5000),
    safeRows("profiles", (query) => query.order("created_at", { ascending: false }), 5000),
    safeRows("employees", (query) => query.order("created_at", { ascending: false }), 6000),
    safeCount("departments"),
    safeCount("locations"),
    safeCount("shifts"),
    safeRows("attendance_records", (query) => query.eq("work_date", todayIso).order("created_at", { ascending: false }), 2000),
    safeRows("attendance_records", (query) => query.gte("work_date", last30Start).order("created_at", { ascending: false }).limit(80), 80),
    safeRows("leave_requests", (query) => query.order("requested_at", { ascending: false }), 3000),
    safeRows("tasks", (query) => query.order("updated_at", { ascending: false }), 3000),
    safeRows("task_updates", (query) => query.order("created_at", { ascending: false }).limit(80), 80),
    safeRows("job_postings", (query) => query.order("created_at", { ascending: false }), 2000),
    safeRows("job_applications", (query) => query.order("applied_at", { ascending: false }), 3000),
    safeRows("sales_logs", (query) => query.gte("log_date", last30Start).lte("log_date", todayIso).order("created_at", { ascending: false }), 6000),
    safeCount("sales_products"),
    safeRows("sales_companies", (query) => query.order("created_at", { ascending: false }), 1000),
    safeRows("sales_company_assignments", undefined, 3000),
    safeRows("sales_log_edit_requests", (query) => query.order("created_at", { ascending: false }), 1000),
    safeRows("employee_assets", (query) => query.order("created_at", { ascending: false }), 3000),
    safeRows("payslips", (query) => query.order("created_at", { ascending: false }), 3000),
    safeRows("financial_balances", (query) => query.order("created_at", { ascending: false }), 3000),
    safeRows("advance_requests", (query) => query.order("created_at", { ascending: false }), 2000),
    safeCount("chat_conversations"),
    safeRows("chat_messages", (query) => query.order("created_at", { ascending: false }).limit(80), 80),
    safeRows("notifications", (query) => query.order("created_at", { ascending: false }), 3000),
    safeRows("platform_audit_logs", (query) => query.order("created_at", { ascending: false }).limit(80), 80),
    safeRows("audit_logs", (query) => query.order("created_at", { ascending: false }).limit(80), 80),
  ]);

  const orgMap = createOrgMap(organizations);
  const profileMap = createProfileMap(profiles);
  const employeeMap = createEmployeeMap(employees);
  const taskMap = new Map(tasks.map((task) => [String(task.id || ""), task]));

  const activeOrganizations = countBy(organizations, (org) => isActive(org.status));
  const activeUsers = countBy(profiles, (profile) => isActive(profile.account_status));
  const activeEmployees = countBy(employees, (employee) => isActive(employee.status));
  const roleCounts = memberships.reduce<Record<string, number>>((acc, member) => {
    const role = String(member.role || "unknown");
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  const todayLate = countBy(attendanceToday, (row) => String(row.status || "").toLowerCase() === "late" || asNumber(row.late_minutes) > 0);
  const todayAbsent = countBy(attendanceToday, (row) => String(row.status || "").toLowerCase() === "absent");
  const todayPresent = Math.max(0, attendanceToday.length - todayLate - todayAbsent);

  const leavePending = countBy(leaveRequests, (row) => isPendingStatus(row.status));
  const leaveApproved = countBy(leaveRequests, (row) => String(row.status || "").toLowerCase() === "approved");
  const leaveRejected = countBy(leaveRequests, (row) => String(row.status || "").toLowerCase() === "rejected");

  const openTasks = countBy(tasks, (task) => !isDoneStatus(task.status));
  const completedTasks = countBy(tasks, (task) => isDoneStatus(task.status));
  const overdueTasks = countBy(tasks, (task) => !isDoneStatus(task.status) && Boolean(task.due_date) && String(task.due_date) < todayIso);

  const openPostings = countBy(jobPostings, (posting) => ["open", "published"].includes(String(posting.status || "").toLowerCase()));
  const newApplications = countBy(jobApplications, (application) => ["new", "screening"].includes(String(application.status || "").toLowerCase()));
  const hiredApplications = countBy(jobApplications, (application) => String(application.status || "").toLowerCase() === "hired");

  const salesLast30Total = sumBy(salesLogs, (log) => asNumber(log.grand_total));
  const salesMonthTotal = sumBy(salesLogs.filter((log) => String(log.log_date || "") >= monthStart), (log) => asNumber(log.grand_total));
  const activeSalesCompanies = countBy(salesCompanies, (company) => company.is_active !== false);
  const activeSalesAssignments = countBy(salesAssignments, (assignment) => assignment.is_active !== false);
  const pendingSalesEditRequests = countBy(salesEditRequests, (request) => String(request.status || "").toLowerCase() === "pending");

  const payrollNet = sumBy(payslips, (payslip) => asNumber(payslip.net_salary));
  const openBalancesAmount = sumBy(balances.filter((balance) => !isDoneStatus(balance.status)), (balance) => asNumber(balance.amount));
  const pendingAdvanceRequests = countBy(advanceRequests, (request) => String(request.status || "").toLowerCase() === "pending");
  const pendingAdvanceAmount = sumBy(
    advanceRequests.filter((request) => String(request.status || "").toLowerCase() === "pending"),
    (request) => asNumber(request.requested_amount)
  );

  const assignedAssets = countBy(assets, (asset) => String(asset.status || "").toLowerCase() === "assigned");
  const returnedAssets = countBy(assets, (asset) => String(asset.status || "").toLowerCase() === "returned");
  const signedAssets = countBy(assets, (asset) => Boolean(asset.acknowledgment_signature_url || asset.acknowledged_at));

  const unreadNotifications = countBy(notifications, (notification) => notification.is_read === false);

  const moduleCards = [
    {
      key: "organizations",
      label: "المنظمات",
      value: organizations.length,
      helper: `${activeOrganizations} نشطة / ${organizations.length - activeOrganizations} موقوفة`,
      href: "/superadmin/organizations",
      tone: "emerald",
    },
    {
      key: "users",
      label: "المستخدمون والأدوار",
      value: profiles.length,
      helper: `${activeUsers} حساب نشط`,
      href: "/superadmin/users",
      tone: "blue",
    },
    {
      key: "employees",
      label: "الموظفون",
      value: employees.length,
      helper: `${activeEmployees} موظف نشط`,
      href: "/employees",
      tone: "slate",
    },
    {
      key: "attendance",
      label: "الحضور اليوم",
      value: attendanceToday.length,
      helper: `${todayPresent} حضور · ${todayLate} متأخر · ${todayAbsent} غياب`,
      href: "/attendance",
      tone: "amber",
    },
    {
      key: "leaves",
      label: "الإجازات",
      value: leavePending,
      helper: `${leaveApproved} معتمد · ${leaveRejected} مرفوض`,
      href: "/superadmin/approvals",
      tone: leavePending > 0 ? "red" : "emerald",
    },
    {
      key: "tasks",
      label: "المهام",
      value: openTasks,
      helper: `${completedTasks} مكتملة · ${overdueTasks} متأخرة`,
      href: "/tasks",
      tone: overdueTasks > 0 ? "red" : "blue",
    },
    {
      key: "recruitment",
      label: "التوظيف",
      value: jobApplications.length,
      helper: `${openPostings} إعلان مفتوح · ${newApplications} طلب جديد`,
      href: "/recruitment",
      tone: "violet",
    },
    {
      key: "sales",
      label: "المبيعات",
      value: `${money(salesMonthTotal)} ريال`,
      helper: `${money(salesLast30Total)} ريال آخر 30 يوم`,
      href: "/sales/dashboard",
      tone: "emerald",
    },
    {
      key: "payroll",
      label: "الرواتب",
      value: `${money(payrollNet)} ريال`,
      helper: `${payslips.length} مسير راتب`,
      href: "/payroll",
      tone: "slate",
    },
    {
      key: "assets",
      label: "العهد والأصول",
      value: assignedAssets,
      helper: `${signedAssets} موقع · ${returnedAssets} مرتجع`,
      href: "/assets",
      tone: "blue",
    },
    {
      key: "finance",
      label: "السلف والأرصدة",
      value: pendingAdvanceRequests,
      helper: `${money(pendingAdvanceAmount)} ريال سلف معلقة · ${money(openBalancesAmount)} ريال أرصدة مفتوحة`,
      href: "/balances",
      tone: pendingAdvanceRequests > 0 ? "amber" : "emerald",
    },
    {
      key: "communications",
      label: "الشات والإشعارات",
      value: chatMessages.length,
      helper: `${unreadNotifications} إشعار غير مقروء`,
      href: "/chat",
      tone: unreadNotifications > 0 ? "red" : "slate",
    },
  ];

  const decisionQueue = [
    { key: "leave", label: "طلبات إجازة معلقة", value: leavePending, href: "/superadmin/approvals" },
    { key: "tasks", label: "مهام متأخرة", value: overdueTasks, href: "/tasks" },
    { key: "advance", label: "طلبات سلفة معلقة", value: pendingAdvanceRequests, href: "/balances" },
    { key: "sales-edit", label: "طلبات تعديل مبيعات", value: pendingSalesEditRequests, href: "/sales/reports" },
    { key: "notifications", label: "إشعارات غير مقروءة", value: unreadNotifications, href: "/notifications" },
  ];

  const activities: Array<{
    id: string;
    source: string;
    title: string;
    description: string;
    actor: string;
    organization: string;
    occurred_at: string;
    href: string;
  }> = [];

  for (const log of platformAudits) {
    activities.push({
      id: `platform-${log.id}`,
      source: "platform",
      title: actionLabel(String(log.action || "")),
      description: String(log.target_type || "platform"),
      actor: profileName(profileMap.get(String(log.actor_user_id || ""))),
      organization: asText(orgMap.get(String(log.target_org_id || ""))?.name, "المنصة"),
      occurred_at: String(log.created_at || ""),
      href: "/superadmin/audit",
    });
  }

  for (const log of auditLogs) {
    activities.push({
      id: `audit-${log.id}`,
      source: "audit",
      title: actionLabel(String(log.action || "")),
      description: `${asText(log.entity, "كيان")} ${asText(log.entity_id, "")}`.trim(),
      actor: profileName(profileMap.get(String(log.actor_user_id || ""))),
      organization: asText(orgMap.get(String(log.org_id || ""))?.name, "منظمة"),
      occurred_at: String(log.created_at || ""),
      href: "/superadmin/audit",
    });
  }

  for (const update of taskUpdates) {
    const task = taskMap.get(String(update.task_id || ""));
    activities.push({
      id: `task-update-${update.id}`,
      source: "task",
      title: "تحديث مهمة",
      description: `${asText(task?.title, "مهمة")} · ${asText(update.note, statusLabel(update.status))}`,
      actor: employeeName(employeeMap.get(String(update.employee_id || ""))),
      organization: asText(orgMap.get(String(update.org_id || ""))?.name, "منظمة"),
      occurred_at: String(update.created_at || ""),
      href: "/tasks",
    });
  }

  for (const request of leaveRequests.slice(0, 30)) {
    const employee = employeeMap.get(String(request.employee_id || ""));
    activities.push({
      id: `leave-${request.id}`,
      source: "leave",
      title: "طلب إجازة",
      description: `${employeeName(employee)} · ${statusLabel(request.status)} · ${asText(request.start_date)} إلى ${asText(request.end_date)}`,
      actor: employeeName(employee),
      organization: asText(orgMap.get(String(request.org_id || ""))?.name, "منظمة"),
      occurred_at: String(request.decided_at || request.requested_at || ""),
      href: "/superadmin/approvals",
    });
  }

  for (const application of jobApplications.slice(0, 30)) {
    activities.push({
      id: `application-${application.id}`,
      source: "recruitment",
      title: "تقديم جديد",
      description: `${asText(application.candidate_name, "مرشح")} · ${statusLabel(application.status)}`,
      actor: asText(application.candidate_name, "مرشح"),
      organization: asText(orgMap.get(String(application.org_id || ""))?.name, "منظمة"),
      occurred_at: String(application.applied_at || application.created_at || application.updated_at || ""),
      href: "/recruitment",
    });
  }

  for (const log of salesLogs.slice(0, 30)) {
    activities.push({
      id: `sales-${log.id}`,
      source: "sales",
      title: "تقرير مبيعات",
      description: `${money(asNumber(log.grand_total))} ريال · ${statusLabel(log.status)}`,
      actor: profileName(profileMap.get(String(log.sales_agent_id || ""))),
      organization: asText(orgMap.get(String(log.organization_id || ""))?.name, "منظمة"),
      occurred_at: String(log.created_at || log.log_date || ""),
      href: "/sales/dashboard",
    });
  }

  for (const message of chatMessages.slice(0, 30)) {
    activities.push({
      id: `chat-${message.id}`,
      source: "chat",
      title: "رسالة شات",
      description: asText(message.body, "مرفق أو رسالة بدون نص").slice(0, 120),
      actor: profileName(profileMap.get(String(message.sender_user_id || ""))) || employeeName(employeeMap.get(String(message.sender_employee_id || ""))),
      organization: asText(orgMap.get(String(message.org_id || ""))?.name, "منظمة"),
      occurred_at: String(message.created_at || ""),
      href: "/chat",
    });
  }

  for (const record of attendanceRecent.slice(0, 20)) {
    const employee = employeeMap.get(String(record.employee_id || ""));
    activities.push({
      id: `attendance-${record.id}`,
      source: "attendance",
      title: "تسجيل حضور",
      description: `${employeeName(employee)} · ${statusLabel(record.status)} · تأخير ${asNumber(record.late_minutes)} دقيقة`,
      actor: employeeName(employee),
      organization: asText(orgMap.get(String(record.org_id || ""))?.name, "منظمة"),
      occurred_at: String(record.check_in_at || record.created_at || ""),
      href: "/attendance",
    });
  }

  const recentActivity = activities
    .filter((item) => item.occurred_at)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 24);

  const recentUsers = profiles.slice(0, 8).map((profile) => {
    const membership = memberships.find((member) => String(member.user_id || "") === String(profile.user_id || ""));
    return {
      id: String(profile.user_id || ""),
      name: profileName(profile),
      email: asText(profile.email),
      role: labelRole(String(membership?.role || "")),
      status: statusLabel(profile.account_status),
      organization: asText(orgMap.get(String(profile.org_id || ""))?.name, "منظمة"),
      created_at: String(profile.created_at || ""),
    };
  });

  return NextResponse.json({
    data: {
      generated_at: new Date().toISOString(),
      stats: {
        organizations: { total: organizations.length, active: activeOrganizations, suspended: organizations.length - activeOrganizations },
        users: { total: profiles.length, active: activeUsers, suspended: profiles.length - activeUsers, roles: roleCounts },
        employees: { total: employees.length, active: activeEmployees },
        structure: { departments: departmentsCount, locations: locationsCount, shifts: shiftsCount },
        attendanceToday: { total: attendanceToday.length, present: todayPresent, late: todayLate, absent: todayAbsent },
        leaves: { total: leaveRequests.length, pending: leavePending, approved: leaveApproved, rejected: leaveRejected },
        tasks: { total: tasks.length, open: openTasks, completed: completedTasks, overdue: overdueTasks },
        recruitment: { postings: jobPostings.length, openPostings, applications: jobApplications.length, newApplications, hired: hiredApplications },
        sales: {
          totalLast30: salesLast30Total,
          totalMonth: salesMonthTotal,
          logsLast30: salesLogs.length,
          companies: salesCompanies.length,
          activeCompanies: activeSalesCompanies,
          products: salesProductsCount,
          activeAssignments: activeSalesAssignments,
          pendingEditRequests: pendingSalesEditRequests,
        },
        finance: {
          payslips: payslips.length,
          payrollNet,
          balances: balances.length,
          openBalancesAmount,
          advanceRequests: advanceRequests.length,
          pendingAdvanceRequests,
          pendingAdvanceAmount,
        },
        assets: { total: assets.length, assigned: assignedAssets, returned: returnedAssets, signed: signedAssets },
        communication: { conversations: chatConversationsCount, recentMessages: chatMessages.length, notifications: notifications.length, unreadNotifications },
      },
      moduleCards,
      decisionQueue,
      recentActivity,
      recentUsers,
      organizations: organizations.slice(0, 8).map((org) => ({
        id: String(org.id || ""),
        name: asText(org.name, "منظمة"),
        slug: asText(org.slug),
        status: statusLabel(org.status),
        raw_status: String(org.status || ""),
        members: countBy(memberships, (member) => String(member.org_id || "") === String(org.id || "")),
        employees: countBy(employees, (employee) => String(employee.org_id || "") === String(org.id || "")),
        created_at: String(org.created_at || ""),
      })),
    },
  });
}
