import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { productCatalogEnabled } from "@/lib/server/product-catalog";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const [enabled, companies, accounts] = await Promise.all([
      productCatalogEnabled(auth.admin, auth.orgId),
      productInventoryDb(auth.admin).from("sales_companies")
        .select("id, name, code")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .order("name"),
      productInventoryDb(auth.admin).from("accounting_accounts")
        .select("id, code, name_ar, name_en")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .eq("type", "revenue")
        .order("code"),
    ]);
    const error = companies.error || accounts.error;
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({
      data: {
        enabled,
        companies: companies.data ?? [],
        revenue_accounts: accounts.data ?? [],
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل خيارات كتالوج المنتجات.");
  }
}
