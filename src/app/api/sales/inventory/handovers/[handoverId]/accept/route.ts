import { NextRequest, NextResponse } from "next/server";
import { productHandoverAcceptSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryCommerceAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

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
  const { command_id: commandId, signature_data: signatureData, ...input } = parsed.data;
  try {
    const data = await executeProductCommerceCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "handover_accept",
      payload: { handover_id: handoverId, ...input },
    });

    const db = productInventoryDb(auth.admin);
    await db.from("product_handover_signatures").insert({
      handover_id: handoverId,
      agent_user_id: auth.user.id,
      organization_id: auth.orgId,
      signature_data: signatureData,
      signed_at: new Date().toISOString(),
    });

    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تأكيد استلام المنتجات.");
  }
}
