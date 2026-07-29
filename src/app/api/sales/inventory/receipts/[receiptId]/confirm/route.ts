import { NextRequest, NextResponse } from "next/server";
import { receiptTransitionSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { executeReceiptCommand, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ receiptId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = receiptTransitionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "بيانات التأكيد غير صالحة." }, { status: 400 });
  }
  const { receiptId } = await context.params;
  try {
    const receipt = await executeReceiptCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId: parsed.data.command_id,
      action: "receipt_confirm",
      payload: { receipt_id: receiptId, expected_version: parsed.data.expected_version },
    });
    return NextResponse.json({ data: receipt });
  } catch (error) {
    return productInventoryError(error);
  }
}
