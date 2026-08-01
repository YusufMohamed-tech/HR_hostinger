import { NextRequest } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { PRODUCT_INVENTORY_WORKBOOK_HEADERS } from "@/lib/product-inventory/workbook";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_inventory_import_profiles")
      .select("id, version, header_mapping")
      .eq("organization_id", auth.orgId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const mapping = (data?.header_mapping || {}) as Record<string, string>;
    const preferredHeaders = PRODUCT_INVENTORY_WORKBOOK_HEADERS.map((field) =>
      Object.entries(mapping).find(([, canonical]) => canonical === field)?.[0] || field
    );
    const content = `\uFEFF${preferredHeaders.join(",")}\n`;
    return new Response(content, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="product-inventory-import-template-v${data?.version || 1}.csv"`,
        "cache-control": "private, no-store",
        "x-request-id": auth.requestId,
        "x-import-profile-id": data?.id || "canonical",
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر إنشاء قالب الاستيراد النشط.");
  }
}
