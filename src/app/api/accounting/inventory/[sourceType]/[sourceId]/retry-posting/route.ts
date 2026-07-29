import { NextRequest, NextResponse } from "next/server";
import {
  retryProductInventoryPosting,
  type ProductInventoryAccountingSource,
} from "@/lib/accounting/product-inventory-posting";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = {
  params: Promise<{ sourceType: string; sourceId: string }>;
};

const sourceTypes = new Set<ProductInventoryAccountingSource>([
  "receipt",
  "sale",
  "collection",
  "loss",
]);

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;
  if (!["finance_manager", "accountant"].includes(auth.role)) {
    return NextResponse.json({ message: "صلاحية محاسب مطلوبة لإعادة محاولة الترحيل." }, { status: 403 });
  }
  const { sourceType, sourceId } = await context.params;
  if (!sourceTypes.has(sourceType as ProductInventoryAccountingSource)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sourceId)) {
    return NextResponse.json({ message: "مصدر المحاسبة غير صالح." }, { status: 400 });
  }
  try {
    const result = await retryProductInventoryPosting(
      auth.admin,
      auth.orgId,
      auth.user.id,
      sourceType as ProductInventoryAccountingSource,
      sourceId
    );
    if (!result.success) {
      return NextResponse.json({ message: result.error || "فشلت إعادة محاولة الترحيل." }, { status: 409 });
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    return productInventoryError(error, "تعذر إعادة محاولة ترحيل حركة المخزون.");
  }
}
