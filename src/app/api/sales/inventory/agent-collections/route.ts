import { NextRequest, NextResponse } from "next/server";
import { agentProductCollectionSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { executeProductCommerceCommand, productInventoryError } from "@/lib/server/product-inventory-api";

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = agentProductCollectionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات التحصيل غير صالحة." },
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
      action: "collection_post",
      payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر تسجيل تحصيل المندوب.");
  }
}
