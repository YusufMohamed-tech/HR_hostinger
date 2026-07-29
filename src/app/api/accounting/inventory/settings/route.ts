import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;
  try {
    const db = productInventoryDb(auth.admin);
    const [settingsResult, accountsResult] = await Promise.all([
      db.from("accounting_settings")
        .select("id, version, default_inventory_asset_id, default_inventory_grni_id, default_inventory_cogs_id, default_inventory_shrinkage_id, default_agent_receivable_id, default_accounts_payable_id, default_sales_revenue_id, default_vat_payable_id, default_cash_account_id, default_bank_account_id, default_commission_expense_id, default_commission_payable_id, auto_post_inventory_receipts, auto_post_product_sales, auto_post_product_collections, enable_product_agent_commissions")
        .eq("organization_id", auth.orgId)
        .maybeSingle(),
      db.from("accounting_accounts")
        .select("id, code, name_ar, name_en, type, subtype, normal_balance, is_active")
        .eq("organization_id", auth.orgId)
        .eq("is_active", true)
        .order("code"),
    ]);
    if (settingsResult.error) throw Object.assign(new Error(settingsResult.error.message), { code: settingsResult.error.code });
    if (accountsResult.error) throw Object.assign(new Error(accountsResult.error.message), { code: accountsResult.error.code });
    return NextResponse.json({
      data: {
        settings: settingsResult.data,
        accounts: accountsResult.data || [],
        can_manage: auth.role === "finance_manager",
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل إعدادات محاسبة مخزون المنتجات.");
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "finance_manager") {
    return NextResponse.json({ message: "مدير المالية فقط يمكنه تعديل إعدادات الترحيل." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const { data, error } = await productInventoryDb(auth.admin).rpc(
      "save_product_inventory_accounting_settings",
      {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_request_id: auth.requestId,
        p_expected_version: Number(body.expected_version || 0),
        p_payload: body,
      }
    );
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر حفظ إعدادات محاسبة مخزون المنتجات.");
  }
}
