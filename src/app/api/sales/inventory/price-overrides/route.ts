import { NextRequest, NextResponse } from "next/server";
import { productPriceOverrideRequestSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryAgentAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryError } from "@/lib/server/product-inventory-api";

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryAgentAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productPriceOverrideRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "طلب استثناء السعر غير صالح." },
      { status: 400 }
    );
  }
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductCommerceCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "price_override_request",
      payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر إرسال طلب استثناء السعر.");
  }
}
