import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProductInventoryManagerAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

const settingColumns = "product_trader_distribution_enabled,require_trader_handover_acknowledgment,require_trader_signature,net_product_commission_at_settlement,max_trader_handover_units,trader_handover_expiry_hours";
const defaults = {
  product_trader_distribution_enabled: false,
  require_trader_handover_acknowledgment: true,
  require_trader_signature: true,
  net_product_commission_at_settlement: false,
  max_trader_handover_units: 100,
  trader_handover_expiry_hours: 48,
};
const schema = z.object({
  product_trader_distribution_enabled: z.boolean(),
  require_trader_handover_acknowledgment: z.boolean(),
  require_trader_signature: z.boolean(),
  net_product_commission_at_settlement: z.boolean(),
  max_trader_handover_units: z.number().int().min(1).max(500),
  trader_handover_expiry_hours: z.number().int().min(1).max(720),
}).superRefine((value, context) => {
  if (value.require_trader_signature && !value.require_trader_handover_acknowledgment) {
    context.addIssue({ code: "custom", path: ["require_trader_signature"], message: "التوقيع يتطلب تفعيل تأكيد استلام التاجر." });
  }
});

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const result = await productInventoryDb(auth.admin).from("product_inventory_commerce_settings")
    .select(settingColumns).eq("organization_id", auth.orgId).maybeSingle();
  if (result.error) return productInventoryError(result.error);
  return NextResponse.json({ data: result.data || defaults });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireProductInventoryManagerAccess(request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const database = productInventoryDb(auth.admin);
    const result = await database.from("product_inventory_commerce_settings")
      .upsert({ organization_id: auth.orgId, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "organization_id" })
      .select(settingColumns).single();
    if (result.error) throw result.error;
    const audit = await database.from("operational_audit_logs").insert({
      org_id: auth.orgId, request_id: auth.requestId, actor_user_id: auth.user.id,
      actor_role: auth.role, action: "product_inventory.trader_settings_updated",
      target_type: "product_inventory_commerce_settings", target_id: auth.orgId,
      outcome: "success", status_code: 200, metadata: parsed.data,
    });
    if (audit.error) throw audit.error;
    return NextResponse.json({ data: result.data });
  } catch (error) {
    return productInventoryError(error, "تعذر حفظ إعدادات توزيع منتجات التجار.");
  }
}
