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

type GroupBy = "customer" | "product" | "channel" | "month";

interface RevenueAnalysisData {
  total_revenue: number;
  invoice_count: number;
  group_by: GroupBy;
  breakdown: Array<{ key: string; label: string; total: number; count: number; percentage?: number }>;
  monthly_trend: Array<{ period: string; total: number; count: number }>;
}

export async function getRevenueAnalysis(
  admin: AdminClient,
  orgId: string,
  dateFrom: string,
  dateTo: string,
  groupBy: GroupBy = "customer"
) {
  const { data, error } = await db(admin)
    .from("accounting_invoices")
    .select("id, invoice_no, invoice_date, subtotal, discount_amount, vat_amount, total_amount, status, source_module, customer:customer_id(id, name_ar, sales_company_id), lines:accounting_invoice_lines(product_id, line_total, cost_center_id)")
    .eq("organization_id", orgId)
    .in("status", ["issued", "partially_paid", "paid"])
    .gte("invoice_date", dateFrom)
    .lte("invoice_date", dateTo)
    .order("invoice_date", { ascending: false });

  if (error) throw new Error(error.message);
  const invoices = (data || []) as Record<string, unknown>[];

  const totalRevenue = roundMoney(invoices.reduce((s, inv) => s + Number(inv.total_amount || 0), 0));

  // Monthly trend
  const months = getMonthsInRange(dateFrom, dateTo);
  const monthlyTrend = months.map((period) => {
    const monthInvoices = invoices.filter((inv) => String(inv.invoice_date).startsWith(period));
    return {
      period,
      total: roundMoney(monthInvoices.reduce((s, inv) => s + Number(inv.total_amount || 0), 0)),
      count: monthInvoices.length,
    };
  });

  // Breakdown
  let breakdown;
  if (groupBy === "customer") {
    const grouped = groupAndSum(
      invoices,
      (inv) => String((inv.customer as Record<string, unknown>)?.id || "unknown"),
      (inv) => String((inv.customer as Record<string, unknown>)?.name_ar || "غير محدد"),
      (inv) => Number(inv.total_amount || 0)
    );
    const { top, others } = topN(grouped, 10);
    breakdown = others ? [...top, others] : top;
  } else if (groupBy === "month") {
    breakdown = monthlyTrend.map((m) => ({
      key: m.period,
      label: m.period,
      total: m.total,
      count: m.count,
      percentage: totalRevenue !== 0 ? roundMoney((m.total / totalRevenue) * 100) : 0,
    }));
  } else if (groupBy === "channel") {
    const grouped = groupAndSum(
      invoices,
      (inv) => String(inv.source_module || "manual"),
      (inv) => String(inv.source_module || "يدوي"),
      (inv) => Number(inv.total_amount || 0)
    );
    breakdown = grouped;
  } else {
    // product
    const allLines = invoices.flatMap((inv) => {
      const lines = Array.isArray(inv.lines) ? inv.lines as Record<string, unknown>[] : [];
      return lines;
    });
    const grouped = groupAndSum(
      allLines,
      (line) => String(line.product_id || "other"),
      (line) => String(line.product_id || "أخرى"),
      (line) => Number(line.line_total || 0)
    );
    const { top, others } = topN(grouped, 10);
    breakdown = others ? [...top, others] : top;
  }

  const result: RevenueAnalysisData = {
    total_revenue: totalRevenue,
    invoice_count: invoices.length,
    group_by: groupBy,
    breakdown,
    monthly_trend: monthlyTrend,
  };

  return buildReportResponse("revenue_analysis", orgId, { from: dateFrom, to: dateTo }, result);
}
