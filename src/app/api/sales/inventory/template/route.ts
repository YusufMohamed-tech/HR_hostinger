import { NextRequest } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { PRODUCT_INVENTORY_WORKBOOK_HEADERS } from "@/lib/product-inventory/workbook";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const content = `\uFEFF${PRODUCT_INVENTORY_WORKBOOK_HEADERS.join(",")}\n`;
  return new Response(content, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="product-inventory-import-template.csv"',
      "cache-control": "private, no-store",
      "x-request-id": auth.requestId,
    },
  });
}
