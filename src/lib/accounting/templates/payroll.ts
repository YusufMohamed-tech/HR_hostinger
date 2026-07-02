import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import { roundMoney, type JournalLineInput } from "@/lib/accounting/validation";

interface PayrollSource {
  id: string;
  month: string;
  total_base_salary: number;
  total_allowances: number;
  total_net: number;
  advance_deductions: number;
  total_employer_gosi: number;
  total_employee_gosi: number;
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
    if ((source.total_employer_gosi > 0 || source.total_employee_gosi > 0) && !settings.default_gosi_payable_id) {
      return { valid: false, message: "حساب التأمينات الاجتماعية المستحقة مطلوب لترحيل قيد الرواتب." };
    }
    if (source.total_allowances > 0 && !settings.default_allowances_expense_id) {
      return { valid: false, message: "حساب مصروف البدلات غير محدد." };
    }
    if (source.total_base_salary <= 0) {
      return { valid: false, message: "إجمالي الرواتب الأساسية يجب أن يكون أكبر من صفر." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const totalGosi = roundMoney(source.total_employer_gosi + source.total_employee_gosi);
    const lines: JournalLineInput[] = [];

    // DR: Salary Expense = base salaries
    lines.push({
      account_id: String(settings.default_salary_expense_id),
      debit: roundMoney(source.total_base_salary),
      credit: 0,
      description: `مصروف رواتب ${source.month}`,
    });

    // DR: Allowances Expense (only when there are allowances and the account is configured)
    if (source.total_allowances > 0 && settings.default_allowances_expense_id) {
      lines.push({
        account_id: String(settings.default_allowances_expense_id),
        debit: roundMoney(source.total_allowances),
        credit: 0,
        description: `مصروف بدلات ${source.month}`,
      });
    }

    // DR: GOSI Expense = employer share only
    if (source.total_employer_gosi > 0 && settings.default_gosi_expense_id) {
      lines.push({
        account_id: String(settings.default_gosi_expense_id),
        debit: roundMoney(source.total_employer_gosi),
        credit: 0,
        description: `مصروف تأمينات اجتماعية (صاحب العمل) ${source.month}`,
      });
    }

    // CR: Salary Payable = net salary (after all employee deductions incl. employee GOSI)
    lines.push({
      account_id: String(settings.default_salary_payable_id),
      debit: 0,
      credit: roundMoney(source.total_net),
      description: `رواتب مستحقة ${source.month}`,
    });

    // CR: GOSI Payable = employer + employee shares
    if (totalGosi > 0 && settings.default_gosi_payable_id) {
      lines.push({
        account_id: String(settings.default_gosi_payable_id),
        debit: 0,
        credit: totalGosi,
        description: `تأمينات اجتماعية مستحقة ${source.month}`,
      });
    }

    // CR: Employee Advances (deducted from salary payable, clearing the advance balance)
    if (source.advance_deductions > 0 && settings.default_employee_advances_id) {
      // Reclassify: DR Salary Payable, CR Employee Advances
      lines.push(
        {
          account_id: String(settings.default_salary_payable_id),
          debit: roundMoney(source.advance_deductions),
          credit: 0,
          description: `خصم سلف ${source.month}`,
        },
        {
          account_id: String(settings.default_employee_advances_id),
          debit: 0,
          credit: roundMoney(source.advance_deductions),
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
