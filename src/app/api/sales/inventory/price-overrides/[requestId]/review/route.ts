import { NextRequest, NextResponse } from "next/server";
import { productPriceOverrideReviewSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productPriceOverrideReviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "مراجعة استثناء السعر غير صالحة." },
      { status: 400 }
    );
  }
  const { requestId } = await context.params;
  const { command_id: commandId, ...input } = parsed.data;
  try {
    const data = await executeProductCommerceCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "price_override_review",
      payload: { request_id: requestId, ...input },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر مراجعة طلب استثناء السعر.");
  }
}
