import { NextRequest, NextResponse } from "next/server";
import { productEmployeeHandoverSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryHandoverAccess } from "@/lib/server/product-inventory-auth";
import {
  executeProductEmployeeCustodyCommand,
  productInventoryError,
} from "@/lib/server/product-inventory-api";
import { loadProductEmployeeCustodyManagerData } from "@/lib/server/product-inventory-custody";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryHandoverAccess(request);
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({
      data: await loadProductEmployeeCustodyManagerData(auth.admin, auth.orgId),
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل تسليمات عهدة الموظفين.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryHandoverAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productEmployeeHandoverSchema.safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات تسليم العهدة غير صالحة." },
      { status: 400 }
    );
  }
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductEmployeeCustodyCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "employee_handover_issue",
      payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر إصدار تسليم عهدة الموظف.");
  }
}
