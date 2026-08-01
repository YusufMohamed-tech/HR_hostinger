import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryCustodianAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { loadProductEmployeeCustodyDashboard } from "@/lib/server/product-inventory-custody";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryCustodianAccess(request);
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({
      data: await loadProductEmployeeCustodyDashboard(auth.admin, auth.orgId, auth.user.id),
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل عهدة المنتجات الخاصة بك.");
  }
}
