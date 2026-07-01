import type { createAdminClient } from "@/lib/supabase/admin";
import { queryLedger, aggregateByAccount, type AccountBalance } from "@/lib/accounting/reports/core/ledger-query";
import { getPriorPeriod, getPriorYear, getPriorYearAsOf, computeVariance, type VarianceItem } from "@/lib/accounting/reports/core/period-utils";
import { roundMoney } from "@/lib/accounting/validation";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CompareMode = "prior_period" | "prior_year";

interface ComparativeRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  current_balance: number;
  prior_balance: number;
  variance: VarianceItem;
}

interface ComparativePnL {
  revenue: ComparativeRow[];
  expenses: ComparativeRow[];
  total_revenue: VarianceItem;
  total_expenses: VarianceItem;
  net_profit: VarianceItem;
}

interface ComparativeBalanceSheet {
  assets: ComparativeRow[];
  liabilities: ComparativeRow[];
  equity: ComparativeRow[];
  total_assets: VarianceItem;
  total_liabilities: VarianceItem;
  total_equity: VarianceItem;
  current_earnings: VarianceItem;
}

function toComparativeRows(current: AccountBalance[], prior: AccountBalance[]): ComparativeRow[] {
  const priorMap = new Map(prior.map((p) => [p.account_id, p]));
  const allIds = new Set([...current.map((c) => c.account_id), ...prior.map((p) => p.account_id)]);

  const rows: ComparativeRow[] = [];
  for (const id of allIds) {
    const c = current.find((x) => x.account_id === id);
    const p = priorMap.get(id);
    rows.push({
      account_id: id,
      account_code: c?.account_code || p?.account_code || "",
      account_name: c?.account_name_ar || p?.account_name_ar || "",
      account_type: c?.account_type || p?.account_type || "",
      current_balance: c?.balance || 0,
      prior_balance: p?.balance || 0,
      variance: computeVariance(c?.balance || 0, p?.balance || 0),
    });
  }

  return rows.sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export async function getComparativeProfitLoss(
  admin: AdminClient,
  orgId: string,
  dateFrom: string,
  dateTo: string,
  compare: CompareMode
) {
  const priorRange = compare === "prior_year"
    ? getPriorYear(dateFrom, dateTo)
    : getPriorPeriod(dateFrom, dateTo);

  const [currentLines, priorLines] = await Promise.all([
    queryLedger(admin, { orgId, dateFrom, dateTo, accountTypes: ["revenue", "expense"] }),
    queryLedger(admin, { orgId, dateFrom: priorRange.from, dateTo: priorRange.to, accountTypes: ["revenue", "expense"] }),
  ]);

  const currentBalances = aggregateByAccount(currentLines);
  const priorBalances = aggregateByAccount(priorLines);

  const allRows = toComparativeRows(currentBalances, priorBalances);
  const revenue = allRows.filter((r) => r.account_type === "revenue");
  const expenses = allRows.filter((r) => r.account_type === "expense");

  const totalRevenueCurrent = roundMoney(revenue.reduce((s, r) => s + r.current_balance, 0));
  const totalRevenuePrior = roundMoney(revenue.reduce((s, r) => s + r.prior_balance, 0));
  const totalExpensesCurrent = roundMoney(expenses.reduce((s, r) => s + r.current_balance, 0));
  const totalExpensesPrior = roundMoney(expenses.reduce((s, r) => s + r.prior_balance, 0));

  const data: ComparativePnL = {
    revenue,
    expenses,
    total_revenue: computeVariance(totalRevenueCurrent, totalRevenuePrior),
    total_expenses: computeVariance(totalExpensesCurrent, totalExpensesPrior),
    net_profit: computeVariance(
      roundMoney(totalRevenueCurrent - totalExpensesCurrent),
      roundMoney(totalRevenuePrior - totalExpensesPrior)
    ),
  };

  return buildReportResponse("comparative_profit_loss", orgId, { from: dateFrom, to: dateTo }, data, {
    comparison: {
      ...data,
      revenue: revenue.map((r) => ({ ...r, current_balance: r.prior_balance, prior_balance: 0, variance: computeVariance(r.prior_balance, 0) })),
      expenses: expenses.map((r) => ({ ...r, current_balance: r.prior_balance, prior_balance: 0, variance: computeVariance(r.prior_balance, 0) })),
    } as unknown as ComparativePnL,
  });
}

export async function getComparativeBalanceSheet(
  admin: AdminClient,
  orgId: string,
  asOf: string,
  compare: CompareMode
) {
  const priorRange = compare === "prior_year"
    ? getPriorYearAsOf(asOf)
    : { from: "1900-01-01", to: getPriorPeriod("1900-01-01", asOf).to };

  const [currentLines, priorLines] = await Promise.all([
    queryLedger(admin, { orgId, dateTo: asOf }),
    queryLedger(admin, { orgId, dateTo: priorRange.to }),
  ]);

  const currentBalances = aggregateByAccount(currentLines);
  const priorBalances = aggregateByAccount(priorLines);

  const allRows = toComparativeRows(currentBalances, priorBalances);
  const assets = allRows.filter((r) => r.account_type === "asset");
  const liabilities = allRows.filter((r) => r.account_type === "liability");
  const equity = allRows.filter((r) => r.account_type === "equity");
  const revenueRows = allRows.filter((r) => r.account_type === "revenue");
  const expenseRows = allRows.filter((r) => r.account_type === "expense");

  const currentEarningsCurrent = roundMoney(
    revenueRows.reduce((s, r) => s + r.current_balance, 0) - expenseRows.reduce((s, r) => s + r.current_balance, 0)
  );
  const currentEarningsPrior = roundMoney(
    revenueRows.reduce((s, r) => s + r.prior_balance, 0) - expenseRows.reduce((s, r) => s + r.prior_balance, 0)
  );

  const totalAssetsCurrent = roundMoney(assets.reduce((s, r) => s + r.current_balance, 0));
  const totalAssetsPrior = roundMoney(assets.reduce((s, r) => s + r.prior_balance, 0));
  const totalLiabilitiesCurrent = roundMoney(liabilities.reduce((s, r) => s + r.current_balance, 0));
  const totalLiabilitiesPrior = roundMoney(liabilities.reduce((s, r) => s + r.prior_balance, 0));
  const totalEquityCurrent = roundMoney(equity.reduce((s, r) => s + r.current_balance, 0) + currentEarningsCurrent);
  const totalEquityPrior = roundMoney(equity.reduce((s, r) => s + r.prior_balance, 0) + currentEarningsPrior);

  const data: ComparativeBalanceSheet = {
    assets,
    liabilities,
    equity,
    total_assets: computeVariance(totalAssetsCurrent, totalAssetsPrior),
    total_liabilities: computeVariance(totalLiabilitiesCurrent, totalLiabilitiesPrior),
    total_equity: computeVariance(totalEquityCurrent, totalEquityPrior),
    current_earnings: computeVariance(currentEarningsCurrent, currentEarningsPrior),
  };

  return buildReportResponse("comparative_balance_sheet", orgId, { as_of: asOf }, data);
}
