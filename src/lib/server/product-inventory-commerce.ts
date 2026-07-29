import type { createAdminClient } from "@/lib/supabase/admin";
import { productInventoryDb } from "@/lib/server/product-inventory-api";
import type {
  AgentProductCollection,
  AgentProductSale,
  ProductAgentDashboardData,
  ProductAgentHandover,
  ProductAgentHandoverLine,
  ProductAgentInventoryUnit,
  ProductAgentPriceOverride,
  ProductAgentSale,
  ProductCommerceManagerData,
  ProductHandover,
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
  orgId: string,
  options: { page?: number; pageSize?: number; search?: string; warehouseId?: string } = {}
): Promise<ProductCommerceManagerData> {
  const db = productInventoryDb(admin);
  const page = Math.max(1, Math.trunc(options.page || 1));
  const pageSize = Math.min(Math.max(1, Math.trunc(options.pageSize || 200)), 200);
  const from = (page - 1) * pageSize;
  const escapedSearch = options.search?.trim().replace(/[\\%_]/gu, "\\$&") || "";
  let availableUnitsQuery = db.from("product_inventory_units")
    .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en), agent:current_agent_id(full_name)", { count: "exact" })
    .eq("organization_id", orgId)
    .eq("status", "in_stock")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (escapedSearch) {
    availableUnitsQuery = availableUnitsQuery.ilike(
      "raw_serial_number",
      `%${escapedSearch}%`
    );
  }
  if (options.warehouseId) {
    availableUnitsQuery = availableUnitsQuery.eq("warehouse_id", options.warehouseId);
  }
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
    balancesResult,
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
    availableUnitsQuery.range(from, from + pageSize - 1),
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
    db.rpc("get_product_inventory_agent_balances", {
      p_org_id: orgId,
      p_agent_id: null,
    }),
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
    balancesResult,
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
  const balances = rows<{
    agent_id: string;
    agent_name: string;
    active_sales: number;
    collected: number;
    outstanding: number;
    custody_cost: number;
    custody_retail: number;
  }>(balancesResult.data);
  const totalAvailable = unitsResult.count ?? 0;

  return {
    settings,
    agents,
    warehouses: rows<ProductInventoryWarehouse>(warehousesResult.data),
    available_units: units,
    available_units_pagination: {
      page,
      page_size: pageSize,
      total: totalAvailable,
      total_pages: Math.max(1, Math.ceil(totalAvailable / pageSize)),
    },
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
    balanceResult,
  ] = await Promise.all([
    commerceSettings(admin, orgId),
    db.from("inventory_warehouses")
      .select("id, code, name_ar, name_en, is_default")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("is_default", { ascending: false }),
    db.from("product_inventory_units")
      .select("id, product_id, raw_serial_number, status, condition, ownership_type, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en)")
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
      .select("id, handover_id, unit_id, product_id, planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price, currency, tax_included, line_status, unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model))")
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
      .select("id, sale_id, unit_id, handover_id, serial_snapshot, product_name_snapshot, planned_sale_price_snapshot, minimum_sale_price_snapshot, maximum_sale_price_snapshot, actual_sale_price, net_amount, vat_amount, total_amount, currency, agent_commission_amount, price_override_request_id")
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
      .select("id, unit_id, handover_id, agent_id, requested_price, currency, reason, status, requested_at, review_note, version, unit:unit_id(id, product_id, raw_serial_number, status, condition, ownership_type, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model))")
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .order("requested_at", { ascending: false })
      .limit(250),
    db.rpc("get_product_inventory_agent_balances", {
      p_org_id: orgId,
      p_agent_id: agent.id,
    }),
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
    balanceResult,
  ].forEach((result) => fail(result.error));

  const handovers = attachByParent(
    rows<UnknownRow>(handoversResult.data),
    rows<UnknownRow>(handoverLinesResult.data).filter((line) =>
      rows<UnknownRow>(handoversResult.data).some((handover) => handover.id === line.handover_id)
    ),
    "handover_id",
    "lines"
  ) as unknown as ProductAgentHandover[];
  const sales = attachByParent(
    rows<UnknownRow>(salesResult.data),
    rows<UnknownRow>(saleLinesResult.data).filter((line) =>
      rows<UnknownRow>(salesResult.data).some((sale) => sale.id === line.sale_id)
    ),
    "sale_id",
    "lines"
  ) as unknown as ProductAgentSale[];
  const units = rows<ProductAgentInventoryUnit>(unitsResult.data);
  const collections = rows<AgentProductCollection>(collectionsResult.data);
  const balance = rows<{
    custody_units: number;
    custody_retail: number;
    active_sales: number;
    collected: number;
    outstanding: number;
  }>(balanceResult.data)[0];

  return {
    agent,
    settings,
    warehouses: rows<ProductInventoryWarehouse>(warehousesResult.data),
    pending_handovers: handovers.filter((handover) => handover.status === "issued"),
    units,
    handover_lines: handovers.flatMap(
      (handover) => handover.lines || []
    ) as ProductAgentHandoverLine[],
    sales,
    collections,
    price_overrides: rows<ProductAgentPriceOverride>(overridesResult.data),
    totals: {
      custody_units: amount(balance?.custody_units),
      custody_retail: amount(balance?.custody_retail),
      active_sales: amount(balance?.active_sales),
      collected: amount(balance?.collected),
      outstanding: amount(balance?.outstanding),
    },
  };
}
