import { NextRequest, NextResponse } from "next/server";
import { productReturnReviewSchema } from "@/lib/product-inventory/schemas";
import { executeProductReturnCommand, productInventoryError } from "@/lib/server/product-inventory-api";
import { requireProductInventoryReturnAccess } from "@/lib/server/product-inventory-auth";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryReturnAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productReturnReviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات اعتماد المرتجع غير صالحة." },
      { status: 400 }
    );
  }
  const { requestId } = await context.params;
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductReturnCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "return_request_review",
      payload: { return_request_id: requestId, ...payload },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر اعتماد طلب المرتجع.");
  }
}
