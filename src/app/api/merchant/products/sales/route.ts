import { NextRequest, NextResponse } from "next/server";
import { createProductTraderSaleSchema } from "@/lib/product-trader/schemas";
import { requireProductTraderParticipantAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductTraderSaleCommand } from "@/lib/server/product-trader";

export async function POST(request: NextRequest) {
  const auth = await requireProductTraderParticipantAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "merchant") return NextResponse.json({ message: "فقط التاجر يمكنه تسجيل البيع." }, { status: 403 });
  const parsed = createProductTraderSaleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductTraderSaleCommand(auth.admin, { orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId, commandId, action: "sale_create", payload });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) { return productInventoryError(error, "تعذر تسجيل بيع المنتج."); }
}
