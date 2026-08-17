import type { AccountingCapability } from "@/lib/accounting/permissions";

export interface NavItem {
  id: string;
  label_ar: string;
  label_en: string;
  path: string;
  capability?: AccountingCapability;
}

export interface NavGroup {
  id: string;
  label_ar: string;
  label_en: string;
  items: NavItem[];
}

export const FINANCE_NAVIGATION: NavGroup[] = [
  {
    id: "dashboard",
    label_ar: "لوحة التحكم",
    label_en: "Dashboard",
    items: [
      { id: "main", label_ar: "الرئيسية", label_en: "Overview", path: "/accounting" },
    ],
  },
  {
    id: "customers",
    label_ar: "العملاء",
    label_en: "Customers",
    items: [
      { id: "customers-list", label_ar: "العملاء", label_en: "Customers", path: "/accounting/customers" },
      { id: "invoices", label_ar: "الفواتير", label_en: "Invoices", path: "/accounting/invoices" },
      { id: "payments-in", label_ar: "التحصيلات", label_en: "Receipts", path: "/accounting/payments" },
      { id: "netting", label_ar: "تسوية AR/AP", label_en: "AR/AP Netting", path: "/accounting/netting" },
    ],
  },
  {
    id: "vendors",
    label_ar: "الموردون",
    label_en: "Vendors",
    items: [
      { id: "vendors-list", label_ar: "الموردون", label_en: "Vendors", path: "/accounting/vendors" },
      { id: "expenses", label_ar: "المصروفات", label_en: "Expenses", path: "/accounting/expenses" },
    ],
  },
  {
    id: "accounting",
    label_ar: "المحاسبة",
    label_en: "Accounting",
    items: [
      { id: "journals", label_ar: "القيود", label_en: "Journal Entries", path: "/accounting/journal-entries" },
      { id: "coa", label_ar: "دليل الحسابات", label_en: "Chart of Accounts", path: "/accounting/chart-of-accounts" },
      { id: "cost-centers", label_ar: "مراكز التكلفة", label_en: "Cost Centers", path: "/accounting/cost-centers" },
      { id: "journal-types", label_ar: "أنواع اليومية", label_en: "Journal Types", path: "/accounting/settings/journal-types" },
    ],
  },
  {
    id: "banking",
    label_ar: "البنوك",
    label_en: "Banking",
    items: [
      { id: "bank-accounts", label_ar: "الحسابات البنكية", label_en: "Bank Accounts", path: "/banking/accounts" },
      { id: "statements", label_ar: "الكشوف", label_en: "Statements", path: "/banking/statements" },
      { id: "reconciliation", label_ar: "المطابقة", label_en: "Reconciliation", path: "/banking/reconciliation" },
    ],
  },
  {
    id: "reports",
    label_ar: "التقارير",
    label_en: "Reports",
    items: [
      { id: "reports-hub", label_ar: "كل التقارير", label_en: "All Reports", path: "/accounting/reports" },
      { id: "trial-balance", label_ar: "ميزان المراجعة", label_en: "Trial Balance", path: "/accounting/reports/trial-balance" },
      { id: "profit-loss", label_ar: "قائمة الدخل", label_en: "Income Statement", path: "/accounting/reports/profit-loss" },
      { id: "balance-sheet", label_ar: "الميزانية", label_en: "Balance Sheet", path: "/accounting/reports/balance-sheet" },
      { id: "cash-flow", label_ar: "التدفقات النقدية", label_en: "Cash Flow", path: "/accounting/reports/cash-flow" },
      { id: "general-ledger", label_ar: "الأستاذ العام", label_en: "General Ledger", path: "/accounting/reports/general-ledger" },
    ],
  },
  {
    id: "settings",
    label_ar: "الإعدادات",
    label_en: "Settings",
    items: [
      { id: "entity-setup", label_ar: "الشركات والدفاتر", label_en: "Entities & Books", path: "/accounting/entity-setup", capability: "permissions:manage" },
      { id: "settings", label_ar: "إعدادات المحاسبة", label_en: "Accounting Settings", path: "/accounting/settings", capability: "permissions:manage" },
      { id: "team", label_ar: "الفريق والصلاحيات", label_en: "Team & Permissions", path: "/accounting/team", capability: "permissions:manage" },
    ],
  },
  {
    id: "extras",
    label_ar: "المزيد",
    label_en: "Extras",
    items: [
      { id: "chat", label_ar: "المحادثات", label_en: "Chat", path: "/chat" },
      { id: "notifications", label_ar: "الإشعارات", label_en: "Notifications", path: "/notifications" },
      { id: "payroll", label_ar: "الرواتب", label_en: "Payroll", path: "/payroll" },
      { id: "lms", label_ar: "التعلم", label_en: "Learning", path: "/lms" },
    ],
  },
];
