export type MissingEmployeeField = {
  key: string;
  label: string;
  section: "basic" | "work" | "payroll";
};

type EmployeeRecord = Record<string, unknown>;

function hasValue(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function hasAnyValue(employee: EmployeeRecord, keys: string[]) {
  return keys.some((key) => hasValue(employee[key]));
}

const completionRules: Array<MissingEmployeeField & { keys: string[] }> = [
  { key: "full_name_ar", label: "الاسم بالعربي", section: "basic", keys: ["full_name_ar"] },
  { key: "full_name_en", label: "الاسم بالإنجليزي", section: "basic", keys: ["full_name_en"] },
  { key: "phone", label: "رقم الجوال", section: "basic", keys: ["phone"] },
  { key: "address", label: "العنوان", section: "basic", keys: ["address"] },
  { key: "national_id", label: "رقم الهوية", section: "basic", keys: ["national_id"] },
  { key: "work_city", label: "مدينة العمل", section: "work", keys: ["work_city", "city", "province"] },
  { key: "national_address_code", label: "العنوان الوطني", section: "basic", keys: ["national_address_code"] },
  { key: "date_of_birth", label: "تاريخ الميلاد الميلادي", section: "basic", keys: ["date_of_birth"] },
  { key: "date_of_birth_hijri", label: "تاريخ الميلاد الهجري", section: "basic", keys: ["date_of_birth_hijri"] },
  { key: "gender", label: "الجنس", section: "basic", keys: ["gender"] },
  { key: "education_level", label: "المؤهل العلمي", section: "basic", keys: ["education_level"] },
  { key: "emergency_contact_name", label: "اسم جهة اتصال الطوارئ", section: "basic", keys: ["emergency_contact_name"] },
  { key: "emergency_contact_phone", label: "جوال جهة اتصال الطوارئ", section: "basic", keys: ["emergency_contact_phone"] },
  { key: "hiring_date", label: "تاريخ التعيين", section: "work", keys: ["hiring_date"] },
  { key: "department_id", label: "القسم", section: "work", keys: ["department_id"] },
  { key: "job_title", label: "المسمى الوظيفي", section: "work", keys: ["job_title"] },
  { key: "manager_id", label: "المدير المباشر", section: "work", keys: ["manager_id"] },
  { key: "project_id", label: "المشروع / القناة", section: "work", keys: ["project_id", "company_id"] },
  { key: "location_id", label: "موقع العمل الأساسي", section: "work", keys: ["location_id"] },
  { key: "payment_method", label: "طريقة الدفع", section: "payroll", keys: ["payment_method"] },
  { key: "bank_account_name", label: "اسم صاحب الحساب", section: "payroll", keys: ["bank_account_name"] },
  { key: "bank_name", label: "اسم البنك", section: "payroll", keys: ["bank_name"] },
  { key: "iban", label: "رقم الآيبان", section: "payroll", keys: ["iban", "bank_account"] },
];

export function getMissingEmployeeFields(employee: EmployeeRecord): MissingEmployeeField[] {
  return completionRules
    .filter((rule) => !hasAnyValue(employee, rule.keys))
    .map((rule) => ({ key: rule.key, label: rule.label, section: rule.section }));
}

export function resolveEmployeeDisplayName(employee: EmployeeRecord, accountEmail: string) {
  const candidate = [employee.full_name, employee.full_name_ar, employee.full_name_en]
    .find((value) => typeof value === "string" && value.trim().length >= 2);
  return typeof candidate === "string" ? candidate.trim() : accountEmail.trim().toLowerCase();
}
