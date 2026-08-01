import { NextRequest } from "next/server";
import { downloadObject } from "@/lib/server/file-storage";
import { productInventoryError } from "@/lib/server/product-inventory-api";
import { requireProductInventoryReturnAccess } from "@/lib/server/product-inventory-auth";
import { loadProductReturnAttachment } from "@/lib/server/product-inventory-returns";

type RouteContext = { params: Promise<{ requestId: string; attachmentId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryReturnAccess(request);
  if ("error" in auth) return auth.error;
  const { requestId, attachmentId } = await context.params;
  try {
    const file = await loadProductReturnAttachment(auth.admin, {
      orgId: auth.orgId,
      userId: auth.user.id,
      role: auth.role,
      requestId,
      attachmentId,
    });
    const data = await downloadObject(auth.admin, file.bucket, file.path);
    return new Response(data, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-return-request-id": requestId,
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر فتح صورة المرتجع.");
  }
}
