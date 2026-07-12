import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { recalculatePayslip } from "@/lib/services/payroll";

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"], feature: "hr" });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const employeeId = String(body.employee_id || "").trim();
  const month = String(body.month || "").trim();

  if (!employeeId) return NextResponse.json({ message: "employee_id is required." }, { status: 400 });
  if (!month) return NextResponse.json({ message: "month is required." }, { status: 400 });

  const result = await recalculatePayslip(auth.orgId, employeeId, month);

  if (result.error) {
    const status = result.error.message.includes("paid") ? 409 : 500;
    return NextResponse.json({ message: result.error.message }, { status });
  }

  return NextResponse.json({ data: result.data });
}
