import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

type RouteContext = { params: Promise<{ commissionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "finance_manager") {
    return NextResponse.json({ message: "مدير المالية فقط يمكنه سداد العمولات." }, { status: 403 });
  }
  const { commissionId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const paymentMethod = String(body.payment_method || "");
  if (!["cash", "bank_transfer"].includes(paymentMethod)) {
    return NextResponse.json({ message: "طريقة سداد العمولة غير صالحة." }, { status: 400 });
  }
  try {
    const { data, error } = await productInventoryDb(auth.admin).rpc(
      "settle_product_agent_commission",
      {
        p_org_id: auth.orgId,
        p_actor_user_id: auth.user.id,
        p_command_id: String(body.command_id || randomUUID()),
        p_request_id: auth.requestId,
        p_commission_id: commissionId,
        p_payment_date: body.payment_date || null,
        p_account_id: body.account_id || null,
        p_payment_method: paymentMethod,
        p_payment_reference: String(body.payment_reference || "") || null,
        p_finance_notes: String(body.finance_notes || "") || null,
      }
    );
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return NextResponse.json({ data });
  } catch (error) {
    return productInventoryError(error, "تعذر سداد عمولة مندوب المنتجات.");
  }
}
