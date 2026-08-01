import { NextRequest, NextResponse } from "next/server";
import { productCatalogCreateSchema } from "@/lib/product-catalog/schemas";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import {
  productInventoryDb,
  productInventoryError,
  productInventoryPage,
  productInventoryPagination,
} from "@/lib/server/product-inventory-api";
import {
  executeProductCatalogProductCommand,
  productCatalogEnabled,
} from "@/lib/server/product-catalog";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const { page, pageSize, from, to } = productInventoryPage(request, {
      defaultPageSize: 25,
      maxPageSize: 100,
    });
    const search = String(request.nextUrl.searchParams.get("q") || "").trim();
    const companyId = String(request.nextUrl.searchParams.get("company_id") || "").trim();
    const status = String(request.nextUrl.searchParams.get("status") || "active").trim();
    let query = productInventoryDb(auth.admin)
      .from("sales_products")
      .select("id, organization_id, company_id, name, description, unit, category, price, is_active, sku, barcode, model, inventory_enabled, tracking_mode, default_cost, revenue_account_id, agent_commission_type, agent_commission_value, inventory_version, created_at, updated_at, company:company_id(id, name, code)", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .eq("inventory_enabled", true)
      .eq("tracking_mode", "serialized")
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (companyId) query = query.eq("company_id", companyId);
    if (status === "active") query = query.eq("is_active", true);
    if (status === "inactive") query = query.eq("is_active", false);
    if (search) {
      const safe = search.replace(/[%_,()]/gu, " ").trim();
      if (safe) query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,barcode.ilike.%${safe}%,model.ilike.%${safe}%`);
    }
    const { data, error, count } = await query;
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({
      data: {
        rows: data ?? [],
        pagination: productInventoryPagination(page, pageSize, count ?? 0),
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل كتالوج المنتجات.");
  }
}
export async function POST(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = productCatalogCreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "بيانات المنتج غير صالحة." },
      { status: 400 }
    );
  }
  const { command_id: commandId, ...payload } = parsed.data;
  try {
    if (!(await productCatalogEnabled(auth.admin, auth.orgId))) {
      return NextResponse.json({ message: "كتالوج المنتجات متوقف مؤقتًا." }, { status: 503 });
    }
    const data = await executeProductCatalogProductCommand(auth.admin, {
      orgId: auth.orgId,
      actorUserId: auth.user.id,
      requestId: auth.requestId,
      commandId,
      action: "create",
      payload,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return productInventoryError(error, "تعذر إضافة المنتج.");
  }
}
