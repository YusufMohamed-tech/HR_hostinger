import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;

  const sp = request.nextUrl.searchParams;
  const admin = createAdminClient();
  const page = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = Math.max(1, Math.min(500, Number(sp.get("page_size") || 100)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (!auth.isManager) {
    // Employee sees their own discrepancies only
    const { data: emp } = await admin
      .from("employees")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("org_id", auth.orgId)
      .single();

    if (!emp) return NextResponse.json({ data: [], completeness: { total: 0, page, pageSize, complete: true } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error, count } = await (admin as any)
      .from("carrier_sales_verifications")
      .select("*", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .eq("employee_id", (emp as { id: string }).id)
      .eq("has_discrepancy", true)
      .order("verification_date", { ascending: false })
      .range(from, to);

    if (error) return NextResponse.json({ message: error.message }, { status: 500 });
    return NextResponse.json({
      data,
      completeness: { total: count || 0, page, pageSize, complete: to >= (count || 0) - 1 },
      requestId: auth.requestId,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("carrier_sales_verifications")
    .select(`
      *,
      employee:employees(id, full_name)
    `, { count: "exact" })
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  const employeeId = sp.get("employee_id");
  const status = sp.get("status");
  const hasDiscrepancy = sp.get("has_discrepancy");
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const runId = sp.get("run_id");

  if (employeeId) q = q.eq("employee_id", employeeId) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  if (hasDiscrepancy === "true") q = q.eq("has_discrepancy", true) as typeof q;
  if (dateFrom) q = q.gte("verification_date", dateFrom) as typeof q;
  if (dateTo) q = q.lte("verification_date", dateTo) as typeof q;
  if (runId) q = q.eq("run_id", runId) as typeof q;

  const { data, error, count } = await q.range(from, to);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({
    data,
    completeness: { total: count || 0, page, pageSize, complete: to >= (count || 0) - 1 },
    requestId: auth.requestId,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 });

  const body = await request.json() as {
    seen_by_employee?: boolean;
    seen_by_hr?: boolean;
    employee_note?: string;
    status?: string;
  };

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = await (admin as any)
    .from("carrier_sales_verifications")
    .select("id, version")
    .eq("organization_id", auth.orgId)
    .eq("id", id).maybeSingle();
  if (current.error) return NextResponse.json({ message: current.error.message }, { status: 500 });
  if (!current.data) return NextResponse.json({ message: "Carrier verification was not found." }, { status: 404 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc("update_carrier_verification", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_verification_id: id,
    p_expected_version: Number(current.data.version),
    p_payload: {
      seen_by_employee: body.seen_by_employee,
      seen_by_hr: body.seen_by_hr,
      employee_note: body.employee_note,
      status: body.status,
    },
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404
      : error.code === "40001" ? 409 : ["22023", "23514"].includes(error.code || "") ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data, requestId: auth.requestId });
}
