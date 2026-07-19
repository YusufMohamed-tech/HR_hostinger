import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { postTransaction, type AccountingSettings, type AdminClient } from "@/lib/accounting/posting-engine";
import { getAccountingSettings } from "@/lib/accounting/posting";
import { roundMoney } from "@/lib/accounting/validation";

function accountingSourceUuid(scope: string) {
  const hash = createHash("sha256").update(scope).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
}

// =============================================================================
// Phase 1: Sales Revenue Auto-Recognition
// =============================================================================

interface SalesLogData {
  id: string;
  log_date: string;
  grand_total: number;
  vat_amount?: number;
  subtotal?: number;
  company_id?: string;
  items?: Array<{ product_name?: string; line_total?: number }>;
}

export async function autoPostSalesLog(
  admin: AdminClient,
  orgId: string,
  userId: string,
  salesLog: SalesLogData
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_sales) return { success: true };

    // Canonical customer lookup: sales_companies.accounting_customer_id first,
    // then fall back to accounting_customers.sales_company_id
    let customerName: string | undefined;
    if (salesLog.company_id) {
      const { data: company } = await (admin as any)
        .from("sales_companies")
        .select("accounting_customer_id, name")
        .eq("organization_id", orgId)
        .eq("id", salesLog.company_id)
        .maybeSingle();

      let customerId: string | undefined = company?.accounting_customer_id;
      if (!customerId) {
        const { data: customerRow } = await (admin as any)
          .from("accounting_customers")
          .select("id, name_ar, name_en")
          .eq("organization_id", orgId)
          .eq("sales_company_id", salesLog.company_id)
          .maybeSingle();
        customerId = customerRow?.id;
        if (customerRow) {
          customerName = String(customerRow.name_ar || customerRow.name_en || "");
        }
      }
      if (customerId && !customerName) {
        const { data: custRow } = await (admin as any)
          .from("accounting_customers")
          .select("name_ar, name_en")
          .eq("organization_id", orgId)
          .eq("id", customerId)
          .maybeSingle();
        customerName = custRow ? String(custRow.name_ar || custRow.name_en || "") : company?.name;
      }
    }

    // The sales log total is already the customer-facing total. VAT may only be
    // posted when it was explicitly captured by the originating transaction.
    const arTotal = roundMoney(salesLog.grand_total);
    const vatAmount = roundMoney(salesLog.vat_amount || 0);
    const commandId = accountingSourceUuid(`sales-revenue:${orgId}:${salesLog.id}`);

    const result = await postTransaction(admin, orgId, userId, "sales_revenue", {
      id: salesLog.id,
      log_date: salesLog.log_date,
      grand_total: arTotal,
      vat_amount: vatAmount,
      customer_name: customerName,
    }, {
      entryDate: salesLog.log_date,
      status: "posted",
      sourceId: salesLog.id,
      commandId,
      requestId: commandId,
    });

    return { success: true, journalEntryId: result.journalEntryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-posting failed";
    await logAutoPostFailure(admin, orgId, "sales_log", salesLog.id, message);
    return { success: false, error: message };
  }
}

