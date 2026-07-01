import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import { roundMoney, type JournalLineInput } from "@/lib/accounting/validation";

interface PayrollSource {
  id: string;
  month: string;
  total_net: number;
  advance_deductions: number;
}

export const payrollTemplate: PostingTemplate<PayrollSource> = {
  validate(source, settings) {
    if (!settings.default_salary_expense_id) {
      return { valid: false, message: "حساب مصروف الرواتب غير محدد." };
    }
    if (!settings.default_salary_payable_id) {
      return { valid: false, message: "حساب الرواتب المستحقة غير محدد." };
    }
    if (source.advance_deductions > 0 && !settings.default_employee_advances_id) {
      return { valid: false, message: "حساب سلف الموظفين مطلوب لترحيل خصومات السلف." };
    }
    if (source.total_net <= 0) {
      return { valid: false, message: "صافي الرواتب يجب أن يكون أكبر من صفر." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const salaryCost = roundMoney(source.total_net + source.advance_deductions);
    const lines: JournalLineInput[] = [
      {
        account_id: String(settings.default_salary_expense_id),
        debit: salaryCost,
        credit: 0,
        description: `رواتب ${source.month}`,
      },
      {
        account_id: String(settings.default_salary_payable_id),
        debit: 0,
        credit: salaryCost,
        description: `رواتب مستحقة ${source.month}`,
      },
    ];

    if (source.advance_deductions > 0) {
      lines.push(
        {
          account_id: String(settings.default_salary_payable_id),
          debit: source.advance_deductions,
          credit: 0,
          description: `خصم سلف ${source.month}`,
        },
        {
          account_id: String(settings.default_employee_advances_id),
          debit: 0,
          credit: source.advance_deductions,
          description: `خصم سلف ${source.month}`,
        }
      );
    }

    return lines;
  },

  getDescription(source) {
    return `قيد رواتب ${source.month}`;
  },

  getSourceModule() {
    return "payroll";
  },
};
