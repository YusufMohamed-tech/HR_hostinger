import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import type { JournalLineInput } from "@/lib/accounting/validation";

interface AdvanceSource {
  id: string;
  employee_name?: string;
  amount: number;
  payment_account_id?: string;
}

export const advanceTemplate: PostingTemplate<AdvanceSource> = {
  validate(source, settings) {
    if (!settings.default_employee_advances_id) {
      return { valid: false, message: "حساب سلف الموظفين غير محدد." };
    }
    const payAccount = source.payment_account_id || settings.default_bank_account_id || settings.default_cash_account_id;
    if (!payAccount) {
      return { valid: false, message: "حساب الدفع غير محدد." };
    }
    if (Number(source.amount || 0) <= 0) {
      return { valid: false, message: "مبلغ السلفة يجب أن يكون أكبر من صفر." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const payAccount = String(source.payment_account_id || settings.default_bank_account_id || settings.default_cash_account_id);
    const amount = Number(source.amount || 0);
    const description = `سلفة ${source.employee_name || "موظف"}`;

    return [
      {
        account_id: String(settings.default_employee_advances_id),
        debit: amount,
        credit: 0,
        description,
      },
      {
        account_id: payAccount,
        debit: 0,
        credit: amount,
        description,
      },
    ];
  },

  getDescription(source) {
    return `صرف سلفة ${source.employee_name || "موظف"}`;
  },

  getSourceModule() {
    return "advance";
  },
};
