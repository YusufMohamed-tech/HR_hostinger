import type { AccountingAccountType } from "@/types/accounting";

export type AccountingAccountSubtype =
  | "cash"
  | "bank"
  | "receivable"
  | "related_party_receivable"
  | "inventory"
  | "prepaid"
  | "current_asset"
  | "fixed_asset"
  | "other_asset"
  | "payable"
  | "related_party_payable"
  | "accrual"
  | "tax_payable"
  | "current_liability"
  | "long_term_liability"
  | "other_liability"
  | "capital"
  | "retained_earnings"
  | "reserves"
  | "current_year_result"
  | "sales_revenue"
  | "commission_revenue"
  | "service_revenue"
  | "other_income"
  | "cost_of_revenue"
  | "operating_expense"
  | "depreciation_expense"
  | "finance_cost"
  | "other_expense";

export type AccountSubtypeOption = Readonly<{
  value: AccountingAccountSubtype;
  labelAr: string;
}>;

export const ACCOUNT_TYPE_LABELS_AR = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  revenue: "إيراد",
  expense: "مصروف",
} as const satisfies Record<AccountingAccountType, string>;

export const ACCOUNT_SUBTYPE_TAXONOMY = {
  asset: [
    { value: "cash", labelAr: "نقدية" },
    { value: "bank", labelAr: "حساب بنكي" },
    { value: "receivable", labelAr: "ذمم مدينة" },
    { value: "related_party_receivable", labelAr: "ذمم مدينة لأطراف ذات علاقة" },
    { value: "inventory", labelAr: "مخزون" },
    { value: "prepaid", labelAr: "مصروفات مدفوعة مقدمًا" },
    { value: "current_asset", labelAr: "أصل متداول آخر" },
    { value: "fixed_asset", labelAr: "أصل ثابت" },
    { value: "other_asset", labelAr: "أصل آخر" },
  ],
  liability: [
    { value: "payable", labelAr: "ذمم دائنة" },
    { value: "related_party_payable", labelAr: "ذمم دائنة لأطراف ذات علاقة" },
    { value: "accrual", labelAr: "مستحقات" },
    { value: "tax_payable", labelAr: "ضرائب مستحقة" },
    { value: "current_liability", labelAr: "التزام متداول آخر" },
    { value: "long_term_liability", labelAr: "التزام طويل الأجل" },
    { value: "other_liability", labelAr: "التزام آخر" },
  ],
  equity: [
    { value: "capital", labelAr: "رأس المال" },
    { value: "retained_earnings", labelAr: "الأرباح المبقاة" },
    { value: "reserves", labelAr: "احتياطيات" },
    { value: "current_year_result", labelAr: "نتيجة العام الحالي" },
  ],
  revenue: [
    { value: "sales_revenue", labelAr: "إيراد مبيعات" },
    { value: "commission_revenue", labelAr: "إيراد عمولات" },
    { value: "service_revenue", labelAr: "إيراد خدمات" },
    { value: "other_income", labelAr: "إيراد آخر" },
  ],
  expense: [
    { value: "cost_of_revenue", labelAr: "تكلفة الإيراد" },
    { value: "operating_expense", labelAr: "مصروف تشغيلي" },
    { value: "depreciation_expense", labelAr: "مصروف إهلاك" },
    { value: "finance_cost", labelAr: "تكلفة تمويل" },
    { value: "other_expense", labelAr: "مصروف آخر" },
  ],
} as const satisfies Record<AccountingAccountType, readonly AccountSubtypeOption[]>;

export const ACCOUNT_SUBTYPE_LABELS_AR = Object.fromEntries(
  Object.values(ACCOUNT_SUBTYPE_TAXONOMY)
    .flat()
    .map((option) => [option.value, option.labelAr]),
) as Readonly<Record<AccountingAccountSubtype, string>>;

// Existing installations contain older subtype values. They remain readable and
// editable until a separate, audited data migration maps them to the taxonomy.
const LEGACY_ACCOUNT_SUBTYPE_LABELS_AR: Readonly<Record<string, string>> = {
  employee_advances: "سلف موظفين",
  fixed_assets: "أصول ثابتة",
  accumulated_depreciation: "مجمع الإهلاك",
  vat_receivable: "ضريبة قيمة مضافة قابلة للاسترداد",
  vat_payable: "ضريبة قيمة مضافة مستحقة",
  accrued: "مستحقات",
  accrued_expenses: "مصروفات مستحقة",
  salary_payable: "رواتب مستحقة",
  commission_payable: "عمولات مستحقة",
  eos_provision: "مخصص نهاية الخدمة",
  operating_revenue: "إيراد تشغيلي",
  sales: "إيراد مبيعات",
  services: "إيراد خدمات",
  payroll: "رواتب ومزايا موظفين",
  salary_expense: "مصروف رواتب",
  salaries: "مصروف رواتب",
  bonuses: "مصروف مكافآت",
  commissions: "مصروف عمولات",
  social_insurance: "مصروف تأمينات اجتماعية",
  rent: "مصروف إيجار",
  utilities: "مصروف مرافق",
  telecom: "مصروف اتصالات",
  recruitment: "مصروف توظيف",
  training: "مصروف تدريب",
  travel: "مصروف سفر",
  office_supplies: "مصروف لوازم مكتبية",
  depreciation: "مصروف إهلاك",
  cost_of_sales: "تكلفة المبيعات",
};

export function getAccountSubtypeOptions(type: AccountingAccountType): readonly AccountSubtypeOption[] {
  return ACCOUNT_SUBTYPE_TAXONOMY[type];
}

export function isAccountSubtypeForType(
  type: AccountingAccountType,
  subtype: string | null | undefined,
): subtype is AccountingAccountSubtype {
  if (!subtype) return false;
  return ACCOUNT_SUBTYPE_TAXONOMY[type].some((option) => option.value === subtype);
}

export function normalizeAccountSubtype(
  type: AccountingAccountType,
  subtype: string | null | undefined,
): AccountingAccountSubtype | "" {
  return isAccountSubtypeForType(type, subtype) ? subtype : "";
}

export function getAccountSubtypeLabelAr(subtype: string | null | undefined): string {
  if (!subtype) return "غير مصنف";
  return ACCOUNT_SUBTYPE_LABELS_AR[subtype as AccountingAccountSubtype]
    || LEGACY_ACCOUNT_SUBTYPE_LABELS_AR[subtype]
    || subtype;
}