export async function autoPostSalesLogRevision(
  admin: AdminClient,
  orgId: string,
  userId: string,
  revisionId: string,
  options: { commandId: string; requestId: string }
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const { data: revision, error } = await (admin as any).from("sales_log_revisions")
      .select("id, sales_log_id, event_type, grand_total, accounting_status, accounting_journal_entry_id, sales_log:sales_log_id(log_date, current_revision_id, status)")
      .eq("organization_id", orgId).eq("id", revisionId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!revision) throw new Error("Sales log revision was not found for accounting posting.");
    if (revision.accounting_journal_entry_id) {
      return { success: true, journalEntryId: String(revision.accounting_journal_entry_id) };
    }
    const salesLog = Array.isArray(revision.sales_log) ? revision.sales_log[0] : revision.sales_log;
    if (revision.event_type === "void" || revision.accounting_status !== "pending"
      || String(salesLog?.current_revision_id || "") !== revisionId || salesLog?.status === "voided") {
      return { success: true };
    }
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_sales) return { success: true };
    if (!settings.default_accounts_receivable_id || !settings.default_sales_revenue_id) {
      throw new Error("Sales receivable and revenue accounts are required before sales logs can be posted.");
    }
    const total = roundMoney(revision.grand_total);
    if (total <= 0) throw new Error("Sales log revision total must be positive before accounting posting.");
    const { createJournalEntry, reverseJournalEntry } = await import("@/lib/accounting/posting");
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: String(salesLog?.log_date || new Date().toISOString().slice(0, 10)),
      description: `Sales log revision ${revisionId}`,
      sourceModule: "sales_log_revision",
      sourceId: revisionId,
      status: "posted",
      lines: [
        { account_id: settings.default_accounts_receivable_id, debit: total, credit: 0, description: `Sales receivable ${revision.sales_log_id}` },
        { account_id: settings.default_sales_revenue_id, debit: 0, credit: total, description: `Sales revenue ${revision.sales_log_id}` },
      ],
      commandId: options.commandId,
      requestId: options.requestId,
    });
    const { data: updated, error: updateError } = await (admin as any).from("sales_log_revisions")
      .update({ accounting_status: "posted", accounting_journal_entry_id: entry.id })
      .eq("organization_id", orgId).eq("id", revisionId).eq("accounting_status", "pending")
      .select("id").maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) {
      const reversal = await reverseJournalEntry(
        admin, orgId, String(entry.id), userId,
        "Sales log changed while its accounting event was being posted.",
        { commandId: accountingSourceUuid(`${options.commandId}:race-reversal`), requestId: options.requestId }
      );
      const { error: reversalLinkError } = await (admin as any).from("sales_log_revisions").update({
        accounting_status: "reversed",
        accounting_journal_entry_id: entry.id,
        accounting_reversal_entry_id: reversal.id,
      }).eq("organization_id", orgId).eq("id", revisionId);
      if (reversalLinkError) throw new Error(reversalLinkError.message);
    }
    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sales log revision posting failed";
    await (admin as any).from("sales_log_revisions").update({ accounting_status: "failed" })
      .eq("organization_id", orgId).eq("id", revisionId).eq("accounting_status", "pending");
    await logAutoPostFailure(admin, orgId, "sales_log_revision", revisionId, message);
    return { success: false, error: message };
  }
}

