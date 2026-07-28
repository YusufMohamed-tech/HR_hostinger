import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

const assetStatuses = new Set([
  "in_stock",
  "reserved",
  "in_transit",
  "with_agent",
  "returned",
  "quarantine",
  "damaged",
]);

function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) || null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireProductInventoryFinanceAccess(request);
  if ("error" in auth) return auth.error;

  try {
    const db = productInventoryDb(auth.admin);
    const [
      receiptsResult,
      unitsResult,
      salesResult,
      linesResult,
      collectionsResult,
      lossesResult,
      postingsResult,
      commissionsResult,
      settingsResult,
      productAccountsResult,
    ] = await Promise.all([
      db.from("product_receipts")
        .select("*, company:supplier_company_id(id, name, code, brand_color), warehouse:warehouse_id(id, code, name_ar, name_en, is_default)")
        .eq("organization_id", auth.orgId)
        .eq("status", "confirmed")
        .order("confirmed_at", { ascending: false })
        .limit(500),
      db.from("product_inventory_units")
        .select("id, product_id, raw_serial_number, status, condition, ownership_type, unit_cost_snapshot, planned_sale_price_snapshot, currency, current_agent_id, current_handover_id, current_sale_id, assigned_at, sold_at, created_at, product:product_id(name, sku, model), warehouse:warehouse_id(name_ar, name_en), agent:current_agent_id(full_name)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(5000),
      db.from("agent_product_sales")
        .select("id, sale_no, agent_id, sale_date, customer_name, customer_phone, customer_reference, payment_method, subtotal, vat_amount, total_amount, status, accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id, accounting_posting_error, accounting_attempt_count, accounting_last_attempt_at, version, created_at, agent:agent_id(id, full_name, phone)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("agent_product_sale_lines")
        .select("id, sale_id, unit_id, serial_snapshot, product_name_snapshot, unit_cost_snapshot, planned_sale_price_snapshot, actual_sale_price, net_amount, vat_amount, total_amount, gross_profit, currency, agent_commission_amount, inventory_account_id, cogs_account_id, revenue_account_id")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(5000),
      db.from("agent_product_collections")
        .select("id, collection_no, agent_id, amount, payment_method, reference, collection_date, status, accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id, accounting_posting_error, accounting_attempt_count, accounting_last_attempt_at, version, created_at, agent:agent_id(id, full_name, phone)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("product_inventory_loss_records")
        .select("id, unit_id, loss_type, serial_snapshot, product_name_snapshot, unit_cost_snapshot, currency, ownership_type, reason, status, accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id, accounting_posting_error, accounting_attempt_count, accounting_last_attempt_at, recorded_at, version")
        .eq("organization_id", auth.orgId)
        .order("recorded_at", { ascending: false })
        .limit(1000),
      db.from("product_inventory_accounting_postings")
        .select("*, journal:journal_entry_id(id, entry_no, status, total_debit, total_credit), reversal:reversal_entry_id(id, entry_no, status, total_debit, total_credit)")
        .eq("organization_id", auth.orgId)
        .order("updated_at", { ascending: false })
        .limit(3000),
      db.from("product_agent_commissions")
        .select("id, sale_id, sale_line_id, agent_id, commission_amount, currency, status, accrual_journal_entry_id, settlement_id, settlement_journal_entry_id, settled_at, created_at, agent:agent_id(id, full_name), sale:sale_id(id, sale_no, sale_date, status)")
        .eq("organization_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("accounting_settings")
        .select("id, version, default_inventory_asset_id, default_inventory_grni_id, default_inventory_cogs_id, default_inventory_shrinkage_id, default_agent_receivable_id, default_accounts_payable_id, default_sales_revenue_id, default_vat_payable_id, default_cash_account_id, default_bank_account_id, default_commission_expense_id, default_commission_payable_id, auto_post_inventory_receipts, auto_post_product_sales, auto_post_product_collections, enable_product_agent_commissions")
        .eq("organization_id", auth.orgId)
        .maybeSingle(),
      db.from("sales_products")
        .select("inventory_account_id")
        .eq("organization_id", auth.orgId)
        .not("inventory_account_id", "is", null),
    ]);

    [
      receiptsResult,
      unitsResult,
      salesResult,
      linesResult,
      collectionsResult,
      lossesResult,
      postingsResult,
      commissionsResult,
      settingsResult,
      productAccountsResult,
    ].forEach((result) => {
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
    const losses = lossesResult.data ?? [];
    const postings = postingsResult.data ?? [];
    const commissions = commissionsResult.data ?? [];
    const settings = settingsResult.data as Record<string, unknown> | null;
    const inventoryAccountIds = new Set<string>(
      [
        settings?.default_inventory_asset_id,
        ...(productAccountsResult.data || []).map((row: Record<string, unknown>) => row.inventory_account_id),
        ...saleLines.map((line: Record<string, unknown>) => line.inventory_account_id),
      ].filter(Boolean).map(String)
    );
    const ledgerAccountIds = [
      ...inventoryAccountIds,
      settings?.default_agent_receivable_id,
    ].filter(Boolean).map(String);
    const ledgerLinesResult = ledgerAccountIds.length
      ? await db.from("accounting_journal_lines")
        .select("account_id, debit, credit, entry:journal_entry_id!inner(status, source_module)")
        .eq("organization_id", auth.orgId)
        .in("account_id", ledgerAccountIds)
      : { data: [], error: null };
    if (ledgerLinesResult.error) {
      throw Object.assign(new Error(ledgerLinesResult.error.message), { code: ledgerLinesResult.error.code });
    }
    const ledgerLines = (ledgerLinesResult.data || []).filter((line: Record<string, unknown>) => {
      const entry = relation(line.entry);
      return entry && ["posted", "reversed"].includes(String(entry.status));
    });
    const balanceFor = (ids: Set<string>) => ledgerLines
      .filter((line: Record<string, unknown>) => ids.has(String(line.account_id)))
      .reduce(
        (sum: number, line: Record<string, unknown>) =>
          sum + Number(line.debit || 0) - Number(line.credit || 0),
        0
      );

    const ownedOnHand = inventory.filter((unit: Record<string, unknown>) =>
      unit.ownership_type === "purchased" && assetStatuses.has(String(unit.status))
    );
    const consignmentOnHand = inventory.filter((unit: Record<string, unknown>) =>
      unit.ownership_type === "consignment" && assetStatuses.has(String(unit.status))
    );
    const activeSales = sales.filter((sale: Record<string, unknown>) => sale.status === "active");
    const companyOwnedActiveSales = activeSales.filter(
      (sale: Record<string, unknown>) => sale.accounting_status !== "not_required"
    );
    const consignmentActiveSales = activeSales.filter(
      (sale: Record<string, unknown>) => sale.accounting_status === "not_required"
    );
    const postedCollections = collections.filter((collection: Record<string, unknown>) => collection.status === "posted");
    const salesRevenue = activeSales.reduce(
      (sum: number, sale: Record<string, unknown>) => sum + Number(sale.total_amount || 0),
      0
    );
    const companyOwnedSalesRevenue = companyOwnedActiveSales.reduce(
      (sum: number, sale: Record<string, unknown>) => sum + Number(sale.total_amount || 0),
      0
    );
    const consignmentSalesRevenue = consignmentActiveSales.reduce(
      (sum: number, sale: Record<string, unknown>) => sum + Number(sale.total_amount || 0),
      0
    );
    const salesCost = activeSales
      .flatMap((sale: Record<string, unknown>) => sale.lines as Record<string, unknown>[])
      .reduce((sum: number, line: Record<string, unknown>) => sum + Number(line.unit_cost_snapshot || 0), 0);
    const collected = postedCollections.reduce(
      (sum: number, collection: Record<string, unknown>) => sum + Number(collection.amount || 0),
      0
    );
    const stockCost = ownedOnHand.reduce(
      (sum: number, unit: Record<string, unknown>) => sum + Number(unit.unit_cost_snapshot || 0),
      0
    );
    const inventoryGlBalance = balanceFor(inventoryAccountIds);
    const agentReceivableIds = new Set<string>(
      settings?.default_agent_receivable_id ? [String(settings.default_agent_receivable_id)] : []
    );
    const agentReceivableGlBalance = balanceFor(agentReceivableIds);
    const postingExceptions = postings.filter((posting: Record<string, unknown>) =>
      ["pending", "pending_approval", "failed"].includes(String(posting.status))
    );
    const postingSourceKeys = new Set(
      postings.map((posting: Record<string, unknown>) => `${posting.source_type}:${posting.source_id}`)
    );
    const missingPostingSources = [
      ...receipts
        .filter((row: Record<string, unknown>) =>
          !["posted", "not_required", "reversed"].includes(String(row.accounting_status))
          && !postingSourceKeys.has(`receipt:${row.id}`)
        )
        .map((row: Record<string, unknown>) => ({
          source_type: "receipt",
          source_id: row.id,
          status: row.accounting_status,
          last_error: row.accounting_posting_error || null,
          attempt_count: row.accounting_attempt_count || 0,
        })),
      ...sales
        .filter((row: Record<string, unknown>) =>
          !["posted", "not_required", "reversed"].includes(String(row.accounting_status))
          && !postingSourceKeys.has(`sale:${row.id}`)
        )
        .map((row: Record<string, unknown>) => ({
          source_type: "sale",
          source_id: row.id,
          status: row.accounting_status,
          last_error: row.accounting_posting_error || null,
          attempt_count: row.accounting_attempt_count || 0,
        })),
      ...collections
        .filter((row: Record<string, unknown>) =>
          !["posted", "not_required", "reversed"].includes(String(row.accounting_status))
          && !postingSourceKeys.has(`collection:${row.id}`)
        )
        .map((row: Record<string, unknown>) => ({
          source_type: "collection",
          source_id: row.id,
          status: row.accounting_status,
          last_error: row.accounting_posting_error || null,
          attempt_count: row.accounting_attempt_count || 0,
        })),
      ...losses
        .filter((row: Record<string, unknown>) =>
          !["posted", "not_required", "reversed"].includes(String(row.accounting_status))
          && !postingSourceKeys.has(`loss:${row.id}`)
        )
        .map((row: Record<string, unknown>) => ({
          source_type: "loss",
          source_id: row.id,
          status: row.accounting_status,
          last_error: row.accounting_posting_error || null,
          attempt_count: row.accounting_attempt_count || 0,
        })),
    ];

    const totals = {
      units: ownedOnHand.length,
      cost: stockCost,
      expectedSales: ownedOnHand.reduce(
        (sum: number, unit: Record<string, unknown>) =>
          sum + Number(unit.planned_sale_price_snapshot || 0),
        0
      ),
      margin: ownedOnHand.reduce(
        (sum: number, unit: Record<string, unknown>) =>
          sum + Number(unit.planned_sale_price_snapshot || 0)
          - Number(unit.unit_cost_snapshot || 0),
        0
      ),
      consignmentUnits: consignmentOnHand.length,
      consignmentMemoCost: consignmentOnHand.reduce(
        (sum: number, unit: Record<string, unknown>) => sum + Number(unit.unit_cost_snapshot || 0),
        0
      ),
      salesRevenue,
      companyOwnedSalesRevenue,
      consignmentSalesRevenue,
      salesCost,
      grossProfit: activeSales
        .flatMap((sale: Record<string, unknown>) => sale.lines as Record<string, unknown>[])
        .reduce((sum: number, line: Record<string, unknown>) => sum + Number(line.gross_profit || 0), 0),
      vat: activeSales.reduce(
        (sum: number, sale: Record<string, unknown>) => sum + Number(sale.vat_amount || 0),
        0
      ),
      commission: activeSales
        .flatMap((sale: Record<string, unknown>) => sale.lines as Record<string, unknown>[])
        .reduce(
          (sum: number, line: Record<string, unknown>) =>
            sum + Number(line.agent_commission_amount || 0),
          0
        ),
      commissionAccrued: commissions
        .filter((commission: Record<string, unknown>) => commission.status === "accrued")
        .reduce(
          (sum: number, commission: Record<string, unknown>) =>
            sum + Number(commission.commission_amount || 0),
          0
        ),
      commissionSettled: commissions
        .filter((commission: Record<string, unknown>) => commission.status === "settled")
        .reduce(
          (sum: number, commission: Record<string, unknown>) =>
            sum + Number(commission.commission_amount || 0),
          0
        ),
      collected,
      outstanding: salesRevenue - collected,
      failedPostings: postingExceptions.filter(
        (posting: Record<string, unknown>) => posting.status === "failed"
      ).length,
      pendingPostings: postingExceptions.filter(
        (posting: Record<string, unknown>) => posting.status !== "failed"
      ).length + missingPostingSources.length,
    };

    return NextResponse.json({
      data: {
        receipts,
        inventory,
        sales,
        collections,
        losses,
        commissions,
        postings,
        postingExceptions: [...postingExceptions, ...missingPostingSources],
        settings,
        totals,
        reconciliation: {
          stockUnits: ownedOnHand.length,
          stockCost,
          inventoryGlBalance,
          inventoryDifference: inventoryGlBalance - stockCost,
          operationalAgentReceivable: salesRevenue - collected,
          agentReceivableGlBalance,
          agentReceivableDifference: agentReceivableGlBalance - (salesRevenue - collected),
          consignmentUnits: consignmentOnHand.length,
          consignmentMemoCost: totals.consignmentMemoCost,
          consignmentSalesRevenue,
          collectionAllocationBlocked: consignmentSalesRevenue > 0,
          balanced: Math.abs(inventoryGlBalance - stockCost) < 0.01
            && Math.abs(agentReceivableGlBalance - (salesRevenue - collected)) < 0.01
            && totals.failedPostings === 0
            && totals.pendingPostings === 0,
        },
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل القيمة المالية ومطابقة مخزون المنتجات.");
  }
}
