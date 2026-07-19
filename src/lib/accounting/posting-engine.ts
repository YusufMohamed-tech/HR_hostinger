import { createAdminClient } from "@/lib/supabase/admin";
import { createJournalEntry, getAccountingSettings } from "@/lib/accounting/posting";
import { roundMoney, type JournalLineInput } from "@/lib/accounting/validation";
import { invoiceTemplate } from "@/lib/accounting/templates/invoice";
import { expenseTemplate } from "@/lib/accounting/templates/expense";
import { payrollTemplate } from "@/lib/accounting/templates/payroll";
// PayrollSource shape changed — see templates/payroll.ts
import { paymentTemplate } from "@/lib/accounting/templates/payment";
import { advanceTemplate } from "@/lib/accounting/templates/advance";
import { salesTemplate } from "@/lib/accounting/templates/sales";

export type AdminClient = ReturnType<typeof createAdminClient>;

export interface AccountingSettings {
  default_cash_account_id?: string | null;
  default_bank_account_id?: string | null;
  default_accounts_receivable_id?: string | null;
  default_accounts_payable_id?: string | null;
  default_sales_revenue_id?: string | null;
  default_vat_payable_id?: string | null;
  default_vat_receivable_id?: string | null;
  default_salary_expense_id?: string | null;
  default_salary_payable_id?: string | null;
  default_employee_advances_id?: string | null;
  default_asset_account_id?: string | null;
  default_depreciation_expense_id?: string | null;
  default_accumulated_depreciation_id?: string | null;
  default_gosi_payable_id?: string | null;
  default_gosi_expense_id?: string | null;
  default_eosb_expense_id?: string | null;
  default_eosb_provision_id?: string | null;
  default_leave_encashment_id?: string | null;
  default_allowances_expense_id?: string | null;
  default_commission_expense_id?: string | null;
  default_commission_payable_id?: string | null;
  auto_post_sales?: boolean;
  auto_post_payroll?: boolean;
  auto_post_advances?: boolean;
  auto_post_assets?: boolean;
  auto_post_eosb?: boolean;
  [key: string]: unknown;
}

export interface PostingResult {
  journalEntryId: string;
  entryNo: string;
  totalDebit: number;
  totalCredit: number;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export interface PostingTemplate<T = Record<string, unknown>> {
  buildLines(source: T, settings: AccountingSettings): JournalLineInput[];
  validate(source: T, settings: AccountingSettings): ValidationResult;
  getDescription(source: T): string;
  getSourceModule(): string;
}

export type PostingType =
  | "invoice_issue"
  | "expense_approve"
  | "expense_paid"
  | "payroll_accrual"
  | "payment_customer_receipt"
  | "payment_vendor"
  | "payment_payroll"
  | "payment_advance"
  | "payment_manual"
  | "advance_disbursement"
  | "sales_revenue";

const templates: Record<PostingType, PostingTemplate<any>> = {
  invoice_issue: invoiceTemplate,
  expense_approve: expenseTemplate,
  expense_paid: expenseTemplate,
  payroll_accrual: payrollTemplate,
  payment_customer_receipt: paymentTemplate,
  payment_vendor: paymentTemplate,
  payment_payroll: paymentTemplate,
  payment_advance: paymentTemplate,
  payment_manual: paymentTemplate,
  advance_disbursement: advanceTemplate,
  sales_revenue: salesTemplate,
};

export async function postTransaction(
  admin: AdminClient,
  orgId: string,
  userId: string,
  type: PostingType,
  source: Record<string, unknown>,
  options?: {
    entryDate?: string;
    status?: "draft" | "posted";
    sourceId?: string;
    commandId?: string;
    requestId?: string;
  }
): Promise<PostingResult> {
  const template = templates[type];
  if (!template) throw new Error(`Unknown posting type: ${type}`);

  const settings = (await getAccountingSettings(admin, orgId) || {}) as AccountingSettings;

  const validation = template.validate(source, settings);
  if (!validation.valid) throw new Error(validation.message || "Posting validation failed.");

  const lines = template.buildLines(source, settings);
  const totalDebit = roundMoney(lines.reduce((sum, l) => sum + Number(l.debit || 0), 0));
  const totalCredit = roundMoney(lines.reduce((sum, l) => sum + Number(l.credit || 0), 0));
  if (totalDebit !== totalCredit) {
    throw new Error(`Posting imbalance: debit=${totalDebit}, credit=${totalCredit}`);
  }

  const entryDate = options?.entryDate || new Date().toISOString().slice(0, 10);
  const entry = await createJournalEntry(admin, {
    orgId,
    userId,
    entryDate,
    description: template.getDescription(source),
    sourceModule: template.getSourceModule(),
    sourceId: options?.sourceId || String(source.id || ""),
    status: options?.status || "posted",
    lines,
    commandId: options?.commandId,
    requestId: options?.requestId,
  });

  return {
    journalEntryId: String(entry.id),
    entryNo: String(entry.entry_no),
    totalDebit,
    totalCredit,
  };
}

export { templates };
