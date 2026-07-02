import type { PostingTemplate, AccountingSettings } from "@/lib/accounting/posting-engine";
import { roundMoney, type JournalLineInput } from "@/lib/accounting/validation";

interface InvoiceSource {
  id: string;
  invoice_no: string;
  invoice_date: string;
  subtotal?: number;
  discount_amount?: number;
  vat_amount?: number;
  total_amount?: number;
  lines?: Array<{
    revenue_account_id?: string | null;
    line_total?: number;
    vat_amount?: number;
  }>;
}

export const invoiceTemplate: PostingTemplate<InvoiceSource> = {
  validate(source, settings) {
    if (!settings.default_accounts_receivable_id) {
      return { valid: false, message: "أكمل إعدادات حسابات الذمم المدينة أولا." };
    }
    if (!settings.default_sales_revenue_id) {
      return { valid: false, message: "أكمل إعدادات حساب إيرادات المبيعات أولا." };
    }
    if (Number(source.vat_amount || 0) > 0 && !settings.default_vat_payable_id) {
      return { valid: false, message: "حساب ضريبة القيمة المضافة المستحقة غير محدد." };
    }
    if (Number(source.total_amount || 0) <= 0) {
      return { valid: false, message: "مبلغ الفاتورة يجب أن يكون أكبر من صفر." };
    }
    return { valid: true };
  },

  buildLines(source, settings): JournalLineInput[] {
    const invoiceLines = source.lines || [];
    const revenueByAccount = new Map<string, number>();

    if (invoiceLines.length > 0) {
      for (const line of invoiceLines) {
        const accountId = String(line.revenue_account_id || settings.default_sales_revenue_id);
        const amount = roundMoney(Number(line.line_total || 0) - Number(line.vat_amount || 0));
        revenueByAccount.set(accountId, roundMoney((revenueByAccount.get(accountId) || 0) + amount));
      }
    } else {
      const netRevenue = roundMoney(Number(source.subtotal || 0) - Number(source.discount_amount || 0));
      revenueByAccount.set(String(settings.default_sales_revenue_id), netRevenue);
    }

    const lines: JournalLineInput[] = [
      {
        account_id: String(settings.default_accounts_receivable_id),
        debit: Number(source.total_amount || 0),
        credit: 0,
        description: source.invoice_no,
      },
      ...Array.from(revenueByAccount.entries()).map(([accountId, amount]) => ({
        account_id: accountId,
        debit: 0,
        credit: amount,
        description: source.invoice_no,
      })),
    ];

    if (Number(source.vat_amount || 0) > 0) {
      lines.push({
        account_id: String(settings.default_vat_payable_id),
        debit: 0,
        credit: Number(source.vat_amount),
        description: source.invoice_no,
      });
    }

    return lines;
  },

  getDescription(source) {
    return `إصدار فاتورة ${source.invoice_no}`;
  },

  getSourceModule() {
    return "invoice";
  },
};