export async function autoReverseSalesLogRevision(
  admin: AdminClient,
  orgId: string,
  userId: string,
  revisionId: string,
  reason: string,
  options: { commandId: string; requestId: string }
): Promise<{ success: boolean; reversalEntryId?: string; error?: string }> {
  try {
    const { data: revision, error } = await (admin as any).from("sales_log_revisions")
      .select("accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id")
      .eq("organization_id", orgId).eq("id", revisionId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!revision) throw new Error("Sales log revision was not found for accounting reversal.");
    if (revision.accounting_reversal_entry_id) {
      return { success: true, reversalEntryId: String(revision.accounting_reversal_entry_id) };
    }
    if (!revision.accounting_journal_entry_id) {
      const { error: statusError } = await (admin as any).from("sales_log_revisions").update({ accounting_status: "reversed" })
        .eq("organization_id", orgId).eq("id", revisionId);
      if (statusError) throw new Error(statusError.message);
      return { success: true };
    }
    const { reverseJournalEntry } = await import("@/lib/accounting/posting");
    const reversal = await reverseJournalEntry(
      admin, orgId, String(revision.accounting_journal_entry_id), userId, reason, options
    );
    const { error: updateError } = await (admin as any).from("sales_log_revisions").update({
      accounting_status: "reversed",
      accounting_reversal_entry_id: reversal.id,
    }).eq("organization_id", orgId).eq("id", revisionId);
    if (updateError) throw new Error(updateError.message);
    return { success: true, reversalEntryId: String(reversal.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sales log revision reversal failed";
    await logAutoPostFailure(admin, orgId, "sales_log_revision_reversal", revisionId, message);
    return { success: false, error: message };
  }
}

export async function autoPostSimSale(
  admin: AdminClient,
  orgId: string,
  userId: string,
  saleId: string,
  options: { commandId: string; requestId: string }
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const { data: sale, error } = await (admin as any).from("sim_sales")
      .select("id, status, sold_at, sale_price, agent_commission_amount, merchant_commission_amount, accounting_status, accounting_journal_entry_id")
      .eq("organization_id", orgId).eq("id", saleId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sale) throw new Error("SIM sale was not found for accounting posting.");
    if (sale.accounting_journal_entry_id) {
      return { success: true, journalEntryId: String(sale.accounting_journal_entry_id) };
    }
    if (sale.status !== "active") {
      const { error: statusError } = await (admin as any).from("sim_sales").update({ accounting_status: "reversed" })
        .eq("organization_id", orgId).eq("id", saleId).is("accounting_journal_entry_id", null);
      if (statusError) throw new Error(statusError.message);
      return { success: true };
    }
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    const commissionExpenseId = String(settings?.default_commission_expense_id || "");
    const commissionPayableId = String(settings?.default_commission_payable_id || "");
    if (!settings?.default_accounts_receivable_id || !settings.default_sales_revenue_id
      || !commissionExpenseId || !commissionPayableId) {
      throw new Error("SIM sales receivable, revenue, commission expense, and commission payable accounts are required.");
    }
    const salePrice = roundMoney(sale.sale_price);
    const commission = roundMoney(Number(sale.agent_commission_amount || 0) + Number(sale.merchant_commission_amount || 0));
    if (salePrice <= 0) throw new Error("SIM sale amount must be positive before accounting posting.");
    const lines = [
      { account_id: settings.default_accounts_receivable_id, debit: salePrice, credit: 0, description: `SIM sale ${saleId}` },
      { account_id: settings.default_sales_revenue_id, debit: 0, credit: salePrice, description: `SIM sale revenue ${saleId}` },
    ];
    if (commission > 0) {
      lines.push(
        { account_id: commissionExpenseId, debit: commission, credit: 0, description: `SIM commission accrual ${saleId}` },
        { account_id: commissionPayableId, debit: 0, credit: commission, description: `SIM commission payable ${saleId}` }
      );
    }
    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: String(sale.sold_at).slice(0, 10),
      description: `SIM sale and commission accrual ${saleId}`,
      sourceModule: "sim_sale",
      sourceId: saleId,
      status: "posted",
      lines,
      commandId: options.commandId,
      requestId: options.requestId,
    });
    const { data: updated, error: updateError } = await (admin as any).from("sim_sales")
      .update({ accounting_status: "posted", accounting_journal_entry_id: entry.id })
      .eq("organization_id", orgId).eq("id", saleId).eq("status", "active")
      .is("accounting_journal_entry_id", null).select("id").maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) {
      const { reverseJournalEntry } = await import("@/lib/accounting/posting");
      const reversal = await reverseJournalEntry(admin, orgId, String(entry.id), userId,
        "Sale was voided while its accounting event was being posted.", {
          commandId: accountingSourceUuid(`${options.commandId}:race-reversal`),
          requestId: options.requestId,
        });
      const { error: reversalLinkError } = await (admin as any).from("sim_sales").update({
        accounting_status: "reversed",
        accounting_journal_entry_id: entry.id,
        accounting_reversal_entry_id: reversal.id,
      }).eq("organization_id", orgId).eq("id", saleId);
      if (reversalLinkError) throw new Error(reversalLinkError.message);
    }
    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SIM sale auto-posting failed";
    await (admin as any).from("sim_sales").update({ accounting_status: "failed" })
      .eq("organization_id", orgId).eq("id", saleId).eq("status", "active");
    await logAutoPostFailure(admin, orgId, "sim_sale", saleId, message);
    return { success: false, error: message };
  }
}

