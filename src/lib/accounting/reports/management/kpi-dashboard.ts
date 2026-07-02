import type { createAdminClient } from "@/lib/supabase/admin";
import { queryLedger, aggregateByAccount } from "@/lib/accounting/reports/core/ledger-query";
import { roundMoney } from "@/lib/accounting/validation";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";
import { computeVariance, getPriorPeriod, type VarianceItem } from "@/lib/accounting/reports/core/period-utils";

type AdminClient = ReturnType<typeof createAdminClient>;

interface KPI {
  label: string;
  label_ar: string;
  value: number | null;
  unit: string;
  trend?: VarianceItem;
}

interface KPIDashboardData {
  kpis: KPI[];
  summary: {
    total_assets: number;
    total_liabilities: number;
    total_equity: number;
    total_revenue: number;
    total_expenses: number;
    net_profit: number;
    cash_balance: number;
  };
}

export async function getKPIDashboard(admin: AdminClient, orgId: string, dateFrom: string, dateTo: string) {
  const priorRange = getPriorPeriod(dateFrom, dateTo);

  const [allLines, periodLines, priorPeriodLines] = await Promise.all([
    queryLedger(admin, { orgId, dateTo }),
    queryLedger(admin, { orgId, dateFrom, dateTo }),
    queryLedger(admin, { orgId, dateFrom: priorRange.from, dateTo: priorRange.to }),
  ]);

  const allBalances = aggregateByAccount(allLines);
  const periodBalances = aggregateByAccount(periodLines);
  const priorBalances = aggregateByAccount(priorPeriodLines);

  const sumByType = (balances: typeof allBalances, type: string) =>
    roundMoney(balances.filter((b) => b.account_type === type).reduce((s, b) => s + b.balance, 0));

  const sumBySubtype = (balances: typeof allBalances, subtypes: string[]) =>
    roundMoney(balances.filter((b) => subtypes.includes(b.account_subtype || "")).reduce((s, b) => s + b.balance, 0));

  // Balance sheet totals (cumulative)
  const totalAssets = sumByType(allBalances, "asset");
  const totalLiabilities = sumByType(allBalances, "liability");
  const totalEquity = sumByType(allBalances, "equity");

  // Current assets/liabilities
  const cashBalance = sumBySubtype(allBalances, ["cash", "bank"]);
  const accountsReceivable = sumBySubtype(allBalances, ["receivable"]);
  const currentAssets = roundMoney(cashBalance + accountsReceivable);
  const currentLiabilities = sumBySubtype(allBalances, ["payable", "accrued"]) || (totalLiabilities > 0 ? totalLiabilities : 1);

  // Period P&L
  const totalRevenue = sumByType(periodBalances, "revenue");
  const totalExpenses = sumByType(periodBalances, "expense");
  const netProfit = roundMoney(totalRevenue - totalExpenses);

  // Prior P&L
  const priorRevenue = sumByType(priorBalances, "revenue");
  const priorExpenses = sumByType(priorBalances, "expense");

  // Days in period
  const daysInPeriod = Math.max(1, Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)));
  const monthsInPeriod = Math.max(1, daysInPeriod / 30);

  // KPI calculations
  const currentRatio = currentLiabilities !== 0 ? roundMoney(currentAssets / Math.abs(currentLiabilities) * 100) / 100 : null;
  const quickRatio = currentLiabilities !== 0 ? roundMoney((cashBalance + accountsReceivable) / Math.abs(currentLiabilities) * 100) / 100 : null;
  const grossProfitMargin = totalRevenue !== 0 ? roundMoney((netProfit / totalRevenue) * 100) : null;
  const netProfitMargin = totalRevenue !== 0 ? roundMoney((netProfit / totalRevenue) * 100) : null;
  const dso = totalRevenue !== 0 ? roundMoney((accountsReceivable / totalRevenue) * daysInPeriod) : null;
  const burnRate = roundMoney(totalExpenses / monthsInPeriod);
  const runway = burnRate !== 0 ? roundMoney(cashBalance / burnRate) : null;
  const revenueGrowth = priorRevenue !== 0 ? roundMoney(((totalRevenue - priorRevenue) / priorRevenue) * 100) : null;
  const payrollRatio = totalRevenue !== 0
    ? roundMoney((periodBalances.filter((b) => b.account_subtype === "salary_expense").reduce((s, b) => s + b.balance, 0) / totalRevenue) * 100)
    : null;

  const kpis: KPI[] = [
    { label: "Current Ratio", label_ar: "نسبة التداول", value: currentRatio, unit: "ratio" },
    { label: "Quick Ratio", label_ar: "نسبة السيولة السريعة", value: quickRatio, unit: "ratio" },
    { label: "Gross Profit Margin", label_ar: "هامش الربح الإجمالي", value: grossProfitMargin, unit: "%" },
    { label: "Net Profit Margin", label_ar: "هامش صافي الربح", value: netProfitMargin, unit: "%" },
    { label: "AR Days (DSO)", label_ar: "أيام التحصيل", value: dso, unit: "days" },
    { label: "Burn Rate", label_ar: "معدل الإنفاق الشهري", value: burnRate, unit: "SAR/month" },
    { label: "Runway", label_ar: "المدة المتبقية", value: runway, unit: "months" },
    { label: "Revenue Growth", label_ar: "نمو الإيرادات", value: revenueGrowth, unit: "%", trend: computeVariance(totalRevenue, priorRevenue) },
    { label: "Payroll-to-Revenue", label_ar: "نسبة الرواتب للإيرادات", value: payrollRatio, unit: "%" },
  ];

  const data: KPIDashboardData = {
    kpis,
    summary: {
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: totalEquity,
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: netProfit,
      cash_balance: cashBalance,
    },
  };

  return buildReportResponse("kpi_dashboard", orgId, { from: dateFrom, to: dateTo }, data);
}
