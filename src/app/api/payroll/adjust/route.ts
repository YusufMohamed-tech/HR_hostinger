import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { addManualAdjustment } from "@/lib/services/payroll";

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"], feature: "hr" });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const payslipId = String(body.payslip_id || "").trim();
  const type = String(body.type || "").trim() as "bonus" | "deduction";
  const amount = Number(body.amount || 0);
  const reason = String(body.reason || "").trim();

  if (!payslipId) return NextResponse.json({ message: "payslip_id is required." }, { status: 400 });
  if (!["bonus", "deduction"].includes(type)) return NextResponse.json({ message: "type must be bonus or deduction." }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ message: "amount must be greater than zero." }, { status: 400 });
  if (!reason) return NextResponse.json({ message: "reason is required." }, { status: 400 });

  const result = await addManualAdjustment(payslipId, {
    type,
    amount,
    reason,
    createdBy: auth.user.id,
  });

  if (result.error) {
    const status = (result.error as { message: string }).message.includes("paid") ? 409 : 500;
    return NextResponse.json({ message: (result.error as { message: string }).message }, { status });
  }

  return NextResponse.json({ data: result.data }, { status: 201 });
}
