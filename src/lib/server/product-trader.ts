import type { createAdminClient } from "@/lib/supabase/admin";
import { productInventoryDb } from "@/lib/server/product-inventory-api";
import type {
  ProductTraderHandover,
  ProductTraderHandoverLine,
  ProductTraderMerchant,
  ProductTraderUnit,
  ProductTraderWorkspace,
} from "@/types/product-trader";

type AdminClient = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

function fail(error: { message?: string; code?: string } | null) {
  if (error) throw Object.assign(new Error(error.message || "Trader product query failed."), { code: error.code });
}

function rows<T>(value: unknown) {
  return (Array.isArray(value) ? value : []) as T[];
}

const unitSelect = "id, product_id, raw_serial_number, status, condition, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, currency, current_agent_id, current_merchant_id, product:product_id(id, name, sku, model)";
const handoverSelect = "id, handover_no, source_agent_id, merchant_id, status, require_acknowledgment, expires_at, issued_at, accepted_at, rejected_at, rejection_reason, notes, version, merchant:merchant_id(id, business_name, owner_name), source_agent:source_agent_id(id, agent_code, employee:employee_id(full_name))";
const lineSelect = "id, handover_id, unit_id, product_id, serial_snapshot, product_name_snapshot, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, currency, line_status, accepted_condition, accepted_at, closed_at";

async function settings(admin: AdminClient, orgId: string) {
  const result = await productInventoryDb(admin).from("product_inventory_commerce_settings")
    .select("product_trader_distribution_enabled, require_trader_handover_acknowledgment, require_trader_signature, max_trader_handover_units")
    .eq("organization_id", orgId).maybeSingle();
  fail(result.error);
  const value = (result.data || {}) as Row;
  return {
    enabled: value.product_trader_distribution_enabled === true,
    require_acknowledgment: value.require_trader_handover_acknowledgment !== false,
    require_signature: value.require_trader_signature === true,
    max_handover_units: Number(value.max_trader_handover_units || 100),
  };
}

function joinHandovers(handovers: ProductTraderHandover[], lines: ProductTraderHandoverLine[]) {
  return handovers.map((handover) => ({
    ...handover,
    lines: lines.filter((line) => line.handover_id === handover.id),
  }));
}

export async function executeProductTraderCommand(admin: AdminClient, input: {
  orgId: string; actorUserId: string; requestId: string; commandId: string;
  action: "trader_handover_issue" | "trader_handover_accept" | "trader_handover_reject" | "trader_handover_cancel";
  payload: Record<string, unknown>;
}) {
  const result = await productInventoryDb(admin).rpc("execute_product_trader_custody_command", {
    p_org_id: input.orgId,
    p_actor_user_id: input.actorUserId,
    p_request_id: input.requestId,
    p_command_id: input.commandId,
    p_action: input.action,
    p_payload: input.payload,
  });
  fail(result.error);
  return result.data;
}

export async function loadAgentProductTraderWorkspace(admin: AdminClient, orgId: string, userId: string): Promise<ProductTraderWorkspace> {
  const db = productInventoryDb(admin);
  const agentResult = await db.from("field_agents").select("id, agent_code, employee:employee_id(full_name)")
    .eq("organization_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle();
  fail(agentResult.error);
  if (!agentResult.data) throw Object.assign(new Error("لا يوجد ملف مندوب ميداني نشط مرتبط بالحساب."), { code: "P0002" });
  const agent = agentResult.data as Row;
  const agentId = String(agent.id);
  const [setting, merchantsResult, unitsResult, handoversResult, linesResult] = await Promise.all([
    settings(admin, orgId),
    db.from("merchants").select("id, business_name, owner_name, phone, city, agent_id")
      .eq("organization_id", orgId).eq("agent_id", agentId).eq("status", "active").order("business_name"),
    db.from("product_inventory_units").select(unitSelect).eq("organization_id", orgId)
      .eq("current_agent_id", agentId).in("status", ["with_agent", "merchant_in_transit"])
      .order("assigned_at", { ascending: false }).limit(2000),
    db.from("product_trader_handovers").select(handoverSelect).eq("organization_id", orgId)
      .eq("source_agent_id", agentId).order("issued_at", { ascending: false }).limit(500),
    db.from("product_trader_handover_lines").select(lineSelect).eq("organization_id", orgId)
      .order("created_at", { ascending: false }).limit(5000),
  ]);
  [merchantsResult, unitsResult, handoversResult, linesResult].forEach((result) => fail(result.error));
  const employee = agent.employee as { full_name?: string } | null;
  return {
    ...setting,
    identity: { id: agentId, name: employee?.full_name || String(agent.agent_code || "مندوب"), kind: "agent" },
    merchants: rows<ProductTraderMerchant>(merchantsResult.data),
    available_units: rows<ProductTraderUnit>(unitsResult.data).filter((unit) => unit.status === "with_agent"),
    held_units: [],
    handovers: joinHandovers(rows<ProductTraderHandover>(handoversResult.data), rows<ProductTraderHandoverLine>(linesResult.data)),
  };
}

export async function loadMerchantProductTraderWorkspace(admin: AdminClient, orgId: string, userId: string): Promise<ProductTraderWorkspace> {
  const db = productInventoryDb(admin);
  const merchantResult = await db.from("merchants").select("id, business_name, owner_name, phone, city, agent_id")
    .eq("organization_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle();
  fail(merchantResult.error);
  if (!merchantResult.data) throw Object.assign(new Error("لا يوجد ملف تاجر نشط مرتبط بالحساب."), { code: "P0002" });
  const merchant = merchantResult.data as ProductTraderMerchant;
  const [setting, unitsResult, handoversResult, linesResult] = await Promise.all([
    settings(admin, orgId),
    db.from("product_inventory_units").select(unitSelect).eq("organization_id", orgId)
      .eq("current_merchant_id", merchant.id).in("status", ["merchant_in_transit", "with_merchant"])
      .order("merchant_assigned_at", { ascending: false }).limit(2000),
    db.from("product_trader_handovers").select(handoverSelect).eq("organization_id", orgId)
      .eq("merchant_id", merchant.id).order("issued_at", { ascending: false }).limit(500),
    db.from("product_trader_handover_lines").select(lineSelect).eq("organization_id", orgId)
      .order("created_at", { ascending: false }).limit(5000),
  ]);
  [unitsResult, handoversResult, linesResult].forEach((result) => fail(result.error));
  return {
    ...setting,
    identity: { id: merchant.id, name: merchant.business_name, kind: "merchant" },
    merchants: [merchant],
    available_units: [],
    held_units: rows<ProductTraderUnit>(unitsResult.data),
    handovers: joinHandovers(rows<ProductTraderHandover>(handoversResult.data), rows<ProductTraderHandoverLine>(linesResult.data)),
  };
}
