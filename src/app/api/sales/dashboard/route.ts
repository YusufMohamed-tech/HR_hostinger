import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

const arabicMonths = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

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

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = dateKey(new Date());
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

async function getScopedCompanyIds(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; role: string }) {
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

async function fetchPagedLogs(
  admin: ReturnType<typeof createAdminClient>,
  auth: { orgId: string; user: { id: string }; isManager: boolean },
  scopedCompanyIds: string[] | null,
  dateFrom: string,
  dateTo: string
) {
  if (Array.isArray(scopedCompanyIds) && scopedCompanyIds.length === 0) return [];

  const rows: Record<string, unknown>[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = admin
      .from("sales_logs")
      .select("sales_agent_id, log_date, grand_total, total_discount, company_id")
      .eq("organization_id", auth.orgId)
      .gte("log_date", dateFrom)
      .lte("log_date", dateTo)
      .order("log_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (!auth.isManager) query = query.eq("sales_agent_id", auth.user.id);
    if (Array.isArray(scopedCompanyIds)) query = query.in("company_id", scopedCompanyIds);

    const result = await query;
    if (result.error) throw result.error;
    const page = (result.data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function loadAgents(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; isManager: boolean }, scopedCompanyIds: string[] | null) {
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

export async function GET() {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const today = new Date();
  const todayIso = dateKey(today);
  const yearStart = `${today.getUTCFullYear()}-01-01`;
  const weekStart = dateKey(startOfWeek(today));
  const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;

  try {
    const scopedCompanyIds = await getScopedCompanyIds(admin, auth);
    const [logs, agents] = await Promise.all([
      fetchPagedLogs(admin, auth, scopedCompanyIds, yearStart, todayIso),
      loadAgents(admin, auth, scopedCompanyIds),
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
        dailySales,
        monthlySales,
        leaderboard,
      },
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر تحميل لوحة المبيعات." }, { status: 500 });
  }
}
