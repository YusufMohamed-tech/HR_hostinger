import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { loadProductTraderFinanceWorkspace } from "@/lib/server/product-trader";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try { return NextResponse.json({ data: await loadProductTraderFinanceWorkspace(auth.admin, auth.orgId) }); }
  catch (error) { return productInventoryError(error, "تعذر تحميل مبيعات واستثناءات أسعار التجار."); }
}
