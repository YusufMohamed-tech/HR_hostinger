import { NextRequest, NextResponse } from "next/server";
import { agentProductSaleVoidSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ saleId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = agentProductSaleVoidSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات إلغاء البيع غير صالحة." },
      { status: 400 }
    );
  }
  const { saleId } = await context.params;
  const { command_id: commandId, ...input } = parsed.data;
  try {
    const data = await executeProductCommerceCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "sale_void",
      payload: { sale_id: saleId, ...input },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر إلغاء بيع المنتج.");
  }
}
