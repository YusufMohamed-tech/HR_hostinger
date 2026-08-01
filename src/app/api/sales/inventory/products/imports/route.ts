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
  const { page, pageSize, from, to } = productInventoryPage(request, {
    defaultPageSize: 10,
    maxPageSize: 50,
  });
  try {
    const { data, error, count } = await productInventoryDb(auth.admin)
      .from("product_catalog_import_analyses")
      .select("id, company_id, status, source_type, original_filename, selected_sheet, header_row, confidence, summary, analysis_version, expires_at, committed_at, created_at, company:company_id(id, name, code)", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({
      data: {
        rows: data ?? [],
        pagination: productInventoryPagination(page, pageSize, count ?? 0),
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل سجل استيراد المنتجات.");
  }
}
