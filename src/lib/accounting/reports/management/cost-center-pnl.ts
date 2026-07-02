import type { createAdminClient } from "@/lib/supabase/admin";
import { queryLedger, type LedgerLine } from "@/lib/accounting/reports/core/ledger-query";
import { roundMoney } from "@/lib/accounting/validation";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

interface CostCenterPnLRow {
  cost_center_id: string;
  cost_center_name: string;
  cost_center_code: string;
  revenue: number;
  expenses: number;
  net_profit: number;
  margin_percent: number | null;
}

interface CostCenterPnLData {
  rows: CostCenterPnLRow[];
  totals: { revenue: number; expenses: number; net_profit: number };
  unassigned: { revenue: number; expenses: number; net_profit: number };
}

export async function getCostCenterPnL(
  admin: AdminClient,
  orgId: string,
  dateFrom: string,
  dateTo: string,
  costCenterId?: string
) {
  const lines = await queryLedger(admin, {
    orgId,
    dateFrom,
    dateTo,
    accountTypes: ["revenue", "expense"],
    ...(costCenterId ? { costCenterIds: [costCenterId] } : {}),
  });

  // Get cost center names
  const { data: centers } = await db(admin)
    .from("accounting_cost_centers")
    .select("id, code, name_ar")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  const centerMap = new Map(
    ((centers || []) as Record<string, unknown>[]).map((c) => [String(c.id), { name: String(c.name_ar), code: String(c.code) }])
  );

  // Group by cost center
  const grouped = new Map<string, { revenue: number; expenses: number }>();

  for (const line of lines) {
    const ccId = line.cost_center_id || "unassigned";
    const existing = grouped.get(ccId) || { revenue: 0, expenses: 0 };

    if (line.account.type === "revenue") {
      existing.revenue = roundMoney(existing.revenue + Number(line.credit || 0) - Number(line.debit || 0));
    } else {
      existing.expenses = roundMoney(existing.expenses + Number(line.debit || 0) - Number(line.credit || 0));
    }

    grouped.set(ccId, existing);
  }

  const rows: CostCenterPnLRow[] = [];
  let unassigned = { revenue: 0, expenses: 0, net_profit: 0 };

  for (const [ccId, values] of Array.from(grouped)) {
    const netProfit = roundMoney(values.revenue - values.expenses);
    if (ccId === "unassigned") {
      unassigned = { ...values, net_profit: netProfit };
      continue;
    }
    const center = centerMap.get(ccId);
    rows.push({
      cost_center_id: ccId,
      cost_center_name: center?.name || "غير معروف",
      cost_center_code: center?.code || "",
      revenue: values.revenue,
      expenses: values.expenses,
      net_profit: netProfit,
      margin_percent: values.revenue !== 0 ? roundMoney((netProfit / values.revenue) * 100) : null,
    });
  }

  rows.sort((a, b) => b.net_profit - a.net_profit);

  const totals = {
    revenue: roundMoney(rows.reduce((s, r) => s + r.revenue, 0) + unassigned.revenue),
    expenses: roundMoney(rows.reduce((s, r) => s + r.expenses, 0) + unassigned.expenses),
    net_profit: roundMoney(rows.reduce((s, r) => s + r.net_profit, 0) + unassigned.net_profit),
  };

  const data: CostCenterPnLData = { rows, totals, unassigned };
  return buildReportResponse("cost_center_pnl", orgId, { from: dateFrom, to: dateTo }, data);
}
