import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { loadStoredAdjustments, PayrollConfigurationError, replacePayslipManualAdjustments } from "@/lib/server/payroll";
import { moneyToHalalas } from "@/lib/payroll/engine";

const schema = z.object({
  payslip_id: z.string().uuid(),
  command_id: z.string().uuid(),
  type: z.enum(["bonus", "deduction"]),
  amount: z.number().finite().positive(),
  reason: z.string().trim().min(3).max(1000),
});

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "payroll", capability: "manage_payroll" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid payroll adjustment.", requestId: auth.requestId }, { status: 400 });
  try {
    const context = { admin: auth.admin, orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId };
    const current = await loadStoredAdjustments(context, parsed.data.payslip_id);
    const adjustment = {
      id: parsed.data.command_id,
      type: parsed.data.type,
      amountHalalas: moneyToHalalas(parsed.data.amount, "adjustment amount"),
      reason: parsed.data.reason,
      createdBy: auth.user.id,
      createdAt: new Date().toISOString(),
    } as const;
    const payslip = await replacePayslipManualAdjustments(context, {
      payslipId: current.payslipId,
      employeeId: current.employeeId,
      month: current.month,
      commandId: parsed.data.command_id,
      commandAction: "add_adjustment",
      manualAdjustments: [...current.adjustments, adjustment],
    });
    return NextResponse.json({ payslip, requestId: auth.requestId }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const status = error instanceof PayrollConfigurationError ? 400
      : ["23505", "40001", "55000"].includes(code || "") ? 409
        : code === "42501" ? 403 : code === "P0002" ? 404 : 500;
    return NextResponse.json({ message: error instanceof Error ? error.message : "Payroll adjustment failed.", requestId: auth.requestId }, { status });
  }
}
