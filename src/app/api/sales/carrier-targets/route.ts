import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ message: "month is required in YYYY-MM format" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("carrier_sales_targets")
    .select(`
      *,
      employee:employees(id, full_name, gosi_registered),
      supervisor:employees!carrier_sales_targets_supervisor_id_fkey(id, full_name)
    `)
    .eq("organization_id", auth.orgId)
    .eq("target_month", `${month}-01`)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json() as {
    month: string;
    employee_id: string;
    supervisor_id?: string;
    fpe_target?: number;
    revenue_target?: number;
    friendi_target?: number;
    virgin_target?: number;
    postpaid_target?: number;
    hbb_target?: number;
    working_days?: number;
  };

  if (!body.month || !body.employee_id) {
    return NextResponse.json({ message: "month and employee_id are required" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(body.month)) {
    return NextResponse.json({ message: "month must be in YYYY-MM format" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("carrier_sales_targets")
    .upsert({
      organization_id: auth.orgId,
      target_month: `${body.month}-01`,
      employee_id: body.employee_id,
      supervisor_id: body.supervisor_id ?? null,
      fpe_target: body.fpe_target ?? 0,
      revenue_target: body.revenue_target ?? 0,
      friendi_target: body.friendi_target ?? 0,
      virgin_target: body.virgin_target ?? 0,
      postpaid_target: body.postpaid_target ?? 0,
      hbb_target: body.hbb_target ?? 0,
      working_days: body.working_days ?? 25,
      set_by: auth.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,target_month,employee_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
