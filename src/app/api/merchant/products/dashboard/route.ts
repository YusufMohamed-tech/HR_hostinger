import { NextRequest, NextResponse } from "next/server";
import { requireProductTraderParticipantAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { loadMerchantProductTraderWorkspace } from "@/lib/server/product-trader";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireProductTraderParticipantAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "merchant") {
    return NextResponse.json({ message: "هذه الشاشة متاحة للتاجر فقط." }, { status: 403 });
  }
  try {
    return NextResponse.json({ data: await loadMerchantProductTraderWorkspace(auth.admin, auth.orgId, auth.user.id) });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل منتجات التاجر.");
  }
}
