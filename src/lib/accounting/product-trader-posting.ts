import { createHash } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createJournalEntry, getAccountingSettings } from "@/lib/accounting/posting";
import { roundMoney } from "@/lib/accounting/validation";

type AdminClient = ReturnType<typeof createAdminClient>;
function db(admin: AdminClient) { return admin as any; }
type JournalAccountMap = {
  receivable: string; revenue: string; vatPayable: string;
  inventory: string; cogs: string; commissionExpense: string;
  commissionPayable: string;
};

export function buildProductTraderSaleJournalLines(input: {
  saleNo: string; total: number; net: number; vat: number; cost: number;
  organizationReceivable: number; merchantCommission: number;
  agentCommission: number; netMerchantCommission: boolean;
  accounts: JournalAccountMap;
}) {
  const commissionExpenseAmount = roundMoney(input.merchantCommission + input.agentCommission);
  const commissionPayableAmount = roundMoney(
    input.agentCommission + (input.netMerchantCommission ? 0 : input.merchantCommission),
  );
  const lines = [
    { account_id: input.accounts.receivable, debit: input.organizationReceivable, description: `Trader receivable ${input.saleNo}` },
    { account_id: input.accounts.revenue, credit: input.net, description: `Trader product revenue ${input.saleNo}` },
    ...(input.vat > 0 ? [{ account_id: input.accounts.vatPayable, credit: input.vat, description: `Output VAT ${input.saleNo}` }] : []),
    { account_id: input.accounts.cogs, debit: input.cost, description: `Product cost ${input.saleNo}` },
    { account_id: input.accounts.inventory, credit: input.cost, description: `Inventory release ${input.saleNo}` },
    ...(commissionExpenseAmount > 0 ? [{
      account_id: input.accounts.commissionExpense,
      debit: commissionExpenseAmount,
      description: `Trader-chain commissions ${input.saleNo}`,
    }] : []),
    ...(commissionPayableAmount > 0 ? [{
      account_id: input.accounts.commissionPayable,
      credit: commissionPayableAmount,
      description: `Commission payable ${input.saleNo}`,
    }] : []),
  ];
  return { lines, commissionExpenseAmount, commissionPayableAmount };
}

