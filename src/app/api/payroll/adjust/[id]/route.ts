import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { removeManualAdjustment } from "@/lib/services/payroll";

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"], feature: "hr" });
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const payslipId = searchParams.get("payslipId") || "";

  if (!payslipId) return NextResponse.json({ message: "payslipId query param is required." }, { status: 400 });

  const result = await removeManualAdjustment(payslipId, params.id);

  if (result.error) {
    const status = (result.error as { message: string }).message.includes("paid") ? 409 : 500;
    return NextResponse.json({ message: (result.error as { message: string }).message }, { status });
  }

  return NextResponse.json({ data: result.data });
}
