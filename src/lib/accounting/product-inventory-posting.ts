import { createHash } from "node:crypto";
import type { AccountingSettings, AdminClient } from "@/lib/accounting/posting-engine";
import {
  cancelJournalEntry,
  createJournalEntry,
  getAccountingSettings,
  reverseJournalEntry,
} from "@/lib/accounting/posting";
import { roundMoney } from "@/lib/accounting/validation";
import {
  buildProductCollectionAccountingLines,
  buildProductLossAccountingLines,
  buildProductReceiptAccountingLines,
  buildProductSaleAccountingLines,
  type ProductSaleAccountingLine,
} from "@/lib/product-inventory/accounting";

export type ProductInventoryAccountingSource =
  | "receipt"
  | "sale"
  | "collection"
  | "loss";

export type ProductInventoryPostingResult = {
  success: boolean;
  status?: "pending_approval" | "not_required" | "posted" | "reversed";
  journalEntryId?: string;
  reversalEntryId?: string;
  error?: string;
};

type InventoryAccountingSettings = AccountingSettings & {
  default_inventory_asset_id?: string | null;
  default_inventory_grni_id?: string | null;
  default_inventory_cogs_id?: string | null;
  default_inventory_shrinkage_id?: string | null;
  default_agent_receivable_id?: string | null;
  auto_post_inventory_receipts?: boolean;
  auto_post_product_sales?: boolean;
  auto_post_product_collections?: boolean;
  enable_product_agent_commissions?: boolean;
};

function db(admin: AdminClient) {
  return admin as any;
}

function sourceUuid(scope: string) {
  const hash = createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
}

async function markAccounting(
  admin: AdminClient,
  orgId: string,
  sourceType: ProductInventoryAccountingSource,
  sourceId: string,
  status: "pending_approval" | "not_required" | "posted" | "failed" | "reversed",
  values: {
    journalEntryId?: string;
    reversalEntryId?: string;
    error?: string;
    amounts?: Record<string, number>;
  } = {}
) {
  const { error } = await db(admin).rpc("mark_product_inventory_accounting", {
    p_org_id: orgId,
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_status: status,
    p_journal_entry_id: values.journalEntryId || null,
    p_reversal_entry_id: values.reversalEntryId || null,
    p_error: values.error || null,
    p_amounts: values.amounts || {},
  });
  if (error) throw new Error(error.message);
}

async function recordProductCommissionAccrual(
  admin: AdminClient,
  orgId: string,
  saleId: string,
  journalEntryId: string
) {
  const { error } = await db(admin).rpc("record_product_agent_commission_accrual", {
    p_org_id: orgId,
    p_sale_id: saleId,
    p_journal_entry_id: journalEntryId,
  });
  if (error) throw new Error(error.message);
}

async function reverseProductCommissions(
  admin: AdminClient,
  orgId: string,
  saleId: string
) {
  const { error } = await db(admin).rpc("reverse_product_agent_commissions", {
    p_org_id: orgId,
    p_sale_id: saleId,
  });
  if (error) throw new Error(error.message);
}

async function failPosting(
  admin: AdminClient,
  orgId: string,
  sourceType: ProductInventoryAccountingSource,
  sourceId: string,
  error: unknown
): Promise<ProductInventoryPostingResult> {
  const message = error instanceof Error ? error.message : "Product inventory accounting failed.";
  try {
    await markAccounting(admin, orgId, sourceType, sourceId, "failed", { error: message });
  } catch {
    // Preserve the original accounting error for the outbox retry/dead-letter path.
  }
  return { success: false, error: message };
}

function postingStatus(autoPost: boolean | undefined) {
  return autoPost === false ? "pending_approval" as const : "posted" as const;
}

