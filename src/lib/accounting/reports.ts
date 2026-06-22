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
  const { data, error } = await db(admin)
    .from("accounting_journal_lines")
    .select("*, account:account_id(id, code, name_ar, name_en, type, normal_balance), entry:journal_entry_id(id, entry_no, entry_date, description, status, source_module)")
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  return ((data || []) as Record<string, unknown>[]).filter((line) => {
    const entry = line.entry as Record<string, unknown> | null;
    return entry?.status === "posted" && inDateRange(String(entry.entry_date), dateFrom, dateTo);
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

export async function getGeneralLedger(admin: AdminClient, orgId: string, accountId?: string, dateFrom?: string, dateTo?: string) {
  const lines = (await getPostedLines(admin, orgId, dateFrom, dateTo))
    .filter((line) => !accountId || String(line.account_id) === accountId)
    .sort((a, b) => {
      const ea = a.entry as Record<string, unknown>;
      const eb = b.entry as Record<string, unknown>;
      return String(ea.entry_date).localeCompare(String(eb.entry_date)) || String(ea.entry_no).localeCompare(String(eb.entry_no));
    });

  let runningBalance = 0;
  return lines.map((line) => {
    const entry = (line.entry || {}) as Record<string, unknown>;
    const account = (line.account || {}) as Record<string, unknown>;
    const normal = String(account.normal_balance || "debit");
    const movement = normal === "credit"
      ? Number(line.credit || 0) - Number(line.debit || 0)
      : Number(line.debit || 0) - Number(line.credit || 0);
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
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      running_balance: runningBalance,
    };
  });
}

export async function getProfitLoss(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const rows = await getTrialBalance(admin, orgId, dateFrom, dateTo);
  const revenue = rows.filter((row) => row.account_type === "revenue");
  const expenses = rows.filter((row) => row.account_type === "expense");
  const totalRevenue = roundMoney(revenue.reduce((sum, row) => sum + Number(row.balance || 0), 0));
  const totalExpenses = roundMoney(expenses.reduce((sum, row) => sum + Number(row.balance || 0), 0));
  return { revenue, expenses, totalRevenue, totalExpenses, netProfit: roundMoney(totalRevenue - totalExpenses) };
}

export async function getBalanceSheet(admin: AdminClient, orgId: string, asOf?: string) {
  const rows = await getTrialBalance(admin, orgId, undefined, asOf);
  const assets = rows.filter((row) => row.account_type === "asset");
  const liabilities = rows.filter((row) => row.account_type === "liability");
  const equity = rows.filter((row) => row.account_type === "equity");
  return {
    assets,
    liabilities,
    equity,
    totalAssets: roundMoney(assets.reduce((sum, row) => sum + Number(row.balance || 0), 0)),
    totalLiabilities: roundMoney(liabilities.reduce((sum, row) => sum + Number(row.balance || 0), 0)),
    totalEquity: roundMoney(equity.reduce((sum, row) => sum + Number(row.balance || 0), 0)),
  };
}

export async function getVatReport(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const [invoicesResult, expensesResult] = await Promise.all([
    db(admin)
      .from("accounting_invoices")
      .select("invoice_no, invoice_date, vat_amount, status")
      .eq("organization_id", orgId)
      .in("status", ["issued", "partially_paid", "paid"]),
    db(admin)
      .from("accounting_expenses")
      .select("expense_no, expense_date, vat_amount, status")
      .eq("organization_id", orgId)
      .in("status", ["approved", "paid"]),
  ]);

  if (invoicesResult.error) throw new Error(invoicesResult.error.message);
  if (expensesResult.error) throw new Error(expensesResult.error.message);

  const invoices = ((invoicesResult.data || []) as Record<string, unknown>[]).filter((row) => inDateRange(String(row.invoice_date), dateFrom, dateTo));
  const expenses = ((expensesResult.data || []) as Record<string, unknown>[]).filter((row) => inDateRange(String(row.expense_date), dateFrom, dateTo));
  const vatCollected = roundMoney(invoices.reduce((sum, row) => sum + Number(row.vat_amount || 0), 0));
  const vatPaid = roundMoney(expenses.reduce((sum, row) => sum + Number(row.vat_amount || 0), 0));
  return { invoices, expenses, vatCollected, vatPaid, netVat: roundMoney(vatCollected - vatPaid) };
}

export async function getPayrollCostReport(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const { data, error } = await db(admin)
    .from("payslips")
    .select("*, employee:employee_id(full_name, employee_code, department_id, department:department_id(name))")
    .eq("org_id", orgId)
    .order("month", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = ((data || []) as Record<string, unknown>[]).filter((row) => inDateRange(String(row.month).slice(0, 10), dateFrom, dateTo));
  const totalNet = roundMoney(rows.reduce((sum, row) => sum + Number(row.net_salary || 0), 0));
  const totalDeductions = roundMoney(rows.reduce((sum, row) => sum + Number(row.total_deductions || 0), 0));
  return { rows, totalNet, totalDeductions, totalGross: roundMoney(totalNet + totalDeductions) };
}

export async function getEmployeeAdvancesReport(admin: AdminClient, orgId: string, dateFrom?: string, dateTo?: string) {
  const [requestsResult, balancesResult] = await Promise.all([
    db(admin)
      .from("advance_requests")
      .select("*, employee:employee_id(full_name, employee_code)")
      .eq("organization_id", orgId)
      .in("status", ["approved", "partial_approved"]),
    db(admin)
      .from("financial_balances")
      .select("*, employee:employee_id(full_name, employee_code)")
      .eq("org_id", orgId)
      .eq("balance_type", "advance_payment"),
  ]);
  if (requestsResult.error) throw new Error(requestsResult.error.message);
  if (balancesResult.error) throw new Error(balancesResult.error.message);

  const advances = ((requestsResult.data || []) as Record<string, unknown>[]).filter((row) => inDateRange(String(row.created_at).slice(0, 10), dateFrom, dateTo));
  const balances = ((balancesResult.data || []) as Record<string, unknown>[]).filter((row) => inDateRange(String(row.created_at).slice(0, 10), dateFrom, dateTo));
  return {
    advances,
    balances,
    totalAdvanced: roundMoney(advances.reduce((sum, row) => sum + Number(row.approved_amount || row.requested_amount || 0), 0)),
    remainingBalance: roundMoney(balances.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
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