function commandId(scope: string) {
  const hash = createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20)}`;
}

export async function autoPostProductTraderSale(admin: AdminClient, orgId: string, userId: string, saleId: string) {
  const saleResult = await db(admin).from("product_trader_sales")
    .select("*, lines:product_trader_sale_lines(unit_cost_snapshot, net_amount, vat_amount, merchant_commission_amount, agent_chain_commission_amount)")
    .eq("organization_id", orgId).eq("id", saleId).maybeSingle();
  if (saleResult.error) throw new Error(saleResult.error.message);
  const sale = saleResult.data;
  if (!sale) throw new Error("Trader product sale was not found.");
  if (sale.accounting_journal_entry_id) return { success: true, journalEntryId: String(sale.accounting_journal_entry_id) };
  try {
    const settings = await getAccountingSettings(admin, orgId) as Record<string, unknown> | null;
    const receivable = String(settings?.default_agent_receivable_id || "");
    const revenue = String(settings?.default_sales_revenue_id || "");
    const vatPayable = String(settings?.default_vat_payable_id || "");
    const inventory = String(settings?.default_inventory_asset_id || "");
    const cogs = String(settings?.default_inventory_cogs_id || "");
    const commissionExpense = String(settings?.default_commission_expense_id || "");
    const commissionPayable = String(settings?.default_commission_payable_id || "");
    if (!receivable || !revenue || !inventory || !cogs) throw new Error("Trader sale accounting accounts are incomplete.");
    const total = roundMoney(sale.total_amount), net = roundMoney(sale.subtotal), vat = roundMoney(sale.vat_amount);
    const lines = (sale.lines || []) as Array<Record<string, unknown>>;
    const cost = roundMoney(lines.reduce((sum, line) => sum + Number(line.unit_cost_snapshot || 0), 0));
    const merchantCommission = roundMoney(sale.merchant_commission_amount);
    const agentCommission = roundMoney(sale.agent_chain_commission_amount);
    const organizationReceivable = roundMoney(sale.organization_receivable_amount);
    const journal = buildProductTraderSaleJournalLines({
      saleNo: String(sale.sale_no), total, net, vat, cost,
      organizationReceivable, merchantCommission, agentCommission,
      netMerchantCommission: sale.net_commission_at_settlement === true,
      accounts: { receivable, revenue, vatPayable, inventory, cogs, commissionExpense, commissionPayable },
    });
    if (vat > 0 && !vatPayable) throw new Error("VAT payable account is required.");
    if (journal.commissionExpenseAmount > 0 && !commissionExpense) throw new Error("Commission expense account is required.");
    if (journal.commissionPayableAmount > 0 && !commissionPayable) throw new Error("Commission payable account is required.");
    const journalStatus = settings?.auto_post_product_sales === false ? "pending_approval" as const : "posted" as const;
    const id = commandId(`product-trader-sale:${orgId}:${saleId}`);
    const entry = await createJournalEntry(admin, { orgId, userId, entryDate: String(sale.sale_date), description: `Trader product sale ${sale.sale_no}`, sourceModule: "product_trader_sale", sourceId: saleId, status: journalStatus, lines: journal.lines, commandId: id, requestId: id });
    const accountingStatus = journalStatus === "posted" ? "posted" : "pending_approval";
    const update = await db(admin).from("product_trader_sales").update({ accounting_status: accountingStatus, accounting_journal_entry_id: entry.id, accounting_posted_at: journalStatus === "posted" ? new Date().toISOString() : null, accounting_error: null }).eq("organization_id", orgId).eq("id", saleId);
    if (update.error) throw new Error(update.error.message);
    if (journalStatus === "posted") {
      const commissionUpdate = await db(admin).from("product_trader_commissions").update({ status: "payable" }).eq("organization_id", orgId).eq("sale_id", saleId).eq("status", "accrued").eq("settlement_method", "payable");
      if (commissionUpdate.error) throw new Error(commissionUpdate.error.message);
    }
    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    await db(admin).from("product_trader_sales").update({ accounting_status: "failed", accounting_error: error instanceof Error ? error.message : String(error) }).eq("organization_id", orgId).eq("id", saleId);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function autoPostProductTraderCollection(admin: AdminClient, orgId: string, userId: string, collectionId: string) {
  const result = await db(admin).from("product_trader_collections").select("*").eq("organization_id", orgId).eq("id", collectionId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const collection = result.data;
  if (!collection || collection.status !== "confirmed") throw new Error("Only a confirmed trader collection can be posted.");
  if (collection.accounting_journal_entry_id) return { success: true, journalEntryId: String(collection.accounting_journal_entry_id) };
  try {
    const settings = await getAccountingSettings(admin, orgId) as Record<string, unknown> | null;
    const receipt = String(collection.payment_method === "cash" ? settings?.default_cash_account_id || "" : settings?.default_bank_account_id || "");
    const receivable = String(settings?.default_agent_receivable_id || "");
    if (!receipt || !receivable) throw new Error("Cash/bank and trader receivable accounts are required.");
    const amount = roundMoney(collection.amount);
    const id = commandId(`product-trader-collection:${orgId}:${collectionId}`);
    const journalStatus = settings?.auto_post_product_collections === false ? "pending_approval" as const : "posted" as const;
    const entry = await createJournalEntry(admin, { orgId, userId, entryDate: String(collection.collection_date), description: `Trader collection ${collection.collection_no}`, sourceModule: "product_trader_collection", sourceId: collectionId, status: journalStatus, lines: [
      { account_id: receipt, debit: amount, description: `Receipt ${collection.collection_no}` },
      { account_id: receivable, credit: amount, description: `Trader receivable settlement ${collection.collection_no}` },
    ], commandId: id, requestId: id });
    const update = await db(admin).from("product_trader_collections").update({ accounting_status: journalStatus === "posted" ? "posted" : "pending_approval", accounting_journal_entry_id: entry.id, accounting_posted_at: journalStatus === "posted" ? new Date().toISOString() : null, accounting_error: null }).eq("organization_id", orgId).eq("id", collectionId);
    if (update.error) throw new Error(update.error.message);
    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    await db(admin).from("product_trader_collections").update({ accounting_status: "failed", accounting_error: error instanceof Error ? error.message : String(error) }).eq("organization_id", orgId).eq("id", collectionId);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
