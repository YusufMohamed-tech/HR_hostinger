import type { createAdminClient } from "@/lib/supabase/admin";
import { roundMoney } from "@/lib/accounting/validation";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

function inDateRange(date: string, from?: string, to?: string) {
  return (!from || date >= from) && (!to || date <= to);
}

async function getPostedLines(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  // Official financial reports use posted/reversed ledger entries only; draft operational records stay out.
  const { data, error } = await db(admin)
    .from("accounting_journal_lines")
    .select("*, account:account_id(id, code, name_ar, name_en, type, subtype, normal_balance), entry:journal_entry_id(id, entry_no, entry_date, description, status, source_module)")
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  return ((data || []) as Record<string, unknown>[]).filter((line) => {
    const entry = line.entry as Record<string, unknown> | null;
    return ["posted", "reversed"].includes(String(entry?.status)) && inDateRange(String(entry?.entry_date), dateFrom, dateTo);
  });
}

export async function getTrialBalance(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const lines = await getPostedLines(admin, orgId, dateFrom, dateTo);
  const rows = new Map<string, Record<string, unknown>>();

  for (const line of lines) {
    const account = (line.account || {}) as Record<string, unknown>;
    const accountId = String(account.id || line.account_id);
    const current = rows.get(accountId) || {
      account_id: accountId,
      account_code: String(account.code || ""),
      account_name: String(account.name_ar || account.name_en || ""),
      account_type: String(account.type || ""),
      account_subtype: account.subtype ? String(account.subtype) : null,
      normal_balance: String(account.normal_balance || "debit"),
      debit: 0,
      credit: 0,
      balance: 0,
    };
    current.debit = roundMoney(Number(current.debit || 0) + Number(line.debit || 0));
    current.credit = roundMoney(Number(current.credit || 0) + Number(line.credit || 0));
    const normal = String(current.normal_balance);
    current.balance = normal === "credit"
      ? roundMoney(Number(current.credit) - Number(current.debit))
      : roundMoney(Number(current.debit) - Number(current.credit));
    rows.set(accountId, current);
  }

  return Array.from(rows.values()).sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)));
}

export async function getGeneralLedger(admin: AdminClient, orgId: string, accountId?: string, dateFrom?: string, dateTo?: string, costCenterId?: string) {
  const allLines = await getPostedLines(admin, orgId, undefined, dateTo);

  const matchesCostCenter = (line: Record<string, unknown>) =>
    !costCenterId || String(line.cost_center_id || "") === costCenterId;

  const openingLines = dateFrom
    ? allLines.filter((line) => {
        const entry = line.entry as Record<string, unknown>;
        return String(entry.entry_date) < dateFrom && (!accountId || String(line.account_id) === accountId) && matchesCostCenter(line);
      })
    : [];
  const lines = allLines
    .filter((line) => {
      const entry = line.entry as Record<string, unknown>;
      return inDateRange(String(entry.entry_date), dateFrom, dateTo);
    })
    .filter((line) => !accountId || String(line.account_id) === accountId)
    .filter(matchesCostCenter)
    .sort((a, b) => {
      const ea = a.entry as Record<string, unknown>;
      const eb = b.entry as Record<string, unknown>;
      return String(ea.entry_date).localeCompare(String(eb.entry_date)) || String(ea.entry_no).localeCompare(String(eb.entry_no));
    });

  // Fetch cost center names for display
  let costCenterMap: Map<string, { code: string; name: string }> = new Map();
  const ccIds = [...new Set(lines.map((l) => String(l.cost_center_id || "")).filter(Boolean))];
  if (ccIds.length > 0) {
    const { data: ccData } = await db(admin)
      .from("accounting_cost_centers")
      .select("id, code, name_ar, name_en")
      .eq("organization_id", orgId)
      .in("id", ccIds);
    if (ccData) {
      costCenterMap = new Map((ccData as Array<{ id: string; code: string; name_ar: string; name_en?: string }>).map((cc) => [cc.id, { code: cc.code, name: cc.name_ar || cc.name_en || "" }]));
    }
  }

  const movementFor = (line: Record<string, unknown>) => {
    const account = (line.account || {}) as Record<string, unknown>;
    const normal = String(account.normal_balance || "debit");
    return normal === "credit"
      ? Number(line.credit || 0) - Number(line.debit || 0)
      : Number(line.debit || 0) - Number(line.credit || 0);
  };

  let runningBalance = roundMoney(openingLines.reduce((sum, line) => sum + movementFor(line), 0));
  const rows = lines.map((line) => {
    const entry = (line.entry || {}) as Record<string, unknown>;
    const account = (line.account || {}) as Record<string, unknown>;
    const cc = costCenterMap.get(String(line.cost_center_id || ""));
    const movement = movementFor(line);
    runningBalance = roundMoney(runningBalance + movement);
    return {
      id: line.id,
      entry_id: entry.id,
      entry_no: entry.entry_no,
      entry_date: entry.entry_date,
      description: line.description || entry.description,
      account_id: line.account_id,
      account_code: account.code,
      account_name: account.name_ar || account.name_en,
      cost_center_code: cc?.code || null,
      cost_center_name: cc?.name || null,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      running_balance: runningBalance,
    };
  });

  return {
    openingBalance: roundMoney(openingLines.reduce((sum, line) => sum + movementFor(line), 0)),
    rows,
    closingBalance: runningBalance,
  };
}

