import { NextRequest, NextResponse } from "next/server";
import { requireProductInventoryFinanceAccess } from "@/lib/server/product-inventory-auth";
import { productInventoryDb, productInventoryError } from "@/lib/server/product-inventory-api";

function amount(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
      financeSummaryResult,
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
        .limit(500),
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
      db.rpc("get_product_inventory_finance_summary", { p_org_id: auth.orgId }),
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
      financeSummaryResult,
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
    const summary = (financeSummaryResult.data || {}) as Record<string, unknown>;
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
      units: amount(summary.units),
      cost: amount(summary.cost),
      expectedSales: amount(summary.expectedSales),
      margin: amount(summary.margin),
      consignmentUnits: amount(summary.consignmentUnits),
      consignmentMemoCost: amount(summary.consignmentMemoCost),
      salesRevenue: amount(summary.salesRevenue),
      companyOwnedSalesRevenue: amount(summary.companyOwnedSalesRevenue),
      consignmentSalesRevenue: amount(summary.consignmentSalesRevenue),
      salesCost: amount(summary.salesCost),
      grossProfit: amount(summary.grossProfit),
      vat: amount(summary.vat),
      commission: amount(summary.commission),
      commissionAccrued: amount(summary.commissionAccrued),
      commissionSettled: amount(summary.commissionSettled),
      collected: amount(summary.collected),
      outstanding: amount(summary.outstanding),
      failedPostings: amount(summary.failedPostings),
      pendingPostings: amount(summary.pendingPostings),
    };
    const stockCost = totals.cost;
    const inventoryGlBalance = amount(summary.inventoryGlBalance);
    const operationalAgentReceivable = totals.outstanding;
    const agentReceivableGlBalance = amount(summary.agentReceivableGlBalance);

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
          stockUnits: totals.units,
          stockCost,
          inventoryGlBalance,
          inventoryDifference: inventoryGlBalance - stockCost,
          operationalAgentReceivable,
          agentReceivableGlBalance,
          agentReceivableDifference: agentReceivableGlBalance - operationalAgentReceivable,
          consignmentUnits: totals.consignmentUnits,
          consignmentMemoCost: totals.consignmentMemoCost,
          consignmentSalesRevenue: totals.consignmentSalesRevenue,
          collectionAllocationBlocked: totals.consignmentSalesRevenue > 0,
          balanced: Math.abs(inventoryGlBalance - stockCost) < 0.01
            && Math.abs(agentReceivableGlBalance - operationalAgentReceivable) < 0.01
            && totals.failedPostings === 0
            && totals.pendingPostings === 0,
        },
      },
    });
  } catch (error) {
    return productInventoryError(error, "تعذر تحميل القيمة المالية ومطابقة مخزون المنتجات.");
  }
}
