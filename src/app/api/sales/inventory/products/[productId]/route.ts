import { NextRequest, NextResponse } from "next/server";
import { productCatalogUpdateSchema } from "@/lib/product-catalog/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductCatalogProductCommand, productCatalogEnabled } from "@/lib/server/product-catalog";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { productId } = await context.params;
  const parsed = productCatalogUpdateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات المنتج غير صالحة." },
      { status: 400 }
    );
  }
  const { command_id: commandId, expected_version: expectedVersion, ...values } = parsed.data;
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const data = await executeProductCatalogProductCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "update",
      payload: { ...values, product_id: productId, expected_version: expectedVersion } as typeof values,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تحديث المنتج.");
  }
}
