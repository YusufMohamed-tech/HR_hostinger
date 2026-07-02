import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import { roundMoney, type JournalLineInput } from "@/lib/accounting/validation";

interface SalesLogSource {
  id: string;
  log_date: string;
  grand_total: number;
  vat_amount?: number;
  customer_name?: string;
  cost_center_id?: string | null;
}

export const salesTemplate: PostingTemplate<SalesLogSource> = {
  validate(source, settings) {
    if (!settings.default_accounts_receivable_id) {
      return { valid: false, message: "حساب الذمم المدينة غير محدد." };
    }
    if (!settings.default_sales_revenue_id) {
      return { valid: false, message: "حساب إيرادات المبيعات غير محدد." };
    }
    if (Number(source.vat_amount || 0) > 0 && !settings.default_vat_payable_id) {
      return { valid: false, message: "حساب ضريبة القيمة المضافة المستحقة غير محدد." };
    }
    if (Number(source.grand_total || 0) <= 0) {
      return { valid: false, message: "إجمالي المبيعات يجب أن يكون أكبر من صفر." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const total = Number(source.grand_total || 0);
    const vat = Number(source.vat_amount || 0);
    const revenue = roundMoney(total - vat);

    const lines: JournalLineInput[] = [
      {
        account_id: String(settings.default_accounts_receivable_id),
        debit: total,
        credit: 0,
        description: `مبيعات ${source.customer_name || source.log_date}`,
        cost_center_id: source.cost_center_id || null,
      },
      {
        account_id: String(settings.default_sales_revenue_id),
        debit: 0,
        credit: revenue,
        description: `إيرادات ${source.customer_name || source.log_date}`,
        cost_center_id: source.cost_center_id || null,
      },
    ];

    if (vat > 0) {
      lines.push({
        account_id: String(settings.default_vat_payable_id),
        debit: 0,
        credit: vat,
        description: `ضريبة مبيعات ${source.log_date}`,
      });
    }

    return lines;
  },

  getDescription(source) {
    return `إيرادات مبيعات ${source.log_date}`;
  },

  getSourceModule() {
    return "sales_log";
  },
};
