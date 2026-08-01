import { NextRequest, NextResponse } from "next/server";
import { issueProductTraderHandoverSchema } from "@/lib/product-trader/schemas";
import { requireProductTraderParticipantAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductTraderCommand, loadAgentProductTraderWorkspace } from "@/lib/server/product-trader";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireProductTraderParticipantAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "field_agent") {
    return NextResponse.json({ message: "هذه الشاشة متاحة للمندوب الميداني فقط." }, { status: 403 });
  }
  try {
    return NextResponse.json({ data: await loadAgentProductTraderWorkspace(auth.admin, auth.orgId, auth.user.id) });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل عهدة منتجات التجار.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductTraderParticipantAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "field_agent") {
    return NextResponse.json({ message: "فقط المندوب الميداني يمكنه بدء تسليم المنتجات للتاجر." }, { status: 403 });
  }
  const parsed = issueProductTraderHandoverSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "بيانات التسليم غير صالحة." }, { status: 400 });
  }
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductTraderCommand(auth.admin, {
      orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId,
      commandId, action: "trader_handover_issue", payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر تسليم المنتجات للتاجر.");
  }
}
