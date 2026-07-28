import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ receiptId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId } = await context.params;

  try {
    const db = productInventoryDb(auth.admin);
    const [receiptResult, linesResult, candidatesResult, sourcesResult] = await Promise.all([
      db.from("product_receipts")
        .select("*, company:supplier_company_id(id, name, code, brand_color), warehouse:warehouse_id(id, code, name_ar, name_en, is_default)")
        .eq("organization_id", auth.orgId)
        .eq("id", receiptId)
        .maybeSingle(),
      db.from("product_receipt_lines")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .order("line_no"),
      db.from("product_receipt_candidates")
        .select("receipt_line_id, raw_serial")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .eq("resolution_status", "accepted")
        .order("created_at"),
      db.from("product_receipt_sources")
        .select("id, source_type, original_name, extraction_status, total_rows, valid_rows, warning_rows, invalid_rows, duplicate_rows, unmatched_rows, committed_at, created_at")
        .eq("organization_id", auth.orgId)
        .eq("receipt_id", receiptId)
        .order("created_at"),
    ]);
    const error = receiptResult.error || linesResult.error || candidatesResult.error || sourcesResult.error;
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!receiptResult.data) return NextResponse.json({ message: "سند الاستلام غير موجود." }, { status: 404 });

    const serialsByLine = new Map<string, string[]>();
    for (const candidate of candidatesResult.data ?? []) {
      const current = serialsByLine.get(String(candidate.receipt_line_id)) ?? [];
      current.push(String(candidate.raw_serial));
      serialsByLine.set(String(candidate.receipt_line_id), current);
    }
    return NextResponse.json({
      data: {
        ...receiptResult.data,
        lines: (linesResult.data ?? []).map((line: Record<string, unknown>) => ({
          ...line,
          serial_numbers: serialsByLine.get(String(line.id)) ?? [],
        })),
        sources: sourcesResult.data ?? [],
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل تفاصيل سند الاستلام.");
  }
}
