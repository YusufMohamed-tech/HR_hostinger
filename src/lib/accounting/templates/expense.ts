import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import type { JournalLineInput } from "@/lib/accounting/validation";

interface ExpenseSource {
  id: string;
  expense_no: string;
  expense_date: string;
  description: string;
  category_account_id?: string;
  payment_account_id?: string;
  cost_center_id?: string | null;
  amount_before_vat?: number;
  vat_amount?: number;
  total_amount?: number;
  paid_immediately?: boolean;
}

export const expenseTemplate: PostingTemplate<ExpenseSource> = {
  validate(source, settings) {
    if (!source.category_account_id) {
      return { valid: false, message: "حساب تصنيف المصروف مطلوب." };
    }
    if (source.paid_immediately) {
      const payAccount = source.payment_account_id || settings.default_bank_account_id || settings.default_cash_account_id;
      if (!payAccount) return { valid: false, message: "حساب الدفع غير محدد." };
    } else {
      if (!settings.default_accounts_payable_id) {
        return { valid: false, message: "حساب الذمم الدائنة غير محدد." };
      }
    }
    if (Number(source.vat_amount || 0) > 0 && !settings.default_vat_receivable_id) {
      return { valid: false, message: "حساب ضريبة القيمة المضافة القابلة للاسترداد غير محدد." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const creditAccount = source.paid_immediately
      ? String(source.payment_account_id || settings.default_bank_account_id || settings.default_cash_account_id)
      : String(settings.default_accounts_payable_id);

    const lines: JournalLineInput[] = [
      {
        account_id: String(source.category_account_id),
        debit: Number(source.amount_before_vat || 0),
        credit: 0,
        description: source.description,
        cost_center_id: source.cost_center_id || null,
      },
    ];

    if (Number(source.vat_amount || 0) > 0) {
      lines.push({
        account_id: String(settings.default_vat_receivable_id),
        debit: Number(source.vat_amount || 0),
        credit: 0,
        description: source.description,
      });
    }

    lines.push({
      account_id: creditAccount,
      debit: 0,
      credit: Number(source.total_amount || 0),
      description: source.description,
    });

    return lines;
  },

  getDescription(source) {
    return `اعتماد مصروف ${source.expense_no}`;
  },

  getSourceModule() {
    return "expense";
  },
};
