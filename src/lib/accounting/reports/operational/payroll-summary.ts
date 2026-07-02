import type { createAdminClient } from "@/lib/supabase/admin";
import { roundMoney } from "@/lib/accounting/validation";
import { getMonthsInRange } from "@/lib/accounting/reports/core/period-utils";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

type GroupBy = "department" | "employee" | "month";

interface PayrollSummaryData {
  total_cost: number;
  employee_count: number;
  avg_cost_per_employee: number;
  group_by: GroupBy;
  breakdown: Array<{ key: string; label: string; base_salary: number; allowances: number; deductions: number; net: number; count: number }>;
  monthly_trend: Array<{ period: string; total: number; count: number }>;
}

export async function getPayrollSummary(
  admin: AdminClient,
  orgId: string,
  dateFrom: string,
  dateTo: string,
  groupBy: GroupBy = "month"
) {
  const { data, error } = await db(admin)
    .from("payslips")
    .select("id, employee_id, month, base_salary, total_allowances, total_deductions, net_salary, status, employee:employee_id(id, full_name, department:department_id(id, name))")
    .eq("org_id", orgId)
    .gte("month", dateFrom)
    .lte("month", dateTo)
    .in("status", ["approved", "paid"]);

  if (error) throw new Error(error.message);
  const payslips = (data || []) as Record<string, unknown>[];

  const totalCost = roundMoney(payslips.reduce((s, p) => s + Number(p.net_salary || 0), 0));
  const uniqueEmployees = new Set(payslips.map((p) => String(p.employee_id)));
  const employeeCount = uniqueEmployees.size;

  // Monthly trend
  const months = getMonthsInRange(dateFrom, dateTo);
  const monthlyTrend = months.map((period) => {
    const monthPayslips = payslips.filter((p) => String(p.month).startsWith(period));
    return {
      period,
      total: roundMoney(monthPayslips.reduce((s, p) => s + Number(p.net_salary || 0), 0)),
      count: monthPayslips.length,
    };
  });

  let breakdown;
  if (groupBy === "department") {
    const grouped = new Map<string, { label: string; base_salary: number; allowances: number; deductions: number; net: number; count: number }>();
    for (const p of payslips) {
      const emp = p.employee as Record<string, unknown> | null;
      const dept = emp?.department as Record<string, unknown> | null;
      const key = String(dept?.id || "unknown");
      const label = String(dept?.name || "غير محدد");
      const existing = grouped.get(key) || { label, base_salary: 0, allowances: 0, deductions: 0, net: 0, count: 0 };
      existing.base_salary = roundMoney(existing.base_salary + Number(p.base_salary || 0));
      existing.allowances = roundMoney(existing.allowances + Number(p.total_allowances || 0));
      existing.deductions = roundMoney(existing.deductions + Number(p.total_deductions || 0));
      existing.net = roundMoney(existing.net + Number(p.net_salary || 0));
      existing.count++;
      grouped.set(key, existing);
    }
    breakdown = Array.from(grouped.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.net - a.net);
  } else if (groupBy === "employee") {
    const grouped = new Map<string, { label: string; base_salary: number; allowances: number; deductions: number; net: number; count: number }>();
    for (const p of payslips) {
      const emp = p.employee as Record<string, unknown> | null;
      const key = String(p.employee_id);
      const label = String(emp?.full_name || "موظف");
      const existing = grouped.get(key) || { label, base_salary: 0, allowances: 0, deductions: 0, net: 0, count: 0 };
      existing.base_salary = roundMoney(existing.base_salary + Number(p.base_salary || 0));
      existing.allowances = roundMoney(existing.allowances + Number(p.total_allowances || 0));
      existing.deductions = roundMoney(existing.deductions + Number(p.total_deductions || 0));
      existing.net = roundMoney(existing.net + Number(p.net_salary || 0));
      existing.count++;
      grouped.set(key, existing);
    }
    breakdown = Array.from(grouped.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.net - a.net);
  } else {
    breakdown = monthlyTrend.map((m) => {
      const monthPayslips = payslips.filter((p) => String(p.month).startsWith(m.period));
      return {
        key: m.period,
        label: m.period,
        base_salary: roundMoney(monthPayslips.reduce((s, p) => s + Number(p.base_salary || 0), 0)),
        allowances: roundMoney(monthPayslips.reduce((s, p) => s + Number(p.total_allowances || 0), 0)),
        deductions: roundMoney(monthPayslips.reduce((s, p) => s + Number(p.total_deductions || 0), 0)),
        net: roundMoney(monthPayslips.reduce((s, p) => s + Number(p.net_salary || 0), 0)),
        count: monthPayslips.length,
      };
    });
  }

  const result: PayrollSummaryData = {
    total_cost: totalCost,
    employee_count: employeeCount,
    avg_cost_per_employee: employeeCount > 0 ? roundMoney(totalCost / employeeCount) : 0,
    group_by: groupBy,
    breakdown,
    monthly_trend: monthlyTrend,
  };

  return buildReportResponse("payroll_summary", orgId, { from: dateFrom, to: dateTo }, result);
}
