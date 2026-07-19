import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { normalizePayrollMonth } from "@/lib/server/payroll";

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "payroll" }, request);
  if ("error" in auth) return auth.error;
  let month: string;
  try {
    month = normalizePayrollMonth(request.nextUrl.searchParams.get("month") || "");
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Invalid payroll month.", requestId: auth.requestId }, { status: 400 });
  }
  let query = auth.admin
    .from("payslips")
    .select("*, employee:employee_id(full_name, employee_code, base_salary)")
    .eq("org_id", auth.orgId)
    .eq("month", month)
    .order("created_at", { ascending: true });
  if (!auth.capabilities.manage_payroll) {
    if (!auth.employeeId) return NextResponse.json({ message: "Employee profile is required.", requestId: auth.requestId }, { status: 403 });
    query = query.eq("employee_id", auth.employeeId);
  }
  const payslipsResult = await query;
  if (payslipsResult.error) return NextResponse.json({ message: payslipsResult.error.message, requestId: auth.requestId }, { status: 500 });
  const runResult = auth.capabilities.manage_payroll
    ? await auth.admin.from("payroll_runs").select("*").eq("org_id", auth.orgId).eq("month", month).maybeSingle()
    : { data: null, error: null };
  if (runResult.error) return NextResponse.json({ message: runResult.error.message, requestId: auth.requestId }, { status: 500 });
  return NextResponse.json({ payslips: payslipsResult.data || [], run: runResult.data, requestId: auth.requestId });
}
