import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { loadStoredAdjustments, PayrollConfigurationError, replacePayslipManualAdjustments } from "@/lib/server/payroll";

const querySchema = z.object({ payslipId: z.string().uuid(), commandId: z.string().uuid() });

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantContext({ feature: "payroll", capability: "manage_payroll" }, request);
  if ("error" in auth) return auth.error;
  const parsed = querySchema.safeParse({
    payslipId: request.nextUrl.searchParams.get("payslipId"),
    commandId: request.nextUrl.searchParams.get("commandId"),
  });
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ message: "Valid payslip, adjustment, and command ids are required.", requestId: auth.requestId }, { status: 400 });
  }
  try {
    const context = { admin: auth.admin, orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId };
    const current = await loadStoredAdjustments(context, parsed.data.payslipId);
    if (!current.adjustments.some((adjustment) => adjustment.id === id)) {
      const replay = await auth.admin.from("payroll_commands")
        .select("action, status, payslip_id")
        .eq("org_id", auth.orgId)
        .eq("idempotency_key", parsed.data.commandId)
        .maybeSingle();
      if (replay.error) throw new Error(`Unable to inspect payroll command: ${replay.error.message}`);
      if ((replay.data as Record<string, unknown> | null)?.action === "remove_adjustment"
          && (replay.data as Record<string, unknown>).status === "completed") {
        return NextResponse.json({ payslip: null, replayed: true, requestId: auth.requestId });
      }
      return NextResponse.json({ message: "Adjustment was not found.", requestId: auth.requestId }, { status: 404 });
    }
    const payslip = await replacePayslipManualAdjustments(context, {
      payslipId: current.payslipId,
      employeeId: current.employeeId,
      month: current.month,
      commandId: parsed.data.commandId,
      commandAction: "remove_adjustment",
      manualAdjustments: current.adjustments.filter((adjustment) => adjustment.id !== id),
    });
    return NextResponse.json({ payslip, requestId: auth.requestId });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const status = error instanceof PayrollConfigurationError ? 400
      : ["23505", "40001", "55000"].includes(code || "") ? 409
        : code === "42501" ? 403 : code === "P0002" ? 404 : 500;
    return NextResponse.json({ message: error instanceof Error ? error.message : "Payroll adjustment removal failed.", requestId: auth.requestId }, { status });
  }
}