export async function autoPostProductReceipt(
  admin: AdminClient,
  orgId: string,
  userId: string,
  receiptId: string
): Promise<ProductInventoryPostingResult> {
  try {
    const { data: receipt, error } = await db(admin)
      .from("product_receipts")
      .select("id, receipt_no, receipt_date, status, ownership_type, invoice_received, supplier_invoice_no, physical_total_cost, accounting_status, accounting_journal_entry_id, lines:product_receipt_lines(id, total_cost, inventory_account_id)")
      .eq("organization_id", orgId)
      .eq("id", receiptId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!receipt || receipt.status !== "confirmed") {
      throw new Error("Only a confirmed product receipt can be posted.");
    }
    if (receipt.accounting_journal_entry_id) {
      return {
        success: true,
        status: receipt.accounting_status,
        journalEntryId: String(receipt.accounting_journal_entry_id),
      };
    }
    if (receipt.ownership_type === "consignment") {
      await markAccounting(admin, orgId, "receipt", receiptId, "not_required", {
        amounts: { inventory_cost: 0 },
      });
      return { success: true, status: "not_required" };
    }

    const settings = await getAccountingSettings(admin, orgId) as InventoryAccountingSettings | null;
    const creditAccount = receipt.invoice_received
      ? settings?.default_accounts_payable_id
      : settings?.default_inventory_grni_id;
    if (!creditAccount) {
      throw new Error(receipt.invoice_received
        ? "Accounts payable is required for invoiced product receipts."
        : "GRNI is required for product receipts without a supplier invoice.");
    }

    const receiptLines = (receipt.lines || []) as Array<Record<string, unknown>>;
    const inventoryGroups = receiptLines.map((line) => {
      const inventoryAccount = String(
        line.inventory_account_id || settings?.default_inventory_asset_id || ""
      );
      if (!inventoryAccount) {
        throw new Error("An inventory asset account is required for every receipt group.");
      }
      return { accountId: inventoryAccount, cost: Number(line.total_cost || 0) };
    });
    const receiptPosting = buildProductReceiptAccountingLines({
      reference: String(receipt.receipt_no),
      inventoryGroups,
      settlementAccountId: String(creditAccount),
      settlementDescription: receipt.invoice_received
        ? `Supplier payable ${receipt.supplier_invoice_no || receipt.receipt_no}`
        : `GRNI accrual ${receipt.receipt_no}`,
    });
    const totalCost = receiptPosting.totalCost;
    if (totalCost <= 0) throw new Error("Receipt cost must be positive before accounting posting.");
    if (Math.abs(totalCost - roundMoney(receipt.physical_total_cost)) >= 0.01) {
      throw new Error("Receipt line costs do not reconcile to the confirmed receipt total.");
    }

    const status = postingStatus(settings?.auto_post_inventory_receipts);
    const commandId = sourceUuid(`product-receipt:${orgId}:${receiptId}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: String(receipt.receipt_date),
      description: `Product receipt ${receipt.receipt_no}`,
      sourceModule: "product_inventory_receipt",
      sourceId: receiptId,
      status,
      lines: receiptPosting.lines,
      commandId,
      requestId: commandId,
    });
    await markAccounting(admin, orgId, "receipt", receiptId, status, {
      journalEntryId: String(entry.id),
      amounts: { inventory_cost: totalCost, payable_or_grni: totalCost },
    });
    return {
      success: true,
      status,
      journalEntryId: String(entry.id),
    };
  } catch (error) {
    return failPosting(admin, orgId, "receipt", receiptId, error);
  }
}

export async function autoPostProductSale(
  admin: AdminClient,
  orgId: string,
  userId: string,
  saleId: string
): Promise<ProductInventoryPostingResult> {
  try {
    const { data: sale, error } = await db(admin)
      .from("agent_product_sales")
      .select("id, sale_no, sale_date, status, subtotal, vat_amount, total_amount, accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id, lines:agent_product_sale_lines(id, unit_cost_snapshot, net_amount, vat_amount, total_amount, agent_commission_amount, inventory_account_id, cogs_account_id, revenue_account_id)")
      .eq("organization_id", orgId)
      .eq("id", saleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sale) throw new Error("Product sale was not found.");
    if (sale.status === "voided") {
      return autoReverseProductSale(admin, orgId, userId, saleId, "Product sale was voided.");
    }
    if (sale.accounting_status === "not_required") {
      await markAccounting(admin, orgId, "sale", saleId, "not_required", {
        amounts: { sale_total: 0, inventory_cost: 0 },
      });
      return { success: true, status: "not_required" };
    }
    if (sale.accounting_journal_entry_id) {
      const journalEntryId = String(sale.accounting_journal_entry_id);
      const { data: existingJournal, error: existingJournalError } = await db(admin)
        .from("accounting_journal_entries")
        .select("status")
        .eq("organization_id", orgId)
        .eq("id", journalEntryId)
        .maybeSingle();
      if (existingJournalError) throw new Error(existingJournalError.message);
      const existingStatus = existingJournal?.status === "posted"
        ? "posted" as const
        : "pending_approval" as const;
      await markAccounting(admin, orgId, "sale", saleId, existingStatus, {
        journalEntryId,
      });
      if (sale.accounting_status !== "not_required") {
        await recordProductCommissionAccrual(
          admin,
          orgId,
          saleId,
          journalEntryId
        );
      }
      return {
        success: true,
        status: existingStatus,
        journalEntryId,
      };
    }

    const settings = await getAccountingSettings(admin, orgId) as InventoryAccountingSettings | null;
    if (!settings?.default_agent_receivable_id) {
      throw new Error("Product agent receivables account is required.");
    }
    if (Number(sale.vat_amount || 0) > 0 && !settings.default_vat_payable_id) {
      throw new Error("VAT payable account is required for taxable product sales.");
    }

    const total = roundMoney(sale.total_amount);
    const net = roundMoney(sale.subtotal);
    const vat = roundMoney(sale.vat_amount);
    const accountingSaleLines: ProductSaleAccountingLine[] = [];
    for (const rawLine of (sale.lines || []) as Array<Record<string, unknown>>) {
      const line = rawLine;
      const revenueAccount = String(
        line.revenue_account_id || settings.default_sales_revenue_id || ""
      );
      const cogsAccount = String(
        line.cogs_account_id || settings.default_inventory_cogs_id || ""
      );
      const inventoryAccount = String(
        line.inventory_account_id || settings.default_inventory_asset_id || ""
      );
      if (!revenueAccount || !cogsAccount || !inventoryAccount) {
        throw new Error("Revenue, COGS, and inventory accounts are required for every sale line.");
      }
      accountingSaleLines.push({
        revenueAccountId: revenueAccount,
        cogsAccountId: cogsAccount,
        inventoryAccountId: inventoryAccount,
        netAmount: Number(line.net_amount || 0),
        cost: Number(line.unit_cost_snapshot || 0),
        commission: Number(line.agent_commission_amount || 0),
      });
    }
    const requestedCommission = roundMoney(
      accountingSaleLines.reduce((sum, line) => sum + line.commission, 0)
    );
    if (settings.enable_product_agent_commissions && requestedCommission > 0) {
      if (!settings.default_commission_expense_id || !settings.default_commission_payable_id) {
        throw new Error("Commission expense and payable accounts are required when product commissions are enabled.");
      }
    }
    const salePosting = buildProductSaleAccountingLines({
      reference: String(sale.sale_no),
      receivableAccountId: String(settings.default_agent_receivable_id),
      vatPayableAccountId: settings.default_vat_payable_id
        ? String(settings.default_vat_payable_id)
        : undefined,
      total,
      vat,
      saleLines: accountingSaleLines,
      accrueCommission: Boolean(settings.enable_product_agent_commissions),
      commissionExpenseAccountId: settings.default_commission_expense_id
        ? String(settings.default_commission_expense_id)
        : undefined,
      commissionPayableAccountId: settings.default_commission_payable_id
        ? String(settings.default_commission_payable_id)
        : undefined,
    });
    const cost = salePosting.cost;
    const commission = salePosting.commission;
    if (total <= 0 || net < 0 || cost <= 0) {
      throw new Error("Sale total and serialized unit cost must be valid before posting.");
    }
    if (Math.abs(salePosting.revenue - net) >= 0.01) {
      throw new Error("Sale-line revenue does not reconcile to the sale subtotal.");
    }

    const status = postingStatus(settings.auto_post_product_sales);
    const commandId = sourceUuid(`product-sale:${orgId}:${saleId}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: String(sale.sale_date),
      description: `Product sale ${sale.sale_no}`,
      sourceModule: "product_inventory_sale",
      sourceId: saleId,
      status,
      lines: salePosting.lines,
      commandId,
      requestId: commandId,
    });
    await markAccounting(admin, orgId, "sale", saleId, status, {
      journalEntryId: String(entry.id),
      amounts: {
        sale_total: total,
        revenue: net,
        output_vat: vat,
        inventory_cost: cost,
        commission: settings.enable_product_agent_commissions ? commission : 0,
      },
    });
    if (settings.enable_product_agent_commissions && commission > 0) {
      await recordProductCommissionAccrual(admin, orgId, saleId, String(entry.id));
    }
    return { success: true, status, journalEntryId: String(entry.id) };
  } catch (error) {
    return failPosting(admin, orgId, "sale", saleId, error);
  }
}

