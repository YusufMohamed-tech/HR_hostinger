import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import {
  productInventoryDb,
  productInventoryError,
  productInventoryPage,
  productInventoryPagination,
} from "@/lib/server/product-inventory-api";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ analysisId: string }> }
) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { analysisId } = await context.params;
  const { page, pageSize, from, to } = productInventoryPage(request, {
    defaultPageSize: 100,
    maxPageSize: 200,
  });
  const classification = String(request.nextUrl.searchParams.get("classification") || "").trim();
  try {
    const db = productInventoryDb(auth.admin);
    const analysisResult = await db.from("product_catalog_import_analyses")
      .select("id, company_id, status, source_type, original_filename, selected_sheet, header_row, mapping, confidence, summary, warnings, blocking_errors, algorithm_version, analysis_version, expires_at, committed_at, created_at, company:company_id(id, name, code)")
      .eq("organization_id", auth.orgId)
      .eq("id", analysisId)
      .maybeSingle();
    if (analysisResult.error) throw Object.assign(new Error(analysisResult.error.message), { code: analysisResult.error.code });
    if (!analysisResult.data) return NextResponse.json({ message: "تحليل الكتالوج غير موجود." }, { status: 404 });
    let rowsQuery = db.from("product_catalog_import_rows")
      .select("id, source_sheet, source_row, raw_values, normalized_values, classification, errors, warnings, matched_product_id, matched_inventory_version, suggested_changes", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .eq("analysis_id", analysisId)
      .order("source_row")
      .range(from, to);
    if (classification) rowsQuery = rowsQuery.eq("classification", classification);
    const rowsResult = await rowsQuery;
    if (rowsResult.error) throw Object.assign(new Error(rowsResult.error.message), { code: rowsResult.error.code });
    return NextResponse.json({
      data: {
        analysis: analysisResult.data,
        rows: rowsResult.data ?? [],
        pagination: productInventoryPagination(page, pageSize, rowsResult.count ?? 0),
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل معاينة كتالوج المنتجات.");
  }
}
