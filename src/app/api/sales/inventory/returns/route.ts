import { NextRequest, NextResponse } from "next/server";
import { productAgentReturnSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryCommerceAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryError } from "@/lib/server/product-inventory-api";

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryCommerceAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productAgentReturnSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات مرتجع المندوب غير صالحة." },
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
      action: "agent_return",
      payload,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر إرجاع المنتجات إلى المخزن.");
  }
}
