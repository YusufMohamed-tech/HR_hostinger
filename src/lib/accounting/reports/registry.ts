import type { AccountingCapability } from "@/lib/accounting/permissions";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export interface ReportMeta {
  id: string;
  title_ar: string;
  title_en: string;
  capability: AccountingCapability;
  supportedFormats: ExportFormat[];
  filenamePattern: string;
}

export const REPORT_REGISTRY: Record<string, ReportMeta> = {
  "trial-balance": {
    id: "trial-balance",
    title_ar: "ميزان المراجعة",
    title_en: "Trial Balance",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "trial_balance_{entity}_{from}_{to}",
  },
  "general-ledger": {
    id: "general-ledger",
    title_ar: "دفتر الأستاذ العام",
    title_en: "General Ledger",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "general_ledger_{entity}_{from}_{to}",
  },
  "profit-loss": {
    id: "profit-loss",
    title_ar: "قائمة الدخل",
    title_en: "Income Statement",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "income_statement_{entity}_{from}_{to}",
  },
  "balance-sheet": {
    id: "balance-sheet",
    title_ar: "الميزانية العمومية",
    title_en: "Balance Sheet",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "balance_sheet_{entity}_{date}",
  },
  "cash-flow": {
    id: "cash-flow",
    title_ar: "قائمة التدفقات النقدية",
    title_en: "Cash Flow Statement",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "cash_flow_{entity}_{from}_{to}",
  },
  "ar-aging": {
    id: "ar-aging",
    title_ar: "أعمار الذمم المدينة",
    title_en: "AR Aging",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "ar_aging_{entity}_{date}",
  },
  "ap-aging": {
    id: "ap-aging",
    title_ar: "أعمار الذمم الدائنة",
    title_en: "AP Aging",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "ap_aging_{entity}_{date}",
  },
  vat: {
    id: "vat",
    title_ar: "تقرير ضريبة القيمة المضافة",
    title_en: "VAT Report",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "vat_report_{entity}_{from}_{to}",
  },
  "payroll-cost": {
    id: "payroll-cost",
    title_ar: "تكاليف الرواتب",
    title_en: "Payroll Cost",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx"],
    filenamePattern: "payroll_cost_{entity}_{from}_{to}",
  },
  "expense-analysis": {
    id: "expense-analysis",
    title_ar: "تحليل المصروفات",
    title_en: "Expense Analysis",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx"],
    filenamePattern: "expense_analysis_{entity}_{from}_{to}",
  },
  "revenue-analysis": {
    id: "revenue-analysis",
    title_ar: "تحليل الإيرادات",
    title_en: "Revenue Analysis",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx"],
    filenamePattern: "revenue_analysis_{entity}_{from}_{to}",
  },
  "cost-center-pnl": {
    id: "cost-center-pnl",
    title_ar: "أرباح وخسائر مراكز التكلفة",
    title_en: "Cost Center P&L",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "cost_center_pnl_{entity}_{from}_{to}",
  },
  comparative: {
    id: "comparative",
    title_ar: "القوائم المقارنة",
    title_en: "Comparative Statements",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx", "pdf"],
    filenamePattern: "comparative_{entity}_{from}_{to}",
  },
  reconciliation: {
    id: "reconciliation",
    title_ar: "تقرير المطابقة",
    title_en: "Reconciliation Report",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx"],
    filenamePattern: "reconciliation_{entity}_{date}",
  },
  "sales-revenue": {
    id: "sales-revenue",
    title_ar: "إيرادات المبيعات",
    title_en: "Sales Revenue",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx"],
    filenamePattern: "sales_revenue_{entity}_{from}_{to}",
  },
  "employee-advances": {
    id: "employee-advances",
    title_ar: "سلف الموظفين",
    title_en: "Employee Advances",
    capability: "accounting:read",
    supportedFormats: ["csv", "xlsx"],
    filenamePattern: "employee_advances_{entity}_{date}",
  },
};

export function getReportMeta(reportId: string): ReportMeta | undefined {
  return REPORT_REGISTRY[reportId];
}

export function generateExportFilename(
  meta: ReportMeta,
  params: { entity?: string; from?: string; to?: string; date?: string },
  format: ExportFormat
): string {
  let name = meta.filenamePattern;
  name = name.replace("{entity}", params.entity || "all");
  name = name.replace("{from}", params.from || "");
  name = name.replace("{to}", params.to || "");
  name = name.replace("{date}", params.date || params.to || "");
  return `${name}.${format}`;
}

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