export async function getProfitLoss(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const rows = await getTrialBalance(admin, orgId, dateFrom, dateTo);

  const revenueRows = rows.filter((row) => row.account_type === "revenue");
  const expenseRows = rows.filter((row) => row.account_type === "expense");

  const toItem = (row: Record<string, unknown>) => ({
    account_code: String(row.account_code || ""),
    account_name_ar: String(row.account_name || ""),
    amount: Math.abs(Number(row.balance || 0)),
  });

  // Group revenue by subtype
  const revenueMain = revenueRows.filter((r) => !r.account_subtype || r.account_subtype === "sales_revenue" || r.account_subtype === "commission_revenue" || r.account_subtype === "service_revenue" || r.account_subtype === "operating_revenue" || r.account_subtype === "sales" || r.account_subtype === "services");
  const otherIncomeRows = revenueRows.filter((r) => r.account_subtype === "other_income");

  // Group expenses by subtype
  const costOfRevenueRows = expenseRows.filter((r) => r.account_subtype === "cost_of_revenue" || r.account_subtype === "cost_of_sales");
  const otherExpenseRows = expenseRows.filter((r) => r.account_subtype === "other_expense" || r.account_subtype === "finance_cost");
  const operatingExpenseRows = expenseRows.filter((r) =>
    !r.account_subtype || (r.account_subtype !== "cost_of_revenue" && r.account_subtype !== "cost_of_sales" && r.account_subtype !== "other_expense" && r.account_subtype !== "finance_cost")
  );

  // Unmapped: revenue/expense accounts with NULL subtype
  const unmappedAccounts = [...revenueRows, ...expenseRows]
    .filter((r) => !r.account_subtype)
    .map((r) => ({ code: String(r.account_code || ""), name_ar: String(r.account_name || "") }));

  const sumItems = (items: { amount: number }[]) => roundMoney(items.reduce((s, i) => s + i.amount, 0));

  const revenue = { items: revenueMain.map(toItem), total: sumItems(revenueMain.map(toItem)) };
  const cost_of_revenue = { items: costOfRevenueRows.map(toItem), total: sumItems(costOfRevenueRows.map(toItem)) };
  const operating_expenses = { items: operatingExpenseRows.map(toItem), total: sumItems(operatingExpenseRows.map(toItem)) };
  const other_income = { items: otherIncomeRows.map(toItem), total: sumItems(otherIncomeRows.map(toItem)) };
  const other_expenses = { items: otherExpenseRows.map(toItem), total: sumItems(otherExpenseRows.map(toItem)) };

  const totalRevenue = revenue.total;
  const totalCostOfRevenue = cost_of_revenue.total;
  const gross_profit = roundMoney(totalRevenue - totalCostOfRevenue);
  const operating_income = roundMoney(gross_profit - operating_expenses.total);
  const net_profit = roundMoney(operating_income + other_income.total - other_expenses.total);

  return {
    revenue,
    cost_of_revenue,
    operating_expenses,
    other_income,
    other_expenses,
    gross_profit,
    operating_income,
    net_profit,
    unmapped_accounts: unmappedAccounts.length > 0 ? unmappedAccounts : undefined,
    // Legacy compat fields for dashboard/comparative consumers
    totalRevenue,
    totalExpenses: roundMoney(totalCostOfRevenue + operating_expenses.total + other_expenses.total),
    netProfit: net_profit,
  };
}

export async function getBalanceSheet(admin: AdminClient, orgId: string, asOf?: string) {
  const rows = await getTrialBalance(admin, orgId, undefined, asOf);
  const assets = rows.filter((row) => row.account_type === "asset");
  const liabilities = rows.filter((row) => row.account_type === "liability");
  const equity = rows.filter((row) => row.account_type === "equity");
  const revenue = rows.filter((row) => row.account_type === "revenue");
  const expenses = rows.filter((row) => row.account_type === "expense");
  const currentEarnings = roundMoney(
    revenue.reduce((sum, row) => sum + Number(row.balance || 0), 0) -
    expenses.reduce((sum, row) => sum + Number(row.balance || 0), 0)
  );
  const totalAssets = roundMoney(assets.reduce((sum, row) => sum + Number(row.balance || 0), 0));
  const totalLiabilities = roundMoney(liabilities.reduce((sum, row) => sum + Number(row.balance || 0), 0));
  const totalEquityAccounts = roundMoney(equity.reduce((sum, row) => sum + Number(row.balance || 0), 0));
  const totalEquity = roundMoney(totalEquityAccounts + currentEarnings);
  return {
    assets,
    liabilities,
    equity,
    currentEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanceCheck: roundMoney(totalAssets - totalLiabilities - totalEquity),
  };
}

