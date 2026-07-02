import type { createAdminClient } from "@/lib/supabase/admin";
import { roundMoney } from "@/lib/accounting/validation";
import { computeAging } from "@/lib/accounting/reports/core/aggregator";
import { getMonthsInRange } from "@/lib/accounting/reports/core/period-utils";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

interface ARAgingData {
  total_outstanding: number;
  invoice_count: number;
  buckets: Array<{ label: string; total: number; count: number; percentage: number }>;
  by_customer: Array<{ customer_name: string; total: number; count: number }>;
  trend: Array<{ period: string; total_outstanding: number }>;
}

export async function getARAgingReport(admin: AdminClient, orgId: string, asOf?: string) {
  const { data, error } = await db(admin)
    .from("accounting_invoices")
    .select("id, invoice_no, invoice_date, due_date, total_amount, paid_amount, balance_due, status, customer:customer_id(id, name_ar)")
    .eq("organization_id", orgId)
    .in("status", ["issued", "partially_paid"])
    .gt("balance_due", 0)
    .order("due_date", { ascending: true });

  if (error) throw new Error(error.message);
  const invoices = (data || []) as Record<string, unknown>[];

  const totalOutstanding = roundMoney(invoices.reduce((s, inv) => s + Number(inv.balance_due || 0), 0));

  // Aging buckets
  const agingBuckets = computeAging(invoices, "due_date", "balance_due", asOf);
  const buckets = agingBuckets.map((b) => ({
    label: b.label,
    total: b.total,
    count: b.count,
    percentage: totalOutstanding !== 0 ? roundMoney((b.total / totalOutstanding) * 100) : 0,
  }));

  // By customer
  const customerMap = new Map<string, { name: string; total: number; count: number }>();
  for (const inv of invoices) {
    const customer = inv.customer as Record<string, unknown> | null;
    const key = String(customer?.id || "unknown");
    const existing = customerMap.get(key) || { name: String(customer?.name_ar || "غير محدد"), total: 0, count: 0 };
    existing.total = roundMoney(existing.total + Number(inv.balance_due || 0));
    existing.count++;
    customerMap.set(key, existing);
  }
  const byCustomer = Array.from(customerMap.values())
    .map((c) => ({ customer_name: c.name, total: c.total, count: c.count }))
    .sort((a, b) => b.total - a.total);

  // 6-month trend
  const today = asOf || new Date().toISOString().slice(0, 10);
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  const months = getMonthsInRange(sixMonthsAgo.toISOString().slice(0, 10), today);
  const trend = months.map((period) => {
    const endOfMonth = new Date(period + "-01");
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    const periodInvoices = invoices.filter((inv) => {
      const issueDate = String(inv.invoice_date);
      return issueDate <= endOfMonth.toISOString().slice(0, 10);
    });
    return {
      period,
      total_outstanding: roundMoney(periodInvoices.reduce((s, inv) => s + Number(inv.balance_due || 0), 0)),
    };
  });

  const result: ARAgingData = {
    total_outstanding: totalOutstanding,
    invoice_count: invoices.length,
    buckets,
    by_customer: byCustomer,
    trend,
  };

  return buildReportResponse("ar_aging", orgId, { as_of: asOf || today }, result);
}
