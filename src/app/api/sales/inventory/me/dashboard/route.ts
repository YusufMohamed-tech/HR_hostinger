import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAgentAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { loadProductAgentDashboard } from "@/lib/server/product-inventory-commerce";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAgentAccess(request);
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({
      data: await loadProductAgentDashboard(auth.admin, auth.orgId, auth.user.id),
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل عهدة المنتجات للمندوب.");
  }
}