export async function autoReverseProductSale(
  admin: AdminClient,
  orgId: string,
  userId: string,
  saleId: string,
  reason: string
): Promise<ProductInventoryPostingResult> {
  try {
    const { data: sale, error } = await db(admin)
      .from("agent_product_sales")
      .select("id, status, accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id")
      .eq("organization_id", orgId)
      .eq("id", saleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sale || sale.status !== "voided") {
      throw new Error("Only a voided product sale can be reversed.");
    }
    if (sale.accounting_reversal_entry_id) {
      return {
        success: true,
        status: "reversed",
        reversalEntryId: String(sale.accounting_reversal_entry_id),
      };
    }
    if (!sale.accounting_journal_entry_id || sale.accounting_status === "not_required") {
      await markAccounting(admin, orgId, "sale", saleId, sale.accounting_status === "not_required" ? "not_required" : "reversed");
      if (sale.accounting_status !== "not_required") {
        await reverseProductCommissions(admin, orgId, saleId);
      }
      return {
        success: true,
        status: sale.accounting_status === "not_required" ? "not_required" : "reversed",
      };
    }

    const journalId = String(sale.accounting_journal_entry_id);
    const { data: journal, error: journalError } = await db(admin)
      .from("accounting_journal_entries")
      .select("id, status, version")
      .eq("organization_id", orgId)
      .eq("id", journalId)
      .maybeSingle();
    if (journalError) throw new Error(journalError.message);
    if (!journal) throw new Error("The product sale journal was not found.");

    if (journal.status === "posted") {
      const commandId = sourceUuid(`product-sale-reversal:${orgId}:${saleId}`);
      const reversal = await reverseJournalEntry(
        admin,
        orgId,
        journalId,
        userId,
        reason,
        { commandId, requestId: commandId, expectedVersion: Number(journal.version || 0) }
      );
      await markAccounting(admin, orgId, "sale", saleId, "reversed", {
        journalEntryId: journalId,
        reversalEntryId: String(reversal.id),
      });
      await reverseProductCommissions(admin, orgId, saleId);
      return {
        success: true,
        status: "reversed",
        journalEntryId: journalId,
        reversalEntryId: String(reversal.id),
      };
    }
    if (journal.status === "draft" || journal.status === "pending_approval") {
      const commandId = sourceUuid(`product-sale-cancel:${orgId}:${saleId}`);
      await cancelJournalEntry(admin, orgId, journalId, userId, {
        commandId,
        requestId: commandId,
        expectedVersion: Number(journal.version || 0),
      });
      await markAccounting(admin, orgId, "sale", saleId, "reversed", {
        journalEntryId: journalId,
      });
      await reverseProductCommissions(admin, orgId, saleId);
      return { success: true, status: "reversed", journalEntryId: journalId };
    }
    if (journal.status === "reversed" || journal.status === "cancelled") {
      await markAccounting(admin, orgId, "sale", saleId, "reversed", {
        journalEntryId: journalId,
      });
      await reverseProductCommissions(admin, orgId, saleId);
      return { success: true, status: "reversed", journalEntryId: journalId };
    }
    throw new Error(`Product sale journal cannot be reversed from status ${journal.status}.`);
  } catch (error) {
    return failPosting(admin, orgId, "sale", saleId, error);
  }
}

