import { NextRequest, NextResponse } from "next/server";
import { productEmployeeHandoverAcceptSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryCustodianAccess } from "@/lib/server/product-inventory-auth";
import {
  executeProductEmployeeCustodyCommand,
  productInventoryError,
} from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ handoverId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryCustodianAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productEmployeeHandoverAcceptSchema.safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات تأكيد الاستلام غير صالحة." },
      { status: 400 }
    );
  }
  const { handoverId } = await context.params;
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductEmployeeCustodyCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "employee_handover_accept",
      payload: { handover_id: handoverId, ...payload },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تأكيد استلام عهدة الموظف.");
  }
}
