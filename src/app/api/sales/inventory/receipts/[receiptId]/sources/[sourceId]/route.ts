import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { createObjectAccessUrl } from "@/lib/server/file-storage";

type RouteContext = { params: Promise<{ receiptId: string; sourceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;
  const { receiptId, sourceId } = await context.params;
  try {
    const { data, error } = await productInventoryDb(auth.admin)
      .from("product_receipt_sources")
      .select("storage_path, original_name, managed_file_id")
      .eq("organization_id", auth.orgId)
      .eq("receipt_id", receiptId)
      .eq("id", sourceId)
      .maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!data?.storage_path) return NextResponse.json({ message: "ملف المصدر غير موجود." }, { status: 404 });
    const managed = data.managed_file_id
      ? await productInventoryDb(auth.admin).from("managed_files")
        .select("bucket_id")
        .eq("org_id", auth.orgId)
        .eq("id", data.managed_file_id)
        .maybeSingle()
      : null;
    if (managed?.error) throw Object.assign(new Error(managed.error.message), { code: managed.error.code });
    const bucket = String(managed?.data?.bucket_id || "");
    if (!["product-inventory-imports", "product-inventory-photos"].includes(bucket)) {
      return NextResponse.json({ message: "مصدر الاستلام غير مسجل كملف خاص." }, { status: 404 });
    }
    const signedUrl = createObjectAccessUrl(bucket, String(data.storage_path), {
      expiresIn: 600,
      downloadName: typeof data.original_name === "string" ? data.original_name : null,
    });
    return NextResponse.json({
      data: { signed_url: signedUrl, original_name: data.original_name },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return productInventoryError(error, "تعذر فتح ملف المصدر.");
  }
}
