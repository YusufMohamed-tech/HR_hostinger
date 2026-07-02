import type { createAdminClient } from "@/lib/supabase/admin";
import { queryLedger, aggregateByAccount } from "@/lib/accounting/reports/core/ledger-query";
import { roundMoney } from "@/lib/accounting/validation";
import { computeVariance, type VarianceItem } from "@/lib/accounting/reports/core/period-utils";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

interface BudgetVarianceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  budget_amount: number;
  actual_amount: number;
  variance: VarianceItem;
}

interface BudgetVarianceData {
  budget_name: string;
  fiscal_year: number;
  rows: BudgetVarianceRow[];
  totals: { budget: number; actual: number; variance: VarianceItem };
}

export async function getBudgetVariance(
  admin: AdminClient,
  orgId: string,
  budgetId: string,
  dateFrom: string,
  dateTo: string
) {
  // Fetch budget
  const { data: budget, error: budgetError } = await db(admin)
    .from("accounting_budgets")
    .select("id, name, fiscal_year, status")
    .eq("organization_id", orgId)
    .eq("id", budgetId)
    .single();

  if (budgetError) throw new Error(budgetError.message);
  if (!budget) throw new Error("الموازنة غير موجودة.");

  // Fetch budget lines
  const { data: budgetLines, error: linesError } = await db(admin)
    .from("accounting_budget_lines")
    .select("account_id, month, amount, account:account_id(id, code, name_ar)")
    .eq("budget_id", budgetId);

  if (linesError) throw new Error(linesError.message);

  // Determine months in range
  const startMonth = new Date(dateFrom).getMonth() + 1;
  const endMonth = new Date(dateTo).getMonth() + 1;

  // Aggregate budget by account
  const budgetByAccount = new Map<string, { code: string; name: string; amount: number }>();
  for (const line of (budgetLines || []) as Record<string, unknown>[]) {
    const month = Number(line.month);
    if (month < startMonth || month > endMonth) continue;
    const accountId = String(line.account_id);
    const account = line.account as Record<string, unknown> | null;
    const existing = budgetByAccount.get(accountId) || {
      code: String(account?.code || ""),
      name: String(account?.name_ar || ""),
      amount: 0,
    };
    existing.amount = roundMoney(existing.amount + Number(line.amount || 0));
    budgetByAccount.set(accountId, existing);
  }

  // Fetch actual GL data
  const lines = await queryLedger(admin, { orgId, dateFrom, dateTo, accountTypes: ["revenue", "expense"] });
  const actuals = aggregateByAccount(lines);
  const actualByAccount = new Map(actuals.map((a) => [a.account_id, a.balance]));

  // Build rows
  const allAccountIds = new Set([...Array.from(budgetByAccount.keys()), ...Array.from(actualByAccount.keys())]);
  const rows: BudgetVarianceRow[] = [];

  for (const accountId of Array.from(allAccountIds)) {
    const budgetInfo = budgetByAccount.get(accountId);
    const actual = actualByAccount.get(accountId) || 0;
    const budgetAmount = budgetInfo?.amount || 0;
    const accountData = actuals.find((a) => a.account_id === accountId);

    rows.push({
      account_id: accountId,
      account_code: budgetInfo?.code || accountData?.account_code || "",
      account_name: budgetInfo?.name || accountData?.account_name_ar || "",
      budget_amount: budgetAmount,
      actual_amount: actual,
      variance: computeVariance(actual, budgetAmount),
    });
  }

  rows.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const totalBudget = roundMoney(rows.reduce((s, r) => s + r.budget_amount, 0));
  const totalActual = roundMoney(rows.reduce((s, r) => s + r.actual_amount, 0));

  const data: BudgetVarianceData = {
    budget_name: String(budget.name),
    fiscal_year: Number(budget.fiscal_year),
    rows,
    totals: { budget: totalBudget, actual: totalActual, variance: computeVariance(totalActual, totalBudget) },
  };

  return buildReportResponse("budget_variance", orgId, { from: dateFrom, to: dateTo }, data);
}
