import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

function safeSpreadsheetValue(value: unknown) {
  const text = String(value ?? "").replace(/[\r\n]+/gu, " ").trim();
  const safe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ analysisId: string }> }
) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { analysisId } = await context.params;
  try {
    const db = productInventoryDb(auth.admin);
    const analysisResult = await db.from("product_catalog_import_analyses")
      .select("id")
      .eq("organization_id", auth.orgId)
      .eq("id", analysisId)
      .maybeSingle();
    if (analysisResult.error) throw Object.assign(new Error(analysisResult.error.message), { code: analysisResult.error.code });
    if (!analysisResult.data) return NextResponse.json({ message: "تحليل الكتالوج غير موجود." }, { status: 404 });
    const { data, error } = await db.from("product_catalog_import_rows")
      .select("source_sheet, source_row, normalized_values, classification, errors, warnings")
      .eq("organization_id", auth.orgId)
      .eq("analysis_id", analysisId)
      .in("classification", ["invalid", "duplicate_in_file", "identifier_conflict", "ambiguous"])
      .order("source_row")
      .limit(10_000);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const headers = ["sheet", "row", "product_name", "sku", "barcode", "classification", "errors", "warnings"];
    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const values = (row.normalized_values || {}) as Record<string, unknown>;
      return [
        row.source_sheet,
        row.source_row,
        values.product_name,
        values.sku,
        values.barcode,
        row.classification,
        Array.isArray(row.errors) ? row.errors.join(" | ") : "",
        Array.isArray(row.warnings) ? row.warnings.join(" | ") : "",
      ].map(safeSpreadsheetValue).join(",");
    });
    const content = `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
    return new Response(content, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=product-catalog-rejections-${analysisId}.csv`,
        "cache-control": "private, no-store",
        "x-request-id": auth.requestId,
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر إنشاء تقرير الصفوف المرفوضة.");
  }
}
