import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import {
  productInventoryDb,
  productInventoryError,
  productInventoryPage,
  productInventoryPagination,
} from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;

  try {
    const paging = productInventoryPage(request, { defaultPageSize: 20, maxPageSize: 200 });
    const db = productInventoryDb(auth.admin);
    const [rowsResult, summaryResult] = await Promise.all([
      db
      .from("product_inventory_units")
      .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en), agent:current_agent_id(full_name)", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(paging.from, paging.to),
      db.rpc("get_product_inventory_stock_summary", { p_org_id: auth.orgId }),
    ]);
    const queryError = rowsResult.error || summaryResult.error;
    if (queryError) {
      throw Object.assign(new Error(queryError.message), { code: queryError.code });
    }
    return NextResponse.json({
      data: {
        rows: rowsResult.data ?? [],
        totals: summaryResult.data,
        pagination: productInventoryPagination(
          paging.page,
          paging.pageSize,
          rowsResult.count ?? 0
        ),
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل مخزون المنتجات.");
  }
}
