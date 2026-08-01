import { NextRequest, NextResponse } from "next/server";
import { productCatalogStatusSchema } from "@/lib/product-catalog/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { executeProductCatalogProductCommand, productCatalogEnabled } from "@/lib/server/product-catalog";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { productId } = await context.params;
  const parsed = productCatalogStatusSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "طلب تغيير الحالة غير صالح." },
      { status: 400 }
    );
  }
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const data = await executeProductCatalogProductCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId: parsed.data.command_id,
      action: "set_active",
      payload: {
        product_id: productId,
        expected_version: parsed.data.expected_version,
        is_active: parsed.data.is_active,
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر تغيير حالة المنتج.");
  }
}
