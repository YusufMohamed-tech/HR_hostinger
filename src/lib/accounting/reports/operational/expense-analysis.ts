import type { createAdminClient } from "@/lib/supabase/admin";
import { roundMoney } from "@/lib/accounting/validation";
import { groupAndSum, topN } from "@/lib/accounting/reports/core/aggregator";
import { getMonthsInRange } from "@/lib/accounting/reports/core/period-utils";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

type GroupBy = "category" | "vendor" | "cost_center" | "month";

interface ExpenseAnalysisData {
  total_expenses: number;
  expense_count: number;
  group_by: GroupBy;
  breakdown: Array<{ key: string; label: string; total: number; count: number; percentage?: number }>;
  monthly_trend: Array<{ period: string; total: number; count: number }>;
}

export async function getExpenseAnalysis(
  admin: AdminClient,
  orgId: string,
  dateFrom: string,
  dateTo: string,
  groupBy: GroupBy = "category"
) {
  const { data, error } = await db(admin)
    .from("accounting_expenses")
    .select("id, expense_no, expense_date, description, amount_before_vat, vat_amount, total_amount, status, category_account:category_account_id(id, code, name_ar), vendor:vendor_id(id, name_ar), cost_center:cost_center_id(id, code, name_ar)")
    .eq("organization_id", orgId)
    .in("status", ["approved", "paid"])
    .gte("expense_date", dateFrom)
    .lte("expense_date", dateTo)
    .order("expense_date", { ascending: false });

  if (error) throw new Error(error.message);
  const expenses = (data || []) as Record<string, unknown>[];

  const totalExpenses = roundMoney(expenses.reduce((s, exp) => s + Number(exp.total_amount || 0), 0));

  // Monthly trend
  const months = getMonthsInRange(dateFrom, dateTo);
  const monthlyTrend = months.map((period) => {
    const monthExpenses = expenses.filter((exp) => String(exp.expense_date).startsWith(period));
    return {
      period,
      total: roundMoney(monthExpenses.reduce((s, exp) => s + Number(exp.total_amount || 0), 0)),
      count: monthExpenses.length,
    };
  });

  let breakdown;
  if (groupBy === "category") {
    const grouped = groupAndSum(
      expenses,
      (exp) => String((exp.category_account as Record<string, unknown>)?.id || "other"),
      (exp) => String((exp.category_account as Record<string, unknown>)?.name_ar || "أخرى"),
      (exp) => Number(exp.total_amount || 0)
    );
    breakdown = grouped;
  } else if (groupBy === "vendor") {
    const grouped = groupAndSum(
      expenses,
      (exp) => String((exp.vendor as Record<string, unknown>)?.id || "unknown"),
      (exp) => String((exp.vendor as Record<string, unknown>)?.name_ar || "غير محدد"),
      (exp) => Number(exp.total_amount || 0)
    );
    const { top, others } = topN(grouped, 10);
    breakdown = others ? [...top, others] : top;
  } else if (groupBy === "cost_center") {
    const grouped = groupAndSum(
      expenses,
      (exp) => String((exp.cost_center as Record<string, unknown>)?.id || "unassigned"),
      (exp) => String((exp.cost_center as Record<string, unknown>)?.name_ar || "غير مخصص"),
      (exp) => Number(exp.total_amount || 0)
    );
    breakdown = grouped;
  } else {
    breakdown = monthlyTrend.map((m) => ({
      key: m.period,
      label: m.period,
      total: m.total,
      count: m.count,
      percentage: totalExpenses !== 0 ? roundMoney((m.total / totalExpenses) * 100) : 0,
    }));
  }

  const result: ExpenseAnalysisData = {
    total_expenses: totalExpenses,
    expense_count: expenses.length,
    group_by: groupBy,
    breakdown,
    monthly_trend: monthlyTrend,
  };

  return buildReportResponse("expense_analysis", orgId, { from: dateFrom, to: dateTo }, result);
}
