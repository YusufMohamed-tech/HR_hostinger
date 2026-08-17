import type { createAdminClient } from "@/lib/supabase/admin";
import { queryLedger, aggregateByAccount, type LedgerLine } from "@/lib/accounting/reports/core/ledger-query";
import { roundMoney } from "@/lib/accounting/validation";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

interface CashFlowSection {
  label: string;
  items: Array<{ account_code: string; account_name: string; amount: number }>;
  total: number;
}

interface CashFlowData {
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  net_change: number;
  opening_cash: number;
  closing_cash: number;
}

export async function getCashFlowStatement(admin: AdminClient, orgId: string, dateFrom: string, dateTo: string) {
  const lines = await queryLedger(admin, { orgId, dateFrom, dateTo });

  const categorize = (category: string) => {
    const categoryLines = lines.filter((l) => l.account.cash_flow_category === category);
    const balances = aggregateByAccount(categoryLines);
    return {
      items: balances.map((b) => ({
        account_code: b.account_code,
        account_name: b.account_name_ar,
        amount: b.balance,
      })),
      total: roundMoney(balances.reduce((sum, b) => sum + b.balance, 0)),
    };
  };

  const operating = categorize("operating");
  const investing = categorize("investing");
  const financing = categorize("financing");

  // For uncategorized accounts, infer from type
  const uncategorizedLines = lines.filter((l) => !l.account.cash_flow_category);
  const uncategorizedByType = groupByInferredCategory(uncategorizedLines);

  const operatingSection: CashFlowSection = {
    label: "الأنشطة التشغيلية",
    items: [...operating.items, ...uncategorizedByType.operating.items],
    total: roundMoney(operating.total + uncategorizedByType.operating.total),
  };
  const investingSection: CashFlowSection = {
    label: "الأنشطة الاستثمارية",
    items: [...investing.items, ...uncategorizedByType.investing.items],
    total: roundMoney(investing.total + uncategorizedByType.investing.total),
  };
  const financingSection: CashFlowSection = {
    label: "الأنشطة التمويلية",
    items: [...financing.items, ...uncategorizedByType.financing.items],
    total: roundMoney(financing.total + uncategorizedByType.financing.total),
  };

  // Get opening cash balance (exclusive: day BEFORE dateFrom to avoid counting first-day transactions)
  const openingDateTo = new Date(dateFrom);
  openingDateTo.setDate(openingDateTo.getDate() - 1);
  const openingDateStr = openingDateTo.toISOString().split("T")[0];

  const priorLines = await queryLedger(admin, { orgId, dateTo: openingDateStr, accountTypes: ["asset"] });
  const cashAccounts = priorLines.filter((l) =>
    l.account.subtype === "cash" || l.account.subtype === "bank"
  );
  const openingCash = roundMoney(
    cashAccounts.reduce((sum, l) => sum + Number(l.debit || 0) - Number(l.credit || 0), 0)
  );

  const netChange = roundMoney(operatingSection.total + investingSection.total + financingSection.total);
  const closingCash = roundMoney(openingCash + netChange);

  // Reconciliation check: verify closing = GL balance at dateTo
  const closingLines = await queryLedger(admin, { orgId, dateTo, accountTypes: ["asset"] });
  const closingCashFromGL = roundMoney(
    closingLines
      .filter((l) => l.account.subtype === "cash" || l.account.subtype === "bank")
      .reduce((sum, l) => sum + Number(l.debit || 0) - Number(l.credit || 0), 0)
  );
  const reconciliationDifference = roundMoney(closingCash - closingCashFromGL);

  const data: CashFlowData & { reconciliation_difference?: number } = {
    operating: operatingSection,
    investing: investingSection,
    financing: financingSection,
    net_change: netChange,
    opening_cash: openingCash,
    closing_cash: closingCash,
    ...(reconciliationDifference !== 0 ? { reconciliation_difference: reconciliationDifference } : {}),
  };

  return buildReportResponse("cash_flow_statement", orgId, { from: dateFrom, to: dateTo }, data);
}

function groupByInferredCategory(lines: LedgerLine[]) {
  const operating: Array<{ account_code: string; account_name: string; amount: number }> = [];
  const investing: Array<{ account_code: string; account_name: string; amount: number }> = [];
  const financing: Array<{ account_code: string; account_name: string; amount: number }> = [];

  const balances = aggregateByAccount(lines);
  for (const b of balances) {
    // Skip cash/bank accounts themselves
    if (b.account_subtype === "cash" || b.account_subtype === "bank") continue;

    const item = { account_code: b.account_code, account_name: b.account_name_ar, amount: b.balance };

    if (b.account_type === "revenue" || b.account_type === "expense") {
      operating.push(item);
    } else if (b.account_subtype === "fixed_asset" || b.account_subtype === "depreciation") {
      investing.push(item);
    } else if (b.account_type === "equity") {
      financing.push(item);
    } else {
      // AR, AP, other current items -> operating
      operating.push(item);
    }
  }

  return {
    operating: { items: operating, total: roundMoney(operating.reduce((s, i) => s + i.amount, 0)) },
    investing: { items: investing, total: roundMoney(investing.reduce((s, i) => s + i.amount, 0)) },
    financing: { items: financing, total: roundMoney(financing.reduce((s, i) => s + i.amount, 0)) },
  };
}
