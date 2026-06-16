import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

const arabicMonths = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const arabicDays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

type SalesAuth = {
  user: { id: string };
  orgId: string;
  role: string;
  isManager: boolean;
};

type DashboardSettings = {
  id?: string;
  organization_id?: string;
  company_id?: string | null;
  channel_title: string;
  partner_label: string;
  monthly_target: number;
  working_days: number;
  focus_1_label: string;
  focus_1_query: string;
  focus_2_label: string;
  focus_2_query: string;
  focus_3_label: string;
  focus_3_query: string;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfWeek(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return copy;
}

function monthKey(date: Date | string) {
  const value = typeof date === "string" ? date : dateKey(date);
  return value.slice(0, 7);
}

function monthLabel(key: string) {
  const monthIndex = Math.max(0, Math.min(11, Number(key.slice(5, 7)) - 1));
  return `${arabicMonths[monthIndex]} ${key.slice(0, 4)}`;
}

function monthKeysFromYearStart(today: Date) {
  const months: string[] = [];
  for (let month = 0; month <= today.getUTCMonth(); month += 1) {
    months.push(`${today.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}`);
  }
  return months;
}

function dailyKeys(today: Date) {
  return Array.from({ length: 30 }, (_, index) => {
    const date = addDays(today, index - 29);
    const key = dateKey(date);
    return { date: key, label: key.slice(5), total: 0 };
  });
}

function monthStartKey(today: Date) {
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function daysInMonth(today: Date) {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
}

function monthDayKey(today: Date, day: number) {
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = dateKey(new Date());
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

function defaultSettings(company?: Record<string, unknown> | null): DashboardSettings {
  return {
    company_id: company ? String(company.id || "") : null,
    channel_title: "Modern Trade Western Channel",
    partner_label: String(company?.code || company?.slug || company?.name || "chessboard_company"),
    monthly_target: 2270,
    working_days: 30,
    focus_1_label: "Yalla 20",
    focus_1_query: "Yalla 20",
    focus_2_label: "Yalla 30",
    focus_2_query: "Yalla 30",
    focus_3_label: "Above the Yalla 30",
    focus_3_query: "above:30",
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSettings(row: Record<string, unknown> | null | undefined, company?: Record<string, unknown> | null): DashboardSettings {
  const defaults = defaultSettings(company);
  return {
    id: typeof row?.id === "string" ? row.id : undefined,
    organization_id: typeof row?.organization_id === "string" ? row.organization_id : undefined,
    company_id: typeof row?.company_id === "string" ? row.company_id : defaults.company_id,
    channel_title: String(row?.channel_title || defaults.channel_title),
    partner_label: String(row?.partner_label || defaults.partner_label),
    monthly_target: clampNumber(row?.monthly_target, 0, 10000000, defaults.monthly_target),
    working_days: clampNumber(row?.working_days, 1, 31, defaults.working_days),
    focus_1_label: String(row?.focus_1_label || defaults.focus_1_label),
    focus_1_query: String(row?.focus_1_query || defaults.focus_1_query),
    focus_2_label: String(row?.focus_2_label || defaults.focus_2_label),
    focus_2_query: String(row?.focus_2_query || defaults.focus_2_query),
    focus_3_label: String(row?.focus_3_label || defaults.focus_3_label),
    focus_3_query: String(row?.focus_3_query || defaults.focus_3_query),
  };
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function getItems(log: Record<string, unknown>) {
  const items = Array.isArray(log.items) ? log.items : [];
  return items
    .map((item) => (item && typeof item === "object" ? item as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function getQuantity(item: Record<string, unknown>) {
  const quantity = Number(item.quantity || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function getUnitPrice(item: Record<string, unknown>) {
  const price = Number(item.unit_price || item.price || 0);
  return Number.isFinite(price) ? price : 0;
}

function itemMatchesFocus(item: Record<string, unknown>, queryValue: string) {
  const query = queryValue.trim().toLowerCase();
  if (!query) return false;
  const productName = String(item.product_name || item.name || "").toLowerCase();
  const unitPrice = getUnitPrice(item);
  const aboveMatch = query.match(/^above[:\s]+(\d+(?:\.\d+)?)$/);
  const priceMatch = query.match(/^price\s*>\s*(\d+(?:\.\d+)?)$/);
  if (aboveMatch) return unitPrice > Number(aboveMatch[1]);
  if (priceMatch) return unitPrice > Number(priceMatch[1]);
  return productName.includes(query);
}

async function getScopedCompanyIds(admin: ReturnType<typeof createAdminClient>, auth: SalesAuth) {
  if (["admin", "hr_admin"].includes(auth.role)) return null;
  const result = await admin
    .from("sales_company_assignments")
    .select("company_id, assignment_role, start_date, end_date, is_active")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (result.error) throw result.error;
  return ((result.data ?? []) as Record<string, unknown>[])
    .filter(isActiveAssignment)
    .map((assignment) => String(assignment.company_id))
    .filter(Boolean);
}

async function loadVisibleCompanies(admin: ReturnType<typeof createAdminClient>, auth: SalesAuth, scopedCompanyIds: string[] | null) {
  if (Array.isArray(scopedCompanyIds) && scopedCompanyIds.length === 0) return [];
  let query = admin
    .from("sales_companies")
    .select("id, name, slug, code, brand_color, is_active")
    .eq("organization_id", auth.orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (Array.isArray(scopedCompanyIds)) query = query.in("id", scopedCompanyIds);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data ?? []) as Record<string, unknown>[];
}

async function fetchPagedLogs(
  admin: ReturnType<typeof createAdminClient>,
  auth: SalesAuth,
  scopedCompanyIds: string[] | null,
  dateFrom: string,
  dateTo: string,
  selectedCompanyId?: string
) {
  if (Array.isArray(scopedCompanyIds) && scopedCompanyIds.length === 0) return [];

  const rows: Record<string, unknown>[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = admin
      .from("sales_logs")
      .select("sales_agent_id, log_date, grand_total, total_discount, company_id, items")
      .eq("organization_id", auth.orgId)
      .gte("log_date", dateFrom)
      .lte("log_date", dateTo)
      .order("log_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (!auth.isManager) query = query.eq("sales_agent_id", auth.user.id);
    if (selectedCompanyId) query = query.eq("company_id", selectedCompanyId);
    else if (Array.isArray(scopedCompanyIds)) query = query.in("company_id", scopedCompanyIds);

    const result = await query;
    if (result.error) throw result.error;
    const page = (result.data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function loadAgents(admin: ReturnType<typeof createAdminClient>, auth: SalesAuth, scopedCompanyIds: string[] | null) {
  const [membersResult, profilesResult, assignmentsResult] = await Promise.all([
    admin.from("org_members").select("user_id, role, org_id").eq("org_id", auth.orgId).in("role", ["sales", "sales_manager"]),
    admin.from("profiles").select("user_id, full_name, email, phone, account_status").eq("org_id", auth.orgId),
    admin.from("sales_company_assignments").select("user_id, company_id, assignment_role, start_date, end_date, is_active").eq("organization_id", auth.orgId),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const allowedCompanySet = Array.isArray(scopedCompanyIds) ? new Set(scopedCompanyIds) : null;
  const profiles = new Map(((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id), profile]));
  const assignmentsByUser = new Map<string, Record<string, unknown>[]>();

  for (const assignment of (assignmentsResult.data ?? []) as Record<string, unknown>[]) {
    const userId = String(assignment.user_id || "");
    const list = assignmentsByUser.get(userId) || [];
    list.push(assignment);
    assignmentsByUser.set(userId, list);
  }

  return ((membersResult.data ?? []) as Record<string, unknown>[])
    .map((member) => {
      const userId = String(member.user_id || "");
      const profile = profiles.get(userId) || {};
      const assignments = assignmentsByUser.get(userId) || [];
      return {
        user_id: userId,
        org_id: String(member.org_id || ""),
        role: String(member.role || ""),
        full_name: String(profile.full_name || profile.email || "بائع"),
        email: String(profile.email || ""),
        phone: typeof profile.phone === "string" ? profile.phone : null,
        status: String(profile.account_status || "active"),
        company_assignments: assignments,
      };
    })
    .filter((agent) => {
      if (!auth.isManager) return agent.user_id === auth.user.id;
      if (!allowedCompanySet) return true;
      return agent.company_assignments.some((assignment) => isActiveAssignment(assignment) && allowedCompanySet.has(String(assignment.company_id || "")));
    });
}

async function loadDashboardSettings(admin: ReturnType<typeof createAdminClient>, auth: SalesAuth, company: Record<string, unknown> | null) {
  const companyId = company ? String(company.id || "") : "";
  let query = admin
    .from("sales_dashboard_settings")
    .select("*")
    .eq("organization_id", auth.orgId)
    .limit(1);
  query = companyId ? query.eq("company_id", companyId) : query.is("company_id", null);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  return normalizeSettings(result.data as Record<string, unknown> | null, company);
}

function buildReport(settings: DashboardSettings, company: Record<string, unknown> | null, logs: Record<string, unknown>[], today: Date) {
  const todayIso = dateKey(today);
  const dayOfMonth = today.getUTCDate();
  const monthDays = daysInMonth(today);
  const effectiveElapsedDays = Math.min(dayOfMonth, settings.working_days);
  const remainingDays = Math.max(0, settings.working_days - effectiveElapsedDays);
  const dailyTarget = settings.working_days > 0 ? Math.ceil(settings.monthly_target / settings.working_days) : 0;
  const expectedTarget = dailyTarget * effectiveElapsedDays;
  const monthLogs = logs.filter((log) => String(log.log_date || "").slice(0, 7) === todayIso.slice(0, 7));
  const activations = monthLogs.reduce((sum, log) => sum + getItems(log).reduce((itemSum, item) => itemSum + getQuantity(item), 0), 0);
  const actualPercent = percent(activations, settings.monthly_target);
  const expectedPercent = percent(effectiveElapsedDays, settings.working_days);
  const remainingOver = activations - settings.monthly_target;
  const salesGap = activations - expectedTarget;
  const requiredDaily = remainingDays > 0 ? Math.ceil(Math.max(0, settings.monthly_target - activations) / remainingDays) : 0;
  const dailyActivations = new Map<string, number>();
  const focusGroups = [
    { label: settings.focus_1_label, query: settings.focus_1_query, value: 0 },
    { label: settings.focus_2_label, query: settings.focus_2_query, value: 0 },
    { label: settings.focus_3_label, query: settings.focus_3_query, value: 0 },
  ];

  for (const log of monthLogs) {
    const logDate = String(log.log_date || "");
    const quantity = getItems(log).reduce((sum, item) => sum + getQuantity(item), 0);
    dailyActivations.set(logDate, (dailyActivations.get(logDate) || 0) + quantity);
    for (const item of getItems(log)) {
      for (const group of focusGroups) {
        if (itemMatchesFocus(item, group.query)) group.value += getQuantity(item);
      }
    }
  }

  const calendarDays = Array.from({ length: monthDays }, (_, index) => {
    const day = index + 1;
    const date = monthDayKey(today, day);
    const value = dailyActivations.get(date) || 0;
    return {
      date,
      day,
      label: `${String(day).padStart(2, "0")} ${arabicMonths[today.getUTCMonth()]} ${today.getUTCFullYear()}`,
      value,
      percent: dailyTarget ? percent(value, dailyTarget) : 0,
      isFuture: date > todayIso,
    };
  });

  return {
    date: todayIso,
    dayName: arabicDays[today.getUTCDay()],
    company: company ? {
      id: String(company.id || ""),
      name: String(company.name || ""),
      code: String(company.code || ""),
      brandColor: String(company.brand_color || "#58B145"),
    } : null,
    settings,
    metrics: {
      partner: settings.partner_label,
      target: settings.monthly_target,
      activations,
      actualPercent,
      remainingOver,
      dailyTarget,
      remainingDays,
      expectedPercent,
      salesGap,
      requiredDaily,
      expectedTarget,
    },
    focusGroups: focusGroups.map((group) => ({
      label: group.label,
      value: group.value,
      percent: percent(group.value, settings.monthly_target),
    })),
    calendarDays,
    trend: calendarDays
      .filter((day) => !day.isFuture)
      .map((day) => ({ date: day.date, label: day.date.slice(5), total: day.value })),
  };
}

export async function GET(request: Request) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const today = new Date();
  const todayIso = dateKey(today);
  const yearStart = `${today.getUTCFullYear()}-01-01`;
  const weekStart = dateKey(startOfWeek(today));
  const monthStart = monthStartKey(today);
  const requestedCompanyId = new URL(request.url).searchParams.get("company_id") || "";

  try {
    const scopedCompanyIds = await getScopedCompanyIds(admin, auth);
    const companies = await loadVisibleCompanies(admin, auth, scopedCompanyIds);
    const selectedCompany = companies.find((company) => String(company.id || "") === requestedCompanyId)
      || companies[0]
      || null;
    const selectedCompanyId = selectedCompany ? String(selectedCompany.id || "") : "";

    const [logs, agents, settings] = await Promise.all([
      fetchPagedLogs(admin, auth, scopedCompanyIds, yearStart, todayIso, selectedCompanyId),
      loadAgents(admin, auth, scopedCompanyIds),
      loadDashboardSettings(admin, auth, selectedCompany),
    ]);

    const dailySales = dailyKeys(today);
    const dailyMap = new Map(dailySales.map((entry) => [entry.date, entry]));
    const monthlySales = monthKeysFromYearStart(today).map((key) => ({ month: key, label: monthLabel(key), total: 0 }));
    const monthMap = new Map(monthlySales.map((entry) => [entry.month, entry]));

    for (const log of logs) {
      const logDate = String(log.log_date || "");
      const total = Number(log.grand_total || 0);
      const dailyEntry = dailyMap.get(logDate);
      if (dailyEntry) dailyEntry.total += total;
      const monthlyEntry = monthMap.get(monthKey(logDate));
      if (monthlyEntry) monthlyEntry.total += total;
    }

    const agentLogs = new Map<string, Record<string, unknown>[]>();
    for (const log of logs) {
      const agentId = String(log.sales_agent_id || "");
      const list = agentLogs.get(agentId) || [];
      list.push(log);
      agentLogs.set(agentId, list);
    }

    const leaderboard = agents
      .filter((agent) => agent.role === "sales")
      .map((agent) => {
        const logsForAgent = agentLogs.get(agent.user_id) || [];
        return {
          ...agent,
          today: logsForAgent.filter((log) => log.log_date === todayIso).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          week: logsForAgent.filter((log) => String(log.log_date || "") >= weekStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          month: logsForAgent.filter((log) => String(log.log_date || "") >= monthStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
        };
      })
      .sort((a, b) => b.month - a.month);

    return NextResponse.json({
      data: {
        stats: {
          today: logs.filter((log) => log.log_date === todayIso).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          week: logs.filter((log) => String(log.log_date || "") >= weekStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          month: logs.filter((log) => String(log.log_date || "") >= monthStart).reduce((sum, log) => sum + Number(log.grand_total || 0), 0),
          activeAgents: agents.filter((agent) => agent.role === "sales" && String(agent.status || "").toLowerCase() === "active").length,
        },
        companies,
        selectedCompanyId,
        canManageSettings: auth.isManager,
        dashboardSettings: settings,
        report: buildReport(settings, selectedCompany, logs, today),
        dailySales,
        monthlySales,
        leaderboard,
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر تحميل لوحة المبيعات." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    const scopedCompanyIds = await getScopedCompanyIds(admin, auth);
    if (Array.isArray(scopedCompanyIds) && (!companyId || !scopedCompanyIds.includes(companyId))) {
      return NextResponse.json({ message: "ليست لديك صلاحية لتعديل إعدادات هذه الشركة." }, { status: 403 });
    }

    const values = {
      organization_id: auth.orgId,
      company_id: companyId || null,
      channel_title: String(body.channel_title || "Modern Trade Western Channel").trim(),
      partner_label: String(body.partner_label || "chessboard_company").trim(),
      monthly_target: clampNumber(body.monthly_target, 0, 10000000, 2270),
      working_days: clampNumber(body.working_days, 1, 31, 30),
      focus_1_label: String(body.focus_1_label || "Yalla 20").trim(),
      focus_1_query: String(body.focus_1_query || "Yalla 20").trim(),
      focus_2_label: String(body.focus_2_label || "Yalla 30").trim(),
      focus_2_query: String(body.focus_2_query || "Yalla 30").trim(),
      focus_3_label: String(body.focus_3_label || "Above the Yalla 30").trim(),
      focus_3_query: String(body.focus_3_query || "above:30").trim(),
      updated_by: auth.user.id,
      created_by: auth.user.id,
    };

    const result = await admin
      .from("sales_dashboard_settings")
      .upsert(values as never, { onConflict: "organization_id,company_id" })
      .select("*")
      .single();

    if (result.error) {
      return NextResponse.json({ message: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ data: normalizeSettings(result.data as Record<string, unknown> | null) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر حفظ إعدادات لوحة المبيعات." }, { status: 500 });
  }
}