export async function getVatReport(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const settings = await db(admin)
    .from("accounting_settings")
    .select("default_vat_payable_id, default_vat_receivable_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (settings.error) throw new Error(settings.error.message);

  const payableId = String(settings.data?.default_vat_payable_id || "");
  const receivableId = String(settings.data?.default_vat_receivable_id || "");
  const lines = await getPostedLines(admin, orgId, dateFrom, dateTo);
  const payableLines = payableId ? lines.filter((line) => String(line.account_id) === payableId) : [];
  const receivableLines = receivableId ? lines.filter((line) => String(line.account_id) === receivableId) : [];
  const vatCollected = roundMoney(payableLines.reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0));
  const vatPaid = roundMoney(receivableLines.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0));
  return { payableLines, receivableLines, vatCollected, vatPaid, netVat: roundMoney(vatCollected - vatPaid) };
}

export async function getPayrollCostReport(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const settings = await db(admin)
    .from("accounting_settings")
    .select("default_salary_expense_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (settings.error) throw new Error(settings.error.message);

  const salaryExpenseId = String(settings.data?.default_salary_expense_id || "");
  const rows = salaryExpenseId
    ? (await getPostedLines(admin, orgId, dateFrom, dateTo)).filter((line) => String(line.account_id) === salaryExpenseId)
    : [];
  const totalPayrollCost = roundMoney(rows.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0));
  return { rows, totalPayrollCost };
}

export async function getEmployeeAdvancesReport(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const settings = await db(admin)
    .from("accounting_settings")
    .select("default_employee_advances_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (settings.error) throw new Error(settings.error.message);

  const advancesAccountId = String(settings.data?.default_employee_advances_id || "");
  const rows = advancesAccountId
    ? (await getPostedLines(admin, orgId, dateFrom, dateTo)).filter((line) => String(line.account_id) === advancesAccountId)
    : [];
  return {
    rows,
    totalAdvanced: roundMoney(rows.reduce((sum, line) => sum + Number(line.debit || 0), 0)),
    totalRecovered: roundMoney(rows.reduce((sum, line) => sum + Number(line.credit || 0), 0)),
    remainingBalance: roundMoney(rows.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0)),
  };
}

export async function getAccountingDashboard(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const [trialBalance, profitLoss, vat, journalResult, invoiceResult, expenseResult, paymentResult] = await Promise.all([
    getTrialBalance(admin, orgId, dateFrom, dateTo),
    getProfitLoss(admin, orgId, dateFrom, dateTo),
    getVatReport(admin, orgId, dateFrom, dateTo),
    db(admin).from("accounting_journal_entries").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(8),
    db(admin).from("accounting_invoices").select("*, customer:customer_id(name_ar)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(8),
    db(admin).from("accounting_expenses").select("*, vendor:vendor_id(name_ar)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(8),
    db(admin).from("accounting_payments").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(8),
  ]);

  if (journalResult.error) throw new Error(journalResult.error.message);
  if (invoiceResult.error) throw new Error(invoiceResult.error.message);
  if (expenseResult.error) throw new Error(expenseResult.error.message);
  if (paymentResult.error) throw new Error(paymentResult.error.message);

  const byCode = new Map(trialBalance.map((row) => [String(row.account_code), Number(row.balance || 0)]));
  const byType = (type: string) => roundMoney(trialBalance.filter((row) => row.account_type === type).reduce((sum, row) => sum + Number(row.balance || 0), 0));

  return {
    stats: {
      cashAndBank: roundMoney((byCode.get("1000") || 0) + (byCode.get("1010") || 0)),
      accountsReceivable: byCode.get("1100") || 0,
      accountsPayable: byCode.get("2000") || 0,
      monthlyRevenue: profitLoss.totalRevenue,
      monthlyExpenses: profitLoss.totalExpenses,
      netProfit: profitLoss.netProfit,
      vatNet: vat.netVat,
      assets: byType("asset"),
      liabilities: byType("liability"),
    },
    trialBalance,
    profitLoss,
    recentJournals: journalResult.data || [],
    recentInvoices: invoiceResult.data || [],
    recentExpenses: expenseResult.data || [],
    recentPayments: paymentResult.data || [],
  };
}
