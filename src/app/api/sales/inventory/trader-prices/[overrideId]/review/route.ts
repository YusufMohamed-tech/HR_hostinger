import { NextRequest, NextResponse } from "next/server";
import { reviewProductTraderPriceOverrideSchema } from "@/lib/product-trader/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductTraderSaleCommand } from "@/lib/server/product-trader";

type Context = { params: Promise<{ overrideId: string }> };
export async function POST(request: NextRequest, context: Context) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = reviewProductTraderPriceOverrideSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
  const { overrideId } = await context.params;
  const { command_id: commandId, ...input } = parsed.data;
  try {
    const data = await executeProductTraderSaleCommand(auth.admin, { orgId: auth.orgId, actorUserId: auth.user.id, requestId: auth.requestId, commandId, action: "price_override_review", payload: { override_id: overrideId, ...input } });
    return NextResponse.json({ data });
  } catch (error) { return productInventoryError(error, "تعذر مراجعة طلب السعر."); }
}
