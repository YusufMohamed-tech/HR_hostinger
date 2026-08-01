import { NextRequest, NextResponse } from "next/server";
import { productCatalogImportCommitSchema } from "@/lib/product-catalog/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";
import { productCatalogEnabled } from "@/lib/server/product-catalog";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ analysisId: string }> }
) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const { analysisId } = await context.params;
  const parsed = productCatalogImportCommitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: "بيانات اعتماد كتالوج المنتجات غير صالحة." }, { status: 400 });
  }
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const { data, error } = await productInventoryDb(auth.admin).rpc(
      "commit_product_catalog_import_v1",
      {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_request_id: auth.requestId,
        p_command_id: parsed.data.command_id,
        p_analysis_id: analysisId,
        p_analysis_version: parsed.data.analysis_version,
        p_apply_updates: parsed.data.apply_updates,
      }
    );
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر اعتماد كتالوج المنتجات.");
  }
}
