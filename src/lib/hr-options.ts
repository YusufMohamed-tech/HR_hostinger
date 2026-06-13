export const saudiCityOptions = [
  "الرياض",
  "جدة",
  "مكة المكرمة",
  "المدينة المنورة",
  "الدمام",
  "الخبر",
  "الظهران",
  "تبوك",
  "أبها",
  "نجران",
  "حائل",
  "بريدة",
  "عنيزة",
  "القصيم",
  "الخرج",
  "المجمعة",
  "الجوف",
  "الباحة",
  "ينبع",
  "جازان",
  "الطائف",
  "الأحساء",
  "الجبيل",
  "أملج",
  "رأس تنورة",
  "سيهات",
  "القطيف",
];

export const educationLevelOptions = [
  "ثانوي",
  "دبلوم",
  "بكالوريوس",
  "ماجستير",
  "دكتوراه",
  "شهادة مهنية",
];

export const bankOptions = [
  "البنك الأهلي السعودي",
  "مصرف الراجحي",
  "بنك الرياض",
  "البنك السعودي الفرنسي",
  "البنك العربي الوطني",
  "مصرف الإنماء",
  "بنك البلاد",
  "بنك الجزيرة",
  "بنك ساب",
  "البنك السعودي للاستثمار",
];

export const leaveTypeOptions = [
  { value: "vacation", label: "سنوية", requiresAttachment: false },
  { value: "sick", label: "مرضية", requiresAttachment: true },
  { value: "unpaid", label: "بدون راتب", requiresAttachment: false },
  { value: "weekly", label: "أسبوعية", requiresAttachment: false },
  { value: "marriage", label: "زواج", requiresAttachment: true },
  { value: "bereavement", label: "وفاة", requiresAttachment: true },
  { value: "emergency", label: "طارئة", requiresAttachment: false },
] as const;

export const leaveTypeLabels = Object.fromEntries(
  leaveTypeOptions.map((option) => [option.value, option.label])
) as Record<string, string>;

export function leaveTypeRequiresAttachment(leaveType: string) {
  return Boolean(leaveTypeOptions.find((option) => option.value === leaveType)?.requiresAttachment);
}

export function inclusiveDays(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}
