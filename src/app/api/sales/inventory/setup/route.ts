import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;

  const db = productInventoryDb(auth.admin);
  try {
    const [companies, warehouses, products] = await Promise.all([
      db.from("sales_companies")
        .select("id, name, code, brand_color")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .order("name"),
      db.from("inventory_warehouses")
        .select("id, code, name_ar, name_en, is_default")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .order("is_default", { ascending: false }),
      db.from("sales_products")
        .select("id, company_id, name, sku, model, price, default_cost")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .eq("inventory_enabled", true)
        .eq("tracking_mode", "serialized")
        .order("name"),
    ]);
    const error = companies.error || warehouses.error || products.error;
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({
      data: {
        companies: companies.data ?? [],
        warehouses: warehouses.data ?? [],
        products: products.data ?? [],
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل إعدادات استلام المنتجات.");
  }
}
