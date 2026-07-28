import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;

  try {
    const db = productInventoryDb(auth.admin);
    const [receiptsResult, unitsResult, salesResult, linesResult, collectionsResult] = await Promise.all([
      db.from("product_receipts")
        .select("*, company:supplier_company_id(id, name, code, brand_color), warehouse:warehouse_id(id, code, name_ar, name_en, is_default)")
        .eq("organization_id", auth.orgId)
        .eq("status", "confirmed")
        .order("confirmed_at", { ascending: false })
        .limit(200),
      db.from("product_inventory_units")
        .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en), agent:current_agent_id(full_name)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("agent_product_sales")
        .select("id, sale_no, agent_id, sale_date, customer_name, customer_phone, customer_reference, payment_method, subtotal, vat_amount, total_amount, status, accounting_status, version, created_at, agent:agent_id(id, full_name, phone)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(1000),
      db.from("agent_product_sale_lines")
        .select("id, sale_id, unit_id, serial_snapshot, product_name_snapshot, unit_cost_snapshot, planned_sale_price_snapshot, actual_sale_price, net_amount, vat_amount, total_amount, gross_profit, currency, agent_commission_amount")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("agent_product_collections")
        .select("id, collection_no, agent_id, amount, payment_method, reference, collection_date, status, accounting_status, version, created_at, agent:agent_id(id, full_name, phone)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    [receiptsResult, unitsResult, salesResult, linesResult, collectionsResult].forEach((result) => {
      if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    });
    const receipts = receiptsResult.data ?? [];
    const inventory = unitsResult.data ?? [];
    const saleLines = linesResult.data ?? [];
    const sales = (salesResult.data ?? []).map((sale: Record<string, unknown>) => ({
      ...sale,
      lines: saleLines.filter((line: Record<string, unknown>) => line.sale_id === sale.id),
    }));
    const collections = collectionsResult.data ?? [];
    const onHand = inventory.filter((unit: Record<string, unknown>) =>
      ["in_stock", "in_transit", "with_agent", "returned"].includes(String(unit.status))
    );
    const activeSales = sales.filter((sale: Record<string, unknown>) => sale.status === "active");
    const postedCollections = collections.filter((collection: Record<string, unknown>) => collection.status === "posted");
    const salesRevenue = activeSales.reduce((sum: number, sale: Record<string, unknown>) => sum + Number(sale.total_amount || 0), 0);
    const salesCost = activeSales.flatMap((sale: Record<string, unknown>) => sale.lines as Record<string, unknown>[])
      .reduce((sum: number, line: Record<string, unknown>) => sum + Number(line.unit_cost_snapshot || 0), 0);
    const collected = postedCollections.reduce((sum: number, collection: Record<string, unknown>) => sum + Number(collection.amount || 0), 0);
    const totals = {
      units: onHand.length,
      cost: onHand.reduce((sum: number, unit: Record<string, unknown>) => sum + Number(unit.unit_cost_snapshot || 0), 0),
      expectedSales: onHand.reduce((sum: number, unit: Record<string, unknown>) => sum + Number(unit.planned_sale_price_snapshot || 0), 0),
      margin: onHand.reduce((sum: number, unit: Record<string, unknown>) => sum + Number(unit.planned_sale_price_snapshot || 0) - Number(unit.unit_cost_snapshot || 0), 0),
      salesRevenue,
      salesCost,
      grossProfit: activeSales.flatMap((sale: Record<string, unknown>) => sale.lines as Record<string, unknown>[])
        .reduce((sum: number, line: Record<string, unknown>) => sum + Number(line.gross_profit || 0), 0),
      vat: activeSales.reduce((sum: number, sale: Record<string, unknown>) => sum + Number(sale.vat_amount || 0), 0),
      collected,
      outstanding: salesRevenue - collected,
    };
    return NextResponse.json({ data: { receipts, inventory, sales, collections, totals } });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل القيمة المالية لمخزون المنتجات.");
  }
}
