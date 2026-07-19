import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { rematchActivations } from "@/lib/services/carrier-import";

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;

  const { month } = await request.json() as { month?: string };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ message: "month is required in YYYY-MM format" }, { status: 400 });
  }

  try {
    const result = await rematchActivations(auth.orgId, month, auth.user.id, auth.requestId);
    return NextResponse.json({ data: result, requestId: auth.requestId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Re-match failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
