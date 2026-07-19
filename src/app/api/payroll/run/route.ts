import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { PayrollConfigurationError, runPayrollMonth } from "@/lib/server/payroll";

const schema = z.object({ month: z.string(), command_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "payroll", capability: "manage_payroll" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid payroll command.", requestId: auth.requestId }, { status: 400 });
  try {
    const payslips = await runPayrollMonth({ admin: auth.admin, orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId }, {
      month: parsed.data.month,
      commandId: parsed.data.command_id,
    });
    return NextResponse.json({ payslips, requestId: auth.requestId });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const status = error instanceof PayrollConfigurationError ? 400 : code === "40001" || code === "23505" || code === "55000" ? 409 : code === "42501" ? 403 : 500;
    return NextResponse.json({ message: error instanceof Error ? error.message : "Payroll run failed.", requestId: auth.requestId }, { status });
  }
}
