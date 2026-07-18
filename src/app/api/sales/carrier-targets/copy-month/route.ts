import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const { from_month, to_month } = await request.json() as { from_month?: string; to_month?: string };
  if (!from_month || !to_month) {
    return NextResponse.json({ message: "from_month and to_month are required (YYYY-MM)" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sourceRows, error } = await (admin as any)
    .from("carrier_sales_targets")
    .select("employee_id, supervisor_id, fpe_target, revenue_target, friendi_target, virgin_target, postpaid_target, hbb_target, working_days")
    .eq("organization_id", auth.orgId)
    .eq("target_month", `${from_month}-01`);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  if (!sourceRows || sourceRows.length === 0) {
    return NextResponse.json({ message: `No targets found for ${from_month}` }, { status: 404 });
  }

  const inserts = (sourceRows as Record<string, unknown>[]).map((r) => ({
    organization_id: auth.orgId,
    target_month: `${to_month}-01`,
    employee_id: r.employee_id,
    supervisor_id: r.supervisor_id,
    fpe_target: r.fpe_target,
    revenue_target: r.revenue_target,
    friendi_target: r.friendi_target,
    virgin_target: r.virgin_target,
    postpaid_target: r.postpaid_target,
    hbb_target: r.hbb_target,
    working_days: r.working_days,
    set_by: auth.user.id,
    updated_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await (admin as any)
    .from("carrier_sales_targets")
    .upsert(inserts, { onConflict: "organization_id,target_month,employee_id" });

  if (insertErr) return NextResponse.json({ message: insertErr.message }, { status: 500 });
  return NextResponse.json({ data: { copied: inserts.length } });
}
