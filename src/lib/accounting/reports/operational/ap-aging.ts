import type { createAdminClient } from "@/lib/supabase/admin";
import { roundMoney } from "@/lib/accounting/validation";
import { computeAging } from "@/lib/accounting/reports/core/aggregator";
import { buildReportResponse } from "@/lib/accounting/reports/core/formatter";

type AdminClient = ReturnType<typeof createAdminClient>;

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

interface APAgingData {
  total_outstanding: number;
  expense_count: number;
  buckets: Array<{ label: string; total: number; count: number; percentage: number }>;
  by_vendor: Array<{ vendor_name: string; total: number; count: number }>;
}

export async function getAPAgingReport(admin: AdminClient, orgId: string, asOf?: string) {
  const { data, error } = await db(admin)
    .from("accounting_expenses")
    .select("id, expense_no, expense_date, total_amount, status, paid_status, vendor:vendor_id(id, name_ar)")
    .eq("organization_id", orgId)
    .eq("status", "approved")
    .neq("paid_status", "paid")
    .order("expense_date", { ascending: true });

  if (error) throw new Error(error.message);
  const expenses = (data || []) as Record<string, unknown>[];

  const totalOutstanding = roundMoney(expenses.reduce((s, exp) => s + Number(exp.total_amount || 0), 0));

  const agingBuckets = computeAging(expenses, "expense_date", "total_amount", asOf);
  const buckets = agingBuckets.map((b) => ({
    label: b.label,
    total: b.total,
    count: b.count,
    percentage: totalOutstanding !== 0 ? roundMoney((b.total / totalOutstanding) * 100) : 0,
  }));

  const vendorMap = new Map<string, { name: string; total: number; count: number }>();
  for (const exp of expenses) {
    const vendor = exp.vendor as Record<string, unknown> | null;
    const key = String(vendor?.id || "unknown");
    const existing = vendorMap.get(key) || { name: String(vendor?.name_ar || "غير محدد"), total: 0, count: 0 };
    existing.total = roundMoney(existing.total + Number(exp.total_amount || 0));
    existing.count++;
    vendorMap.set(key, existing);
  }
  const byVendor = Array.from(vendorMap.values())
    .map((v) => ({ vendor_name: v.name, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);

  const today = asOf || new Date().toISOString().slice(0, 10);
  const result: APAgingData = {
    total_outstanding: totalOutstanding,
    expense_count: expenses.length,
    buckets,
    by_vendor: byVendor,
  };

  return buildReportResponse("ap_aging", orgId, { as_of: today }, result);
}
