import { NextRequest, NextResponse } from "next/server";
import { manualReceiptSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryAccess } from "@/lib/server/product-inventory-auth";
import {
  executeReceiptCommand,
  productInventoryDb,
  productInventoryError,
  productInventoryPage,
  productInventoryPagination,
} from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;

  try {
    const paging = productInventoryPage(request, { defaultPageSize: 20, maxPageSize: 100 });
    const { data, error, count } = await productInventoryDb(auth.admin)
      .from("product_receipts")
      .select("*, company:supplier_company_id(id, name, code, brand_color), warehouse:warehouse_id(id, code, name_ar, name_en, is_default)", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(paging.from, paging.to);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({
      data: {
        rows: data ?? [],
        pagination: productInventoryPagination(
          paging.page,
          paging.pageSize,
          count ?? 0
        ),
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل سندات استلام المنتجات.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryAccess(request);
  if ("error" in auth) return auth.error;

  const parsed = manualReceiptSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات الاستلام غير صالحة." },
      { status: 400 }
    );
  }

  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const receipt = await executeReceiptCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "receipt_draft_save",
      payload,
    });
    return NextResponse.json({ data: receipt });
  } catch (error) {
    return productInventoryError(error);
  }
}
