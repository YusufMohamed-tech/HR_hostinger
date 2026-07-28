import type { createAdminClient } from "@/lib/supabase/admin";
import { productInventoryDb } from "@/lib/server/product-inventory-api";
import type {
  AgentProductCollection,
  AgentProductSale,
  ProductAgentDashboardData,
  ProductCommerceManagerData,
  ProductHandover,
  ProductHandoverLine,
  ProductInventoryFieldAgent,
  ProductInventoryStockRow,
  ProductInventoryWarehouse,
  ProductPriceOverrideRequest,
} from "@/types/product-inventory";

type AdminClient = ReturnType<typeof createAdminClient>;
type UnknownRow = Record<string, unknown>;

function fail(error: { message?: string; code?: string } | null) {
  if (error) throw Object.assign(new Error(error.message || "Inventory query failed."), { code: error.code });
}

function rows<T>(value: unknown) {
  return (Array.isArray(value) ? value : []) as T[];
}

function amount(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function attachByParent<T extends UnknownRow>(
  parents: T[],
  children: UnknownRow[],
  parentKey: string,
  relation: string
) {
  const grouped = new Map<string, UnknownRow[]>();
  for (const child of children) {
    const key = String(child[parentKey] || "");
    grouped.set(key, [...(grouped.get(key) || []), child]);
  }
  return parents.map((parent) => ({ ...parent, [relation]: grouped.get(String(parent.id)) || [] }));
}

export async function resolveProductFieldAgent(
  admin: AdminClient,
  orgId: string,
  userId: string
) {
  const { data, error } = await productInventoryDb(admin)
    .from("field_agents")
    .select("id, user_id, full_name, phone, region, status")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  fail(error);
  if (!data) throw Object.assign(new Error("لا يوجد ملف مندوب ميداني نشط مرتبط بهذا الحساب."), { code: "P0002" });
  return data as ProductInventoryFieldAgent;
}

async function commerceSettings(admin: AdminClient, orgId: string) {
  const { data, error } = await productInventoryDb(admin)
    .from("product_inventory_commerce_settings")
    .select("require_agent_acknowledgment, default_price_tolerance_percent, max_handover_units")
    .eq("organization_id", orgId)
    .maybeSingle();
  fail(error);
  return {
    require_agent_acknowledgment: data?.require_agent_acknowledgment !== false,
    default_price_tolerance_percent: amount(data?.default_price_tolerance_percent || 10),
    max_handover_units: Number(data?.max_handover_units || 200),
  };
}

export async function loadProductCommerceManagerData(
  admin: AdminClient,
  orgId: string
): Promise<ProductCommerceManagerData> {
  const db = productInventoryDb(admin);
  const [
    settings,
    agentsResult,
    warehousesResult,
    unitsResult,
    handoversResult,
    handoverLinesResult,
    salesResult,
    saleLinesResult,
    collectionsResult,
    overridesResult,
  ] = await Promise.all([
    commerceSettings(admin, orgId),
    db.from("field_agents")
      .select("id, user_id, full_name, phone, region, status")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .order("full_name"),
    db.from("inventory_warehouses")
      .select("id, code, name_ar, name_en, is_default")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("name_ar"),
    db.from("product_inventory_units")
      .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en), agent:current_agent_id(full_name)")
      .eq("organization_id", orgId)
      .in("status", ["in_stock", "in_transit", "with_agent"])
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("product_handovers")
      .select("id, handover_no, warehouse_id, agent_id, status, require_acknowledgment, notes, issued_at, accepted_at, completed_at, version, agent:agent_id(id, user_id, full_name, phone, region, status), warehouse:warehouse_id(id, code, name_ar, name_en, is_default)")
      .eq("organization_id", orgId)
      .order("issued_at", { ascending: false })
      .limit(250),
    db.from("product_handover_lines")
      .select("id, handover_id, unit_id, product_id, planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price, currency, tax_included, line_status, unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model))")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(2000),
    db.from("agent_product_sales")
      .select("id, sale_no, agent_id, sale_date, customer_name, customer_phone, customer_reference, payment_method, subtotal, vat_amount, total_amount, status, accounting_status, version, created_at, voided_at, void_reason, return_disposition, agent:agent_id(id, user_id, full_name, phone, region, status)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("agent_product_sale_lines")
      .select("id, sale_id, unit_id, handover_id, serial_snapshot, product_name_snapshot, unit_cost_snapshot, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, actual_sale_price, net_amount, vat_amount, total_amount, gross_profit, currency, agent_commission_amount, price_override_request_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("agent_product_collections")
      .select("id, collection_no, agent_id, amount, payment_method, reference, collection_date, notes, status, accounting_status, version, created_at, agent:agent_id(id, user_id, full_name, phone, region, status)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("product_price_override_requests")
      .select("id, unit_id, handover_id, agent_id, requested_price, currency, reason, status, requested_at, review_note, version, agent:agent_id(id, user_id, full_name, phone, region, status), unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model))")
      .eq("organization_id", orgId)
      .order("requested_at", { ascending: false })
      .limit(500),
  ]);

  [
    agentsResult,
    warehousesResult,
    unitsResult,
    handoversResult,
    handoverLinesResult,
    salesResult,
    saleLinesResult,
    collectionsResult,
    overridesResult,
  ].forEach((result) => fail(result.error));

  const agents = rows<ProductInventoryFieldAgent>(agentsResult.data);
  const units = rows<ProductInventoryStockRow>(unitsResult.data);
  const handovers = attachByParent(
    rows<UnknownRow>(handoversResult.data),
    rows<UnknownRow>(handoverLinesResult.data),
    "handover_id",
    "lines"
  ) as unknown as ProductHandover[];
  const sales = attachByParent(
    rows<UnknownRow>(salesResult.data),
    rows<UnknownRow>(saleLinesResult.data),
    "sale_id",
    "lines"
  ) as unknown as AgentProductSale[];
  const collections = rows<AgentProductCollection>(collectionsResult.data);
  const balances = agents.map((agent) => {
    const activeSales = sales
      .filter((sale) => sale.agent_id === agent.id && sale.status === "active")
      .reduce((sum, sale) => sum + amount(sale.total_amount), 0);
    const collected = collections
      .filter((collection) => collection.agent_id === agent.id && collection.status === "posted")
      .reduce((sum, collection) => sum + amount(collection.amount), 0);
    const custody = units.filter(
      (unit) => unit.current_agent_id === agent.id && ["in_transit", "with_agent"].includes(unit.status)
    );
    return {
      agent_id: agent.id,
      agent_name: agent.full_name,
      active_sales: activeSales,
      collected,
      outstanding: activeSales - collected,
      custody_cost: custody.reduce((sum, unit) => sum + amount(unit.unit_cost_snapshot), 0),
      custody_retail: custody.reduce((sum, unit) => sum + amount(unit.planned_sale_price_snapshot), 0),
    };
  });

  return {
    settings,
    agents,
    warehouses: rows<ProductInventoryWarehouse>(warehousesResult.data),
    available_units: units.filter((unit) => unit.status === "in_stock"),
    handovers,
    sales,
    collections,
    price_overrides: rows<ProductPriceOverrideRequest>(overridesResult.data),
    balances,
  };
}

export async function loadProductAgentDashboard(
  admin: AdminClient,
  orgId: string,
  userId: string
): Promise<ProductAgentDashboardData> {
  const db = productInventoryDb(admin);
  const agent = await resolveProductFieldAgent(admin, orgId, userId);
  const [
    settings,
    warehousesResult,
    unitsResult,
    handoversResult,
    handoverLinesResult,
    salesResult,
    saleLinesResult,
    collectionsResult,
    overridesResult,
  ] = await Promise.all([
    commerceSettings(admin, orgId),
    db.from("inventory_warehouses")
      .select("id, code, name_ar, name_en, is_default")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("is_default", { ascending: false }),
    db.from("product_inventory_units")
      .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en)")
      .eq("organization_id", orgId)
      .eq("current_agent_id", agent.id)
      .in("status", ["in_transit", "with_agent"])
      .order("assigned_at", { ascending: false })
      .limit(500),
    db.from("product_handovers")
      .select("id, handover_no, warehouse_id, agent_id, status, require_acknowledgment, notes, issued_at, accepted_at, completed_at, version, warehouse:warehouse_id(id, code, name_ar, name_en, is_default)")
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .order("issued_at", { ascending: false })
      .limit(100),
    db.from("product_handover_lines")
      .select("id, handover_id, unit_id, product_id, planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price, currency, tax_included, line_status, unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model))")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("agent_product_sales")
      .select("id, sale_no, agent_id, sale_date, customer_name, customer_phone, customer_reference, payment_method, subtotal, vat_amount, total_amount, status, accounting_status, version, created_at")
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(250),
    db.from("agent_product_sale_lines")
      .select("id, sale_id, unit_id, handover_id, serial_snapshot, product_name_snapshot, unit_cost_snapshot, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, actual_sale_price, net_amount, vat_amount, total_amount, gross_profit, currency, agent_commission_amount, price_override_request_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("agent_product_collections")
      .select("id, collection_no, agent_id, amount, payment_method, reference, collection_date, notes, status, accounting_status, version, created_at")
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(250),
    db.from("product_price_override_requests")
      .select("id, unit_id, handover_id, agent_id, requested_price, currency, reason, status, requested_at, review_note, version, unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model))")
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .order("requested_at", { ascending: false })
      .limit(250),
  ]);

  [
    warehousesResult,
    unitsResult,
    handoversResult,
    handoverLinesResult,
    salesResult,
    saleLinesResult,
    collectionsResult,
    overridesResult,
  ].forEach((result) => fail(result.error));

  const handovers = attachByParent(
    rows<UnknownRow>(handoversResult.data),
    rows<UnknownRow>(handoverLinesResult.data).filter((line) =>
      rows<UnknownRow>(handoversResult.data).some((handover) => handover.id === line.handover_id)
    ),
    "handover_id",
    "lines"
  ) as unknown as ProductHandover[];
  const sales = attachByParent(
    rows<UnknownRow>(salesResult.data),
    rows<UnknownRow>(saleLinesResult.data).filter((line) =>
      rows<UnknownRow>(salesResult.data).some((sale) => sale.id === line.sale_id)
    ),
    "sale_id",
    "lines"
  ) as unknown as AgentProductSale[];
  const units = rows<ProductInventoryStockRow>(unitsResult.data);
  const collections = rows<AgentProductCollection>(collectionsResult.data);
  const activeSales = sales
    .filter((sale) => sale.status === "active")
    .reduce((sum, sale) => sum + amount(sale.total_amount), 0);
  const collected = collections
    .filter((collection) => collection.status === "posted")
    .reduce((sum, collection) => sum + amount(collection.amount), 0);

  return {
    agent,
    settings,
    warehouses: rows<ProductInventoryWarehouse>(warehousesResult.data),
    pending_handovers: handovers.filter((handover) => handover.status === "issued"),
    units,
    handover_lines: handovers.flatMap((handover) => handover.lines || []) as ProductHandoverLine[],
    sales,
    collections,
    price_overrides: rows<ProductPriceOverrideRequest>(overridesResult.data),
    totals: {
      custody_units: units.length,
      custody_cost: units.reduce((sum, unit) => sum + amount(unit.unit_cost_snapshot), 0),
      custody_retail: units.reduce((sum, unit) => sum + amount(unit.planned_sale_price_snapshot), 0),
      active_sales: activeSales,
      collected,
      outstanding: activeSales - collected,
      gross_profit: sales
        .filter((sale) => sale.status === "active")
        .flatMap((sale) => sale.lines || [])
        .reduce((sum, line) => sum + amount(line.gross_profit), 0),
    },
  };
}
