import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;

  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_receipts")
      .select("*, company:supplier_company_id(id, name, code, brand_color), warehouse:warehouse_id(id, code, name_ar, name_en, is_default)")
      .eq("organization_id", auth.orgId)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(200);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const receipts = data ?? [];
    const totals = receipts.reduce(
      (value: { units: number; cost: number; expectedSales: number; margin: number }, receipt: Record<string, unknown>) => {
        value.units += Number(receipt.total_units || 0);
        value.cost += Number(receipt.physical_total_cost || 0);
        value.expectedSales += Number(receipt.expected_sales_value || 0);
        value.margin += Number(receipt.expected_margin || 0);
        return value;
      },
      { units: 0, cost: 0, expectedSales: 0, margin: 0 }
    );
    return NextResponse.json({ data: { receipts, totals } });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل القيمة المالية لمخزون المنتجات.");
  }
}
