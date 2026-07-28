import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ receiptId: string; sourceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId, sourceId } = await context.params;
  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_receipt_sources")
      .select("storage_path, original_name")
      .eq("organization_id", auth.orgId)
      .eq("receipt_id", receiptId)
      .eq("id", sourceId)
      .maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!data?.storage_path) return NextResponse.json({ message: "ملف المصدر غير موجود." }, { status: 404 });
    const signed = await auth.admin.storage.from("product-inventory-imports")
      .createSignedUrl(String(data.storage_path), 600);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message || "تعذر إنشاء رابط الملف.");
    }
    return NextResponse.json({
      data: { signed_url: signed.data.signedUrl, original_name: data.original_name },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return productInventoryError(error, "تعذر فتح ملف المصدر.");
  }
}