export async function autoReverseSimSale(
  admin: AdminClient,
  orgId: string,
  userId: string,
  saleId: string,
  reason: string,
  options: { commandId: string; requestId: string }
): Promise<{ success: boolean; reversalEntryId?: string; error?: string }> {
  try {
    const { data: sale, error } = await (admin as any).from("sim_sales")
      .select("status, accounting_status, accounting_journal_entry_id, accounting_reversal_entry_id")
      .eq("organization_id", orgId).eq("id", saleId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sale || sale.status !== "voided") throw new Error("Only a voided SIM sale can be reversed in accounting.");
    if (sale.accounting_reversal_entry_id) {
      return { success: true, reversalEntryId: String(sale.accounting_reversal_entry_id) };
    }
    if (!sale.accounting_journal_entry_id) {
      const { error: statusError } = await (admin as any).from("sim_sales").update({ accounting_status: "reversed" })
        .eq("organization_id", orgId).eq("id", saleId);
      if (statusError) throw new Error(statusError.message);
      return { success: true };
    }
    const { reverseJournalEntry } = await import("@/lib/accounting/posting");
    const reversal = await reverseJournalEntry(admin, orgId, String(sale.accounting_journal_entry_id), userId, reason, options);
    const { error: updateError } = await (admin as any).from("sim_sales").update({
      accounting_status: "reversed",
      accounting_reversal_entry_id: reversal.id,
    }).eq("organization_id", orgId).eq("id", saleId);
    if (updateError) throw new Error(updateError.message);
    return { success: true, reversalEntryId: String(reversal.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SIM sale reversal failed";
    await logAutoPostFailure(admin, orgId, "sim_sale_void", saleId, message);
    return { success: false, error: message };
  }
}

export async function autoPostSalesCashCollection(
  admin: AdminClient,
  orgId: string,
  userId: string,
  collection: {
    collection_id: string;
    collection_type: "agent" | "merchant";
    amount: number;
    payment_method: string;
    collection_date: string;
  },
  options: { commandId: string; requestId: string }
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    const receiptAccount = collection.payment_method === "cash"
      ? settings?.default_cash_account_id
      : settings?.default_bank_account_id;
    if (!receiptAccount || !settings?.default_accounts_receivable_id) {
      throw new Error("Cash/bank and accounts-receivable accounts are required before sales collections can be posted.");
    }
    const amount = roundMoney(collection.amount);
    if (amount <= 0) throw new Error("Sales cash collection amount must be positive.");
    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: collection.collection_date,
      description: `${collection.collection_type === "agent" ? "Agent" : "Merchant"} cash collection ${collection.collection_id}`,
      sourceModule: "sales_cash_collection",
      sourceId: collection.collection_id,
      status: "posted",
      lines: [
        { account_id: receiptAccount, debit: amount, credit: 0, description: `Sales cash received ${collection.collection_id}` },
        { account_id: settings.default_accounts_receivable_id, debit: 0, credit: amount, description: `Sales receivable settled ${collection.collection_id}` },
      ],
      commandId: options.commandId,
      requestId: options.requestId,
    });
    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sales cash accounting posting failed";
    await logAutoPostFailure(admin, orgId, "sales_cash_collection", collection.collection_id, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Phase 2: Payroll Full Auto-Posting
// =============================================================================

interface PayrollSummary {
  month: string;
  total_base_salary: number;
  total_allowances: number;
  total_deductions: number;
  total_net: number;
  advance_deductions: number;
  employer_gosi: number;
  employee_gosi: number;
  department_breakdown?: Array<{
    department_id: string;
    department_name: string;
    amount: number;
  }>;
}

export async function autoPostPayrollMonth(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string,
  options?: { commandId?: string; requestId?: string }
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_payroll) return { success: true };
    if (!settings.default_salary_expense_id || !settings.default_salary_payable_id
      || !settings.default_gosi_expense_id || !settings.default_gosi_payable_id) {
      throw new Error("أكمل حسابات الرواتب والتأمينات قبل الترحيل التلقائي.");
    }

    const { data: run, error } = await (admin as any)
      .from("payroll_runs")
      .select("*")
      .eq("org_id", orgId)
      .eq("month", `${month}-01`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run || run.status !== "approved" || run.formula_version !== "sa-payroll-v1") {
      throw new Error("يجب اعتماد مسير رواتب مكتمل بالصيغة الحالية قبل الترحيل.");
    }

    const { data: payslips, error: payslipError } = await (admin as any)
      .from("payslips")
      .select("advance_deduction")
      .eq("org_id", orgId)
      .eq("payroll_run_id", run.id)
      .eq("status", "approved");
    if (payslipError) throw new Error(payslipError.message);
    const advanceDeductions = roundMoney(((payslips || []) as Record<string, unknown>[])
      .reduce((sum, slip) => sum + Number(slip.advance_deduction || 0), 0));
    if (advanceDeductions > 0 && !settings.default_employee_advances_id) {
      throw new Error("حساب سلف الموظفين مطلوب قبل ترحيل خصومات السلف.");
    }

    const totalNet = roundMoney(run.total_net);
    const employeeGosi = roundMoney(run.total_employee_gosi);
    const employerGosi = roundMoney(run.total_employer_gosi);
    const lines = [
      { account_id: settings.default_salary_expense_id, debit: roundMoney(totalNet + employeeGosi + advanceDeductions), credit: 0, description: `رواتب ${month}` },
      { account_id: settings.default_salary_payable_id, debit: 0, credit: totalNet, description: `رواتب مستحقة ${month}` },
    ];
    if (employerGosi > 0) lines.push({ account_id: settings.default_gosi_expense_id, debit: employerGosi, credit: 0, description: `تأمينات صاحب العمل ${month}` });
    if (employeeGosi + employerGosi > 0) lines.push({ account_id: settings.default_gosi_payable_id, debit: 0, credit: roundMoney(employeeGosi + employerGosi), description: `تأمينات مستحقة ${month}` });
    if (advanceDeductions > 0) lines.push({ account_id: settings.default_employee_advances_id!, debit: 0, credit: advanceDeductions, description: `خصم سلف ${month}` });

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const commandId = options?.commandId || accountingSourceUuid(`payroll:${orgId}:${run.id}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: lastDayOfMonth(month),
      description: `قيد رواتب ${month}`,
      sourceModule: "payroll",
      sourceId: String(run.id),
      status: "posted",
      lines,
      commandId,
      requestId: options?.requestId || commandId,
    });
    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payroll auto-posting failed";
    await logAutoPostFailure(admin, orgId, "payroll", month, message);
    return { success: false, error: message };
  }
}


// =============================================================================
// Phase 3: Employee Advance Auto-Posting
// =============================================================================

interface AdvanceData {
  id: string;
  employee_id: string;
  employee_name?: string;
  approved_amount: number;
}

export async function autoPostAdvanceDisbursement(
  admin: AdminClient,
  orgId: string,
  userId: string,
  advanceRequest: AdvanceData
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_advances) return { success: true };
    const commandId = accountingSourceUuid(`advance-disbursement:${orgId}:${advanceRequest.id}`);

    const result = await postTransaction(admin, orgId, userId, "advance_disbursement", {
      id: advanceRequest.id,
      employee_name: advanceRequest.employee_name || "موظف",
      amount: advanceRequest.approved_amount,
    }, {
      entryDate: new Date().toISOString().slice(0, 10),
      status: "posted",
      sourceId: advanceRequest.id,
      commandId,
      requestId: commandId,
    });

    const { error: linkError } = await (admin as any)
      .from("advance_requests")
      .update({ journal_entry_id: result.journalEntryId })
      .eq("organization_id", orgId)
      .eq("id", advanceRequest.id);
    if (linkError) throw new Error(`Advance journal linkage failed: ${linkError.message}`);

    return { success: true, journalEntryId: result.journalEntryId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Advance auto-posting failed";
    await logAutoPostFailure(admin, orgId, "advance", advanceRequest.id, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Phase 4: Asset Capitalization & Depreciation
// =============================================================================

interface AssetData {
  id: string;
  asset_name: string;
  purchase_price: number;
  paid_immediately?: boolean;
  command_id?: string;
  request_id?: string;
}

export async function autoCapitalizeAsset(
  admin: AdminClient,
  orgId: string,
  userId: string,
  asset: AssetData
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as AccountingSettings | null;
    if (!settings?.auto_post_assets) return { success: true };

    if (!settings.default_asset_account_id) {
      throw new Error("حساب الأصول الثابتة غير محدد.");
    }

    const creditAccountId = asset.paid_immediately
      ? (settings.default_bank_account_id || settings.default_cash_account_id)
      : settings.default_accounts_payable_id;

    if (!creditAccountId) {
      throw new Error("حساب الدفع غير محدد (بنك أو ذمم دائنة).");
    }

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const commandId = asset.command_id || accountingSourceUuid(`asset-capitalization:${orgId}:${asset.id}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `رسملة أصل: ${asset.asset_name}`,
      sourceModule: "asset_capitalization",
      sourceId: asset.id,
      status: "posted",
      commandId,
      requestId: asset.request_id || commandId,
      lines: [
        {
          account_id: settings.default_asset_account_id,
          debit: asset.purchase_price,
          credit: 0,
          description: `شراء أصل: ${asset.asset_name}`,
        },
        {
          account_id: creditAccountId,
          debit: 0,
          credit: asset.purchase_price,
          description: `دفع ثمن أصل: ${asset.asset_name}`,
        },
      ],
    });

    const { error: linkError } = await (admin as any)
      .from("asset_inventory")
      .update({ capitalized_journal_id: entry.id })
      .eq("org_id", orgId)
      .eq("id", asset.id);
    if (linkError) throw new Error(`Asset capitalization linkage failed: ${linkError.message}`);

    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset capitalization failed";
    await logAutoPostFailure(admin, orgId, "asset_capitalization", asset.id, message);
    return { success: false, error: message };
  }
}

