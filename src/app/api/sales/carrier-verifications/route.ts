import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const sp = request.nextUrl.searchParams;
  const admin = createAdminClient();
  const myOnly = sp.get("my") === "true";

  if (myOnly && !auth.isManager) {
    // Employee sees their own discrepancies only
    const { data: emp } = await admin
      .from("employees")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("organization_id", auth.orgId)
      .single();

    if (!emp) return NextResponse.json({ data: [] });

    const { data, error } = await admin
      .from("carrier_sales_verifications")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("employee_id", (emp as { id: string }).id)
      .eq("has_discrepancy", true)
      .order("verification_date", { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ message: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (!auth.isManager) {
    return NextResponse.json({ message: "Manager access required" }, { status: 403 });
  }

  let q = admin
    .from("carrier_sales_verifications")
    .select(`
      *,
      employee:employees(id, full_name)
    `)
    .eq("organization_id", auth.orgId)
    .order("verification_date", { ascending: false })
    .limit(500);

  const employeeId = sp.get("employee_id");
  const status = sp.get("status");
  const hasDiscrepancy = sp.get("has_discrepancy");
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");

  if (employeeId) q = q.eq("employee_id", employeeId) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  if (hasDiscrepancy === "true") q = q.eq("has_discrepancy", true) as typeof q;
  if (dateFrom) q = q.gte("verification_date", dateFrom) as typeof q;
  if (dateTo) q = q.lte("verification_date", dateTo) as typeof q;

  const { data, error } = await q;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 });

  const body = await request.json() as {
    seen_by_employee?: boolean;
    seen_by_hr?: boolean;
    employee_note?: string;
    status?: string;
  };

  const update: Record<string, unknown> = {};
  if (body.seen_by_employee !== undefined) {
    update.seen_by_employee = body.seen_by_employee;
    if (body.seen_by_employee) update.seen_at_employee = new Date().toISOString();
  }
  if (body.seen_by_hr !== undefined && auth.isManager) {
    update.seen_by_hr = body.seen_by_hr;
    if (body.seen_by_hr) update.seen_at_hr = new Date().toISOString();
  }
  if (body.employee_note !== undefined) update.employee_note = body.employee_note;
  if (body.status && auth.isManager) update.status = body.status;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_sales_verifications")
    .update(update)
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .select()
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
