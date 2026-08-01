import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { productCatalogEnabled } from "@/lib/server/product-catalog";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const bytes = await readFile(path.join(process.cwd(), "public", "templates", "product-catalog-template.xlsx"));
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": "attachment; filename=product-catalog-template.xlsx",
        "cache-control": "private, no-store",
        "x-request-id": auth.requestId,
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل قالب كتالوج المنتجات.");
  }
}
