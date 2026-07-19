import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { calculateAndSaveEmployeePayslip, PayrollConfigurationError } from "@/lib/server/payroll";

const schema = z.object({ employee_id: z.string().uuid(), month: z.string(), command_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "payroll", capability: "manage_payroll" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid payroll command.", requestId: auth.requestId }, { status: 400 });
  try {
    const payslip = await calculateAndSaveEmployeePayslip(
      { admin: auth.admin, orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId },
      { employeeId: parsed.data.employee_id, month: parsed.data.month, commandId: parsed.data.command_id }
    );
    return NextResponse.json({ payslip, requestId: auth.requestId });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const status = error instanceof PayrollConfigurationError ? 400
      : ["23505", "40001", "55000"].includes(code || "") ? 409
        : code === "42501" ? 403 : code === "P0002" ? 404 : 500;
    return NextResponse.json({ message: error instanceof Error ? error.message : "Payroll calculation failed.", requestId: auth.requestId }, { status });
  }
}
