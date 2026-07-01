import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import { requireText } from "@/lib/accounting/validation";
import type { JournalLineInput } from "@/lib/accounting/validation";

interface PaymentSource {
  id: string;
  payment_no: string;
  payment_date: string;
  type: "customer_receipt" | "vendor_payment" | "payroll_payment" | "employee_advance" | "manual";
  direction: "inbound" | "outbound";
  amount: number;
  account_id?: string;
  counterpart_account_id?: string;
  cost_center_id?: string | null;
  description?: string;
  notes?: string;
}

function resolveCounterpartAccount(source: PaymentSource, settings: AccountingSettings): string {
  if (source.type === "customer_receipt") return String(settings.default_accounts_receivable_id || "");
  if (source.type === "vendor_payment") return String(settings.default_accounts_payable_id || "");
  if (source.type === "payroll_payment") return String(settings.default_salary_payable_id || "");
  if (source.type === "employee_advance") return String(settings.default_employee_advances_id || "");
  if (source.type === "manual") return String(source.counterpart_account_id || "");
  return "";
}

export const paymentTemplate: PostingTemplate<PaymentSource> = {
  validate(source, settings) {
    const bank = source.account_id || settings.default_bank_account_id || settings.default_cash_account_id;
    if (!bank) return { valid: false, message: "حساب النقدية أو البنك غير محدد." };

    const other = resolveCounterpartAccount(source, settings);
    if (!other) return { valid: false, message: "إعدادات الحساب المقابل للدفعة غير مكتملة." };

    if (bank === other) return { valid: false, message: "حساب البنك والحساب المقابل يجب أن يكونا مختلفين." };

    if (Number(source.amount || 0) <= 0) {
      return { valid: false, message: "مبلغ الدفعة يجب أن يكون أكبر من صفر." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const bank = String(source.account_id || settings.default_bank_account_id || settings.default_cash_account_id);
    const other = resolveCounterpartAccount(source, settings);
    const description = requireText(source.description, requireText(source.notes, source.payment_no));
    const costCenterId = source.cost_center_id || null;
    const amount = Number(source.amount || 0);

    const inbound = source.direction === "inbound";
    return inbound
      ? [
          { account_id: bank, debit: amount, credit: 0, description, cost_center_id: costCenterId },
          { account_id: other, debit: 0, credit: amount, description, cost_center_id: costCenterId },
        ]
      : [
          { account_id: other, debit: amount, credit: 0, description, cost_center_id: costCenterId },
          { account_id: bank, debit: 0, credit: amount, description, cost_center_id: costCenterId },
        ];
  },

  getDescription(source) {
    return `ترحيل دفعة ${source.payment_no}`;
  },

  getSourceModule() {
    return "payment";
  },
};
