import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import {
  productInventoryDb,
  productInventoryError,
  productInventoryPage,
  productInventoryPagination,
} from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const paging = productInventoryPage(request, { defaultPageSize: 50, maxPageSize: 200 });
    const { data, error, count } = await productInventoryDb(auth.admin)
      .from("product_inventory_movements")
      .select("id, unit_id, movement_type, from_warehouse_id, to_warehouse_id, from_agent_id, to_agent_id, handover_id, sale_id, reason, movement_at, metadata, unit:unit_id(raw_serial_number, product:product_id(name, sku)), from_agent:from_agent_id(full_name), to_agent:to_agent_id(full_name), from_warehouse:from_warehouse_id(name_ar), to_warehouse:to_warehouse_id(name_ar)", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .order("movement_at", { ascending: false })
      .order("id", { ascending: false })
      .range(paging.from, paging.to);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({
      data: {
        rows: data || [],
        pagination: productInventoryPagination(
          paging.page,
          paging.pageSize,
          count ?? 0
        ),
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل سجل حركة المنتجات.");
  }
}
