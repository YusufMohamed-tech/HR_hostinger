import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;

  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_inventory_units")
      .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en), agent:current_agent_id(full_name)")
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const rows = data ?? [];
    const totals = rows.reduce(
      (value: { units: number; cost: number; expectedSales: number; margin: number }, row: Record<string, unknown>) => {
        value.units += 1;
        value.cost += Number(row.unit_cost_snapshot || 0);
        value.expectedSales += Number(row.planned_sale_price_snapshot || 0);
        value.margin += Number(row.planned_sale_price_snapshot || 0) - Number(row.unit_cost_snapshot || 0);
        return value;
      },
      { units: 0, cost: 0, expectedSales: 0, margin: 0 }
    );
    return NextResponse.json({ data: { rows, totals } });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل مخزون المنتجات.");
  }
}
