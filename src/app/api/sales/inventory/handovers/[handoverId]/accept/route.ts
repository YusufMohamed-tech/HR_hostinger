import { NextRequest, NextResponse } from "next/server";
import { productHandoverAcceptSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryCommerceAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ handoverId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryCommerceAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productHandoverAcceptSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات تأكيد الاستلام غير صالحة." },
      { status: 400 }
    );
  }
  const { handoverId } = await context.params;
  const { command_id: commandId, ...input } = parsed.data;
  try {
    const data = await executeProductCommerceCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "handover_accept",
      payload: { handover_id: handoverId, ...input },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تأكيد استلام المنتجات.");
  }
}
