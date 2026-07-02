import type { createAdminClient } from "@/lib/supabase/admin";
import { queryLedger, aggregateByAccount } from "@/lib/accounting/reports/core/ledger-query";
import { roundMoney } from "@/lib/accounting/validation";
import { getMonthsInRange } from "@/lib/accounting/reports/core/period-utils";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

interface CashPositionData {
  current_balance: number;
  accounts: Array<{ account_id: string; account_code: string; account_name: string; balance: number }>;
  daily_movements: Array<{ date: string; inflows: number; outflows: number; net: number; running_balance: number }>;
  monthly_summary: Array<{ period: string; opening: number; inflows: number; outflows: number; closing: number }>;
}

export async function getCashPosition(admin: AdminClient, orgId: string, dateFrom: string, dateTo: string) {
  // Get all lines for cash/bank accounts up to dateTo
  const allLines = await queryLedger(admin, { orgId, dateTo });
  const cashLines = allLines.filter(
    (l) => l.account.subtype === "cash" || l.account.subtype === "bank"
  );

  // Current balances by account
  const balances = aggregateByAccount(cashLines);
  const accounts = balances.map((b) => ({
    account_id: b.account_id,
    account_code: b.account_code,
    account_name: b.account_name_ar,
    balance: b.balance,
  }));
  const currentBalance = roundMoney(accounts.reduce((s, a) => s + a.balance, 0));

  // Period lines only
  const periodLines = cashLines.filter((l) => {
    const date = l.entry.entry_date;
    return date >= dateFrom && date <= dateTo;
  });

  // Daily movements
  const dailyMap = new Map<string, { inflows: number; outflows: number }>();
  for (const line of periodLines) {
    const date = line.entry.entry_date;
    const existing = dailyMap.get(date) || { inflows: 0, outflows: 0 };
    existing.inflows = roundMoney(existing.inflows + Number(line.debit || 0));
    existing.outflows = roundMoney(existing.outflows + Number(line.credit || 0));
    dailyMap.set(date, existing);
  }

  // Opening balance (all cash lines before dateFrom)
  const priorLines = cashLines.filter((l) => l.entry.entry_date < dateFrom);
  let runningBalance = roundMoney(priorLines.reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0));

  const dailyMovements = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { inflows, outflows }]) => {
      const net = roundMoney(inflows - outflows);
      runningBalance = roundMoney(runningBalance + net);
      return { date, inflows, outflows, net, running_balance: runningBalance };
    });

  // Monthly summary
  const months = getMonthsInRange(dateFrom, dateTo);
  let monthOpening = roundMoney(priorLines.reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0));
  const monthlySummary = months.map((period) => {
    const monthLines = periodLines.filter((l) => l.entry.entry_date.startsWith(period));
    const inflows = roundMoney(monthLines.reduce((s, l) => s + Number(l.debit || 0), 0));
    const outflows = roundMoney(monthLines.reduce((s, l) => s + Number(l.credit || 0), 0));
    const closing = roundMoney(monthOpening + inflows - outflows);
    const entry = { period, opening: monthOpening, inflows, outflows, closing };
    monthOpening = closing;
    return entry;
  });

  const data: CashPositionData = {
    current_balance: currentBalance,
    accounts,
    daily_movements: dailyMovements,
    monthly_summary: monthlySummary,
  };

  return buildReportResponse("cash_position", orgId, { from: dateFrom, to: dateTo }, data);
}
