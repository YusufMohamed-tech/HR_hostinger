import { NextRequest, NextResponse } from "next/server";
import { productHandoverSchema } from "@/lib/product-inventory/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import {
  executeProductCommerceCommand,
  productInventoryError,
  productInventoryPage,
} from "@/lib/server/product-inventory-api";
import { loadProductCommerceManagerData } from "@/lib/server/product-inventory-commerce";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const paging = productInventoryPage(request, { defaultPageSize: 200, maxPageSize: 200 });
    const search = (request.nextUrl.searchParams.get("search") || "").trim().slice(0, 160);
    return NextResponse.json({
      data: await loadProductCommerceManagerData(auth.admin, auth.orgId, {
        page: paging.page,
        pageSize: paging.pageSize,
        search,
      }),
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل حركة تسليم المنتجات.");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productHandoverSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات التسليم غير صالحة." },
      { status: 400 }
    );
  }
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    const data = await executeProductCommerceCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "handover_issue",
      payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر تسليم المنتجات للمندوب.");
  }
}