export async function autoPostProductCollection(
  admin: AdminClient,
  orgId: string,
  userId: string,
  collectionId: string
): Promise<ProductInventoryPostingResult> {
  try {
    const { data: collection, error } = await db(admin)
      .from("agent_product_collections")
      .select("id, collection_no, agent_id, amount, payment_method, collection_date, status, accounting_status, accounting_journal_entry_id")
      .eq("organization_id", orgId)
      .eq("id", collectionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!collection || collection.status !== "posted") {
      throw new Error("Only a posted product-agent collection can be recognized.");
    }
    if (collection.accounting_journal_entry_id) {
      return {
        success: true,
        status: collection.accounting_status,
        journalEntryId: String(collection.accounting_journal_entry_id),
      };
    }
    const { data: unallocatedConsignmentSale, error: consignmentError } = await db(admin)
      .from("agent_product_sales")
      .select("id")
      .eq("organization_id", orgId)
      .eq("agent_id", collection.agent_id)
      .eq("status", "active")
      .eq("accounting_status", "not_required")
      .limit(1)
      .maybeSingle();
    if (consignmentError) throw new Error(consignmentError.message);
    if (unallocatedConsignmentSale) {
      throw new Error(
        "Agent collections cannot be auto-posted while the agent has unallocated consignment sales."
      );
    }
    const settings = await getAccountingSettings(admin, orgId) as InventoryAccountingSettings | null;
    const receiptAccount = collection.payment_method === "cash"
      ? settings?.default_cash_account_id
      : settings?.default_bank_account_id;
    if (!receiptAccount || !settings?.default_agent_receivable_id) {
      throw new Error("Cash/bank and product-agent receivable accounts are required.");
    }
    const amount = roundMoney(collection.amount);
    if (amount <= 0) throw new Error("Collection amount must be positive.");

    const status = postingStatus(settings.auto_post_product_collections);
    const commandId = sourceUuid(`product-collection:${orgId}:${collectionId}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: String(collection.collection_date),
      description: `Product agent collection ${collection.collection_no}`,
      sourceModule: "product_inventory_collection",
      sourceId: collectionId,
      status,
      lines: buildProductCollectionAccountingLines({
        reference: String(collection.collection_no),
        receiptAccountId: String(receiptAccount),
        receivableAccountId: String(settings.default_agent_receivable_id),
        amount,
      }),
      commandId,
      requestId: commandId,
    });
    await markAccounting(admin, orgId, "collection", collectionId, status, {
      journalEntryId: String(entry.id),
      amounts: { collection: amount, agent_receivable_settled: amount },
    });
    return { success: true, status, journalEntryId: String(entry.id) };
  } catch (error) {
    return failPosting(admin, orgId, "collection", collectionId, error);
  }
}

export async function autoPostProductInventoryLoss(
  admin: AdminClient,
  orgId: string,
  userId: string,
  lossId: string
): Promise<ProductInventoryPostingResult> {
  try {
    const { data: loss, error } = await db(admin)
      .from("product_inventory_loss_records")
      .select("id, loss_type, recorded_at, status, ownership_type, unit_cost_snapshot, accounting_status, accounting_journal_entry_id")
      .eq("organization_id", orgId)
      .eq("id", lossId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!loss || loss.status !== "recorded") throw new Error("Inventory loss record was not found.");
    if (loss.accounting_journal_entry_id) {
      return {
        success: true,
        status: loss.accounting_status,
        journalEntryId: String(loss.accounting_journal_entry_id),
      };
    }
    if (loss.ownership_type === "consignment") {
      await markAccounting(admin, orgId, "loss", lossId, "not_required", {
        amounts: { inventory_cost: 0 },
      });
      return { success: true, status: "not_required" };
    }
    const settings = await getAccountingSettings(admin, orgId) as InventoryAccountingSettings | null;
    if (!settings?.default_inventory_asset_id || !settings.default_inventory_shrinkage_id) {
      throw new Error("Inventory asset and shrinkage accounts are required for loss posting.");
    }
    const cost = roundMoney(loss.unit_cost_snapshot);
    if (cost <= 0) throw new Error("Inventory loss snapshot cost must be positive.");

    const commandId = sourceUuid(`product-loss:${orgId}:${lossId}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: String(loss.recorded_at).slice(0, 10),
      description: `Product inventory ${loss.loss_type} ${lossId}`,
      sourceModule: "product_inventory_loss",
      sourceId: lossId,
      status: "posted",
      lines: buildProductLossAccountingLines({
        reference: lossId,
        shrinkageAccountId: String(settings.default_inventory_shrinkage_id),
        inventoryAccountId: String(settings.default_inventory_asset_id),
        cost,
      }),
      commandId,
      requestId: commandId,
    });
    await markAccounting(admin, orgId, "loss", lossId, "posted", {
      journalEntryId: String(entry.id),
      amounts: { inventory_cost: cost, shrinkage: cost },
    });
    return { success: true, status: "posted", journalEntryId: String(entry.id) };
  } catch (error) {
    return failPosting(admin, orgId, "loss", lossId, error);
  }
}

export async function retryProductInventoryPosting(
  admin: AdminClient,
  orgId: string,
  userId: string,
  sourceType: ProductInventoryAccountingSource,
  sourceId: string
) {
  if (sourceType === "receipt") {
    return autoPostProductReceipt(admin, orgId, userId, sourceId);
  }
  if (sourceType === "sale") {
    const { data: sale } = await db(admin)
      .from("agent_product_sales")
      .select("status")
      .eq("organization_id", orgId)
      .eq("id", sourceId)
      .maybeSingle();
    return sale?.status === "voided"
      ? autoReverseProductSale(admin, orgId, userId, sourceId, "Manual accounting retry after product sale void.")
      : autoPostProductSale(admin, orgId, userId, sourceId);
  }
  if (sourceType === "collection") {
    return autoPostProductCollection(admin, orgId, userId, sourceId);
  }
  return autoPostProductInventoryLoss(admin, orgId, userId, sourceId);
}