export async function runMonthlyDepreciation(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string
): Promise<{ success: boolean; journalEntryId?: string; assetsProcessed: number; error?: string }> {
  try {
    const { data, error } = await (admin as any).rpc("run_asset_depreciation", {
      p_org_id: orgId,
      p_actor_user_id: userId,
      p_request_id: randomUUID(),
      p_command_id: randomUUID(),
      p_month: `${month}-01`,
    });
    if (error) throw new Error(error.message);
    const result = (data || {}) as Record<string, unknown>;
    return {
      success: true,
      journalEntryId: result.journalEntryId ? String(result.journalEntryId) : undefined,
      assetsProcessed: Number(result.assetsProcessed || 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Depreciation batch failed";
    await logAutoPostFailure(admin, orgId, "asset_depreciation", `depreciation-${month}`, message);
    return { success: false, assetsProcessed: 0, error: message };
  }
}

// =============================================================================
// Phase 5: End of Service Benefits (EOSB)
// =============================================================================

export function calculateEOSB(
  baseSalary: number,
  yearsOfService: number,
  terminationType: "resignation" | "termination" | "end_of_contract"
): number {
  const dailyRate = baseSalary / 30;
  let totalDays = 0;

  if (yearsOfService <= 5) {
    totalDays = yearsOfService * 15;
  } else {
    totalDays = (5 * 15) + ((yearsOfService - 5) * 30);
  }

  if (terminationType === "resignation") {
    if (yearsOfService < 2) return 0;
    if (yearsOfService < 5) totalDays = totalDays * (1 / 3);
    else if (yearsOfService < 10) totalDays = totalDays * (2 / 3);
  }

  return roundMoney(totalDays * dailyRate);
}

export async function runMonthlyEOSBAccrual(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string,
  options?: { commandId?: string; requestId?: string }
): Promise<{ success: boolean; journalEntryId?: string; employeesProcessed: number; error?: string }> {
  try {
    const commandId = options?.commandId || accountingSourceUuid(`eosb-accrual:${orgId}:${month}`);
    const { data, error } = await (admin as any).rpc("run_eosb_accrual", {
      p_org_id: orgId,
      p_actor_user_id: userId,
      p_request_id: options?.requestId || commandId,
      p_command_id: commandId,
      p_month: `${month}-01`,
    });
    if (error) throw new Error(error.message);
    const result = (data || {}) as Record<string, unknown>;
    return {
      success: true,
      journalEntryId: result.journalEntryId ? String(result.journalEntryId) : undefined,
      employeesProcessed: Number(result.employeesProcessed || 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "EOSB accrual failed";
    await logAutoPostFailure(admin, orgId, "eosb", `eosb-accrual-${month}`, message);
    return { success: false, employeesProcessed: 0, error: message };
  }
}

export async function settleEmployeeEOSB(
  admin: AdminClient,
  orgId: string,
  userId: string,
  employeeId: string
): Promise<{ success: boolean; journalEntryId?: string; settlementAmount: number; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_eosb_expense_id?: string; default_eosb_provision_id?: string }) | null;
    if (!settings) throw new Error("إعدادات المحاسبة غير موجودة.");

    if (!settings.default_eosb_expense_id || !settings.default_eosb_provision_id) {
      throw new Error("حسابات مكافأة نهاية الخدمة غير محددة.");
    }

    const bankAccount = settings.default_bank_account_id || settings.default_cash_account_id;
    if (!bankAccount) throw new Error("حساب البنك غير محدد.");

    const { data: employee, error: empErr } = await (admin as any)
      .from("employees")
      .select("id, full_name, base_salary, hiring_date, termination_date, termination_type")
      .eq("org_id", orgId)
      .eq("id", employeeId)
      .maybeSingle();

    if (empErr) throw new Error(empErr.message);
    if (!employee) throw new Error("الموظف غير موجود.");

    const emp = employee as Record<string, unknown>;
    const baseSalary = Number(emp.base_salary || 0);
    const hireDate = new Date(String(emp.hiring_date));
    const terminationDate = emp.termination_date ? new Date(String(emp.termination_date)) : new Date();
    const yearsOfService = (terminationDate.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const terminationType = (String(emp.termination_type || "termination")) as "resignation" | "termination" | "end_of_contract";

    const settlementAmount = calculateEOSB(baseSalary, yearsOfService, terminationType);
    if (settlementAmount <= 0) return { success: true, settlementAmount: 0 };

    const { data: accruals } = await (admin as any)
      .from("eosb_accruals")
      .select("cumulative_accrual")
      .eq("organization_id", orgId)
      .eq("employee_id", employeeId)
      .order("month", { ascending: false })
      .limit(1);

    const accruedAmount = roundMoney(Number((accruals as any[])?.[0]?.cumulative_accrual || 0));
    const difference = roundMoney(settlementAmount - accruedAmount);

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const commandId = accountingSourceUuid(`eosb-settlement:${orgId}:${employeeId}`);
    const lines: Array<{ account_id: string; debit: number; credit: number; description: string; employee_id?: string }> = [];

    if (accruedAmount > 0) {
      // Debit provision for the full accrued amount (clear it entirely)
      lines.push({
        account_id: settings.default_eosb_provision_id,
        debit: accruedAmount,
        credit: 0,
        description: `تسوية مخصص نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    }

    if (difference > 0) {
      // Settlement exceeds accrued: expense the shortfall
      lines.push({
        account_id: settings.default_eosb_expense_id,
        debit: difference,
        credit: 0,
        description: `فرق مكافأة نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    } else if (difference < 0) {
      // Over-accrued: credit back the surplus to EOSB expense
      lines.push({
        account_id: settings.default_eosb_expense_id,
        debit: 0,
        credit: roundMoney(Math.abs(difference)),
        description: `إعادة فائض مخصص نهاية خدمة ${emp.full_name}`,
        employee_id: employeeId,
      });
    }

    // CR: Bank — the actual cash paid out
    lines.push({
      account_id: bankAccount,
      debit: 0,
      credit: settlementAmount,
      description: `صرف مكافأة نهاية خدمة ${emp.full_name}`,
      employee_id: employeeId,
    });

    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `تسوية مكافأة نهاية خدمة ${emp.full_name}`,
      sourceModule: "eosb_settlement",
      sourceId: employeeId,
      status: "posted",
      lines,
      commandId,
      requestId: commandId,
    });

    return { success: true, journalEntryId: String(entry.id), settlementAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "EOSB settlement failed";
    await logAutoPostFailure(admin, orgId, "eosb_settlement", employeeId, message);
    return { success: false, settlementAmount: 0, error: message };
  }
}

// =============================================================================
// Phase 6: Leave Encashment
// =============================================================================

export async function calculateAndPostLeaveEncashment(
  admin: AdminClient,
  orgId: string,
  userId: string,
  employeeId: string
): Promise<{ success: boolean; journalEntryId?: string; encashmentAmount: number; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_leave_encashment_id?: string }) | null;
    if (!settings) throw new Error("إعدادات المحاسبة غير موجودة.");

    // Use dedicated leave encashment account; no silent fallback to salary expense
    const leaveEncashmentAccount = settings.default_leave_encashment_id;
    if (!leaveEncashmentAccount) throw new Error("حساب تعويض الإجازات (5040) غير محدد في إعدادات المحاسبة.");
    if (!settings.default_salary_payable_id) throw new Error("حساب الرواتب المستحقة غير محدد.");

    const [empResult, leaveResult] = await Promise.all([
      (admin as any)
        .from("employees")
        .select("id, full_name, base_salary")
        .eq("org_id", orgId)
        .eq("id", employeeId)
        .maybeSingle(),
      (admin as any)
        .from("leave_balances")
        .select("vacation_remaining")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .maybeSingle(),
    ]);

    if (empResult.error) throw new Error(empResult.error.message);
    if (!empResult.data) throw new Error("الموظف غير موجود.");

    const emp = empResult.data as Record<string, unknown>;
    const baseSalary = Number(emp.base_salary || 0);
    const vacationDays = Number(leaveResult.data?.vacation_remaining || 0);

    if (vacationDays <= 0 || baseSalary <= 0) return { success: true, encashmentAmount: 0 };

    const encashmentAmount = roundMoney(vacationDays * (baseSalary / 30));

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const commandId = accountingSourceUuid(`leave-encashment:${orgId}:${employeeId}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `تعويض إجازات ${emp.full_name} (${vacationDays} يوم)`,
      sourceModule: "leave_encashment",
      sourceId: employeeId,
      status: "posted",
      commandId,
      requestId: commandId,
      lines: [
        {
          account_id: leaveEncashmentAccount,
          debit: encashmentAmount,
          credit: 0,
          description: `تعويض إجازات ${emp.full_name}`,
          employee_id: employeeId,
        },
        {
          account_id: settings.default_salary_payable_id,
          debit: 0,
          credit: encashmentAmount,
          description: `تعويض إجازات مستحق ${emp.full_name}`,
          employee_id: employeeId,
        },
      ],
    });

    return { success: true, journalEntryId: String(entry.id), encashmentAmount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Leave encashment failed";
    await logAutoPostFailure(admin, orgId, "leave_encashment", employeeId, message);
    return { success: false, encashmentAmount: 0, error: message };
  }
}

// =============================================================================
// Phase 7: GOSI Payment Recording
// =============================================================================

export async function recordGOSIPayment(
  admin: AdminClient,
  orgId: string,
  userId: string,
  month: string,
  totalAmount: number
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const settings = (await getAccountingSettings(admin, orgId)) as (AccountingSettings & { default_gosi_payable_id?: string }) | null;
    if (!settings) throw new Error("إعدادات المحاسبة غير موجودة.");

    const gosiPayableId = settings.default_gosi_payable_id;
    if (!gosiPayableId) throw new Error("حساب التأمينات الاجتماعية المستحقة غير محدد.");

    const bankAccount = settings.default_bank_account_id || settings.default_cash_account_id;
    if (!bankAccount) throw new Error("حساب البنك غير محدد.");

    const { createJournalEntry } = await import("@/lib/accounting/posting");
    const sourceId = accountingSourceUuid(`gosi-payment:${orgId}:${month}`);
    const entry = await createJournalEntry(admin, {
      orgId,
      userId,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `سداد تأمينات اجتماعية - ${month}`,
      sourceModule: "gosi_payment",
      sourceId,
      status: "posted",
      commandId: sourceId,
      requestId: sourceId,
      lines: [
        {
          account_id: gosiPayableId,
          debit: totalAmount,
          credit: 0,
          description: `سداد تأمينات ${month}`,
        },
        {
          account_id: bankAccount,
          debit: 0,
          credit: totalAmount,
          description: `سداد تأمينات ${month}`,
        },
      ],
    });

    return { success: true, journalEntryId: String(entry.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOSI payment posting failed";
    await logAutoPostFailure(admin, orgId, "gosi_payment", `gosi-payment-${month}`, message);
    return { success: false, error: message };
  }
}

// =============================================================================
// Utility: compute last calendar day of a YYYY-MM month
// =============================================================================

function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate(); // day 0 of next month = last day of this month
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

// =============================================================================
// Utility: Log Auto-Post Failure (non-blocking)
// =============================================================================

async function logAutoPostFailure(
  admin: AdminClient,
  orgId: string,
  sourceModule: string,
  sourceId: string,
  errorMessage: string
): Promise<void> {
  try {
    await (admin as any).from("operational_audit_logs").insert({
      org_id: orgId,
      request_id: randomUUID(),
      action: "accounting.auto_post_failed",
      target_type: sourceModule,
      target_id: sourceId,
      outcome: "failed",
      status_code: 500,
      error_code: "AUTO_POST_FAILED",
      metadata: { error: errorMessage },
    });
  } catch {
    // Silently ignore logging failures to not block the main flow
  }
}
