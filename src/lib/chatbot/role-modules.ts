import type { OrgRole } from "@/types/database";

export const ROLE_MODULE_ACCESS: Record<OrgRole, string[]> = {
  super_admin: ["*"],
  admin: [
    "employees", "departments", "locations", "attendance", "leaves", "tasks",
    "payroll", "schedule", "recruitment", "assets", "accounting", "balances",
    "evaluations", "personnel", "onboarding", "inventory", "trader",
    "chat", "notifications", "settings", "lms", "supervisor",
  ],
  hr_admin: [
    "employees", "departments", "locations", "attendance", "leaves", "tasks",
    "payroll", "schedule", "recruitment", "assets", "balances", "evaluations",
    "personnel", "onboarding", "chat", "notifications", "settings", "lms",
  ],
  hr_recruitment: ["recruitment", "employees", "notifications", "chat"],
  training_manager: ["lms", "employees", "tasks", "notifications", "chat"],
  sales: ["sales", "leaves", "attendance", "tasks", "notifications", "chat"],
  sales_manager: [
    "sales", "leaves", "attendance", "tasks", "schedule",
    "notifications", "chat", "inventory", "trader",
  ],
  onground_agent_manager: ["sales", "tasks", "notifications", "chat"],
  inventory_receiver: ["inventory", "notifications"],
  finance_manager: [
    "accounting", "payroll", "balances", "trader", "inventory",
    "notifications", "chat",
  ],
  accountant: ["accounting", "balances", "notifications", "chat"],
  finance_viewer: ["accounting", "balances", "notifications"],
  supervisor: ["supervisor", "inventory", "attendance", "tasks", "notifications", "chat"],
  account_manager: ["chat", "notifications"],
  promoter: ["sales", "leads", "attendance", "notifications"],
  field_agent: ["sales", "attendance", "inventory", "notifications"],
  merchant: ["merchant", "notifications"],
  employee: [
    "leaves", "attendance", "tasks", "payroll", "assets", "balances",
    "lms", "notifications", "chat",
  ],
};

export const ROLE_GUIDANCE: Record<OrgRole, string> = {
  super_admin:
    "You have full platform-wide access. You can manage all organizations, users, features, and system settings.",
  admin:
    "You have full system access. You can manage all HR, payroll, recruitment, inventory, trader distribution, accounting, and system settings.",
  hr_admin:
    "You manage HR operations: employees, departments, attendance, leave, payroll, recruitment, onboarding, performance evaluations, and the LMS.",
  hr_recruitment:
    "Your focus is recruitment: job postings, candidate pipelines, interview scheduling, and hiring decisions. You can view employee records but not edit them.",
  training_manager:
    "You create and manage courses in the LMS Studio, track learner progress, issue certificates, and manage assignments. You can also view employees and assign tasks.",
  sales:
    "You log daily sales, submit leave requests, check in to attendance, and manage your tasks.",
  sales_manager:
    "You oversee the sales team: review/approve sales logs, manage schedules, handle edit requests, manage trader product distribution and handovers, and view inventory.",
  onground_agent_manager:
    "You manage field agents and their tasks, review agent performance, and coordinate on-ground operations.",
  inventory_receiver:
    "You receive and verify incoming inventory shipments and manage receipt documentation.",
  finance_manager:
    "You manage the full accounting suite, run and approve payroll, handle trader finance settlements, and manage the product catalog for inventory.",
  accountant:
    "You work in accounting: journal entries, invoices, payments, vendor/customer management, and financial reports including VAT, AR/AP, and P&L.",
  finance_viewer:
    "You have read-only access to accounting reports, financial balances, and the general ledger.",
  supervisor:
    "You conduct site evaluations using checklists, manage equipment/router custody for your team, and view attendance records.",
  account_manager:
    "Your primary tool is internal chat for coordinating with the team.",
  promoter:
    "You manage your promoter campaigns, track leads, record attendance, and submit new customer leads through the Promoter kiosk.",
  field_agent:
    "You use the Agent kiosk to record sales, check in to attendance, manage your device/router custody, and track your daily targets.",
  merchant:
    "You use the Merchant portal to manage your orders and product inventory.",
  employee:
    "You can submit leave requests, check in to attendance, view your payslips, track your tasks, access the LMS for training, and manage your advances/balances.",
};

export const ALL_MODULE_DESCRIPTIONS: Record<string, string> = {
  employees: "Manage employee records, onboarding, profiles, and lifecycle",
  departments: "Create and manage organizational departments",
  locations: "Manage work locations with GPS geofencing",
  attendance: "GPS check-in/out with selfie and geofence validation",
  leaves: "Submit, review, and approve leave requests",
  tasks: "Create, assign, and track tasks with attachments",
  payroll: "Run monthly payroll, adjustments, and approval workflow",
  schedule: "Manage shifts and employee shift assignments",
  recruitment: "Job postings, application pipeline, interviews, hiring",
  sales: "Daily sales logging, edit requests, targets, and reporting",
  assets: "Company asset registration, custody, and tracking",
  accounting: "Full double-entry accounting: journals, invoices, payments, reports (P&L, balance sheet, VAT, AR/AP aging, payroll analysis, cost centers)",
  chat: "Internal messaging between employees and groups",
  notifications: "System notifications and alerts",
  settings: "Organization settings and configuration",
  inventory: "Serialized product receiving via Excel/photo OCR, custody tracking for agents and employees, returns with photo evidence",
  trader: "Trader product distribution: handovers, collections, balance settlements, returns, losses, price management, and oversight",
  lms: "Learning Management System: course creation (Studio), enrollments, assignments, certificates, and learner community",
  supervisor: "Supervisor evaluations: site visit checklists, evaluation templates, employee performance observations",
  balances: "Financial advances and employee balance management",
  evaluations: "Performance evaluation cycles, templates, scoring, and HR oversight",
  personnel: "Employee personnel files, documents, and official records",
  onboarding: "New employee onboarding task completion tracking",
  leads: "Promoter campaign leads tracking and conversion",
  merchant: "Merchant portal for order and inventory management",
};

export const ALL_NAV: { module: string; path: string; en: string; ar: string }[] = [
  { module: "employees", path: "/employees", en: "Sidebar > Employees", ar: "القائمة الجانبية > الموظفين" },
  { module: "departments", path: "/departments", en: "Sidebar > Departments", ar: "القائمة الجانبية > الأقسام" },
  { module: "locations", path: "/locations", en: "Sidebar > Locations", ar: "القائمة الجانبية > المواقع" },
  { module: "attendance", path: "/attendance", en: "Sidebar > Attendance", ar: "القائمة الجانبية > الحضور" },
  { module: "leaves", path: "/leaves", en: "Sidebar > Leaves", ar: "القائمة الجانبية > الإجازات" },
  { module: "tasks", path: "/tasks", en: "Sidebar > Tasks", ar: "القائمة الجانبية > المهام" },
  { module: "payroll", path: "/payroll", en: "Sidebar > Payroll", ar: "القائمة الجانبية > الرواتب" },
  { module: "schedule", path: "/schedule", en: "Sidebar > Schedule", ar: "القائمة الجانبية > الجدول" },
  { module: "recruitment", path: "/recruitment", en: "Sidebar > Recruitment", ar: "القائمة الجانبية > التوظيف" },
  { module: "sales", path: "/sales", en: "Sidebar > Sales", ar: "القائمة الجانبية > المبيعات" },
  { module: "assets", path: "/assets", en: "Sidebar > Assets", ar: "القائمة الجانبية > الأصول" },
  { module: "accounting", path: "/accounting", en: "Sidebar > Accounting", ar: "القائمة الجانبية > المحاسبة" },
  { module: "chat", path: "/chat", en: "Sidebar > Chat", ar: "القائمة الجانبية > المحادثات" },
  { module: "notifications", path: "/notifications", en: "Bell icon (top header)", ar: "أيقونة الجرس (الشريط العلوي)" },
  { module: "settings", path: "/settings", en: "Sidebar > Settings", ar: "القائمة الجانبية > الإعدادات" },
  { module: "inventory", path: "/sales/inventory/receipts", en: "Sales > Inventory > Receipts", ar: "المبيعات > المخزون > الاستلام" },
  { module: "inventory", path: "/sales/inventory/custody", en: "Sales > Inventory > Custody", ar: "المبيعات > المخزون > العهدة" },
  { module: "inventory", path: "/sales/inventory/employee-custody", en: "Sales > Inventory > Employee Custody", ar: "المبيعات > المخزون > عهدة الموظفين" },
  { module: "inventory", path: "/sales/inventory/returns", en: "Sales > Inventory > Returns", ar: "المبيعات > المخزون > المرتجعات" },
  { module: "trader", path: "/sales/traders", en: "Sales > Traders", ar: "المبيعات > التجار" },
  { module: "trader", path: "/sales/trader-sales", en: "Sales > Trader Sales", ar: "المبيعات > مبيعات التجار" },
  { module: "trader", path: "/sales/inventory/trader-prices", en: "Sales > Trader Prices", ar: "المبيعات > أسعار التجار" },
  { module: "lms", path: "/lms", en: "Sidebar > LMS", ar: "القائمة الجانبية > نظام التعلم" },
  { module: "supervisor", path: "/supervisor", en: "Sidebar > Supervisor", ar: "القائمة الجانبية > المشرف" },
  { module: "balances", path: "/balances", en: "Sidebar > Balances", ar: "القائمة الجانبية > الأرصدة" },
  { module: "evaluations", path: "/evaluations", en: "Sidebar > Evaluations", ar: "القائمة الجانبية > التقييمات" },
  { module: "personnel", path: "/personnel", en: "Sidebar > Personnel Files", ar: "القائمة الجانبية > الملفات الشخصية" },
  { module: "field_agent", path: "/agent", en: "Agent Kiosk (main page)", ar: "كشك الوكيل (الصفحة الرئيسية)" },
  { module: "promoter", path: "/promoter", en: "Promoter Kiosk (main page)", ar: "كشك المروج (الصفحة الرئيسية)" },
  { module: "merchant", path: "/merchant", en: "Merchant Portal (main page)", ar: "بوابة التاجر (الصفحة الرئيسية)" },
];

export function getModulesForRole(role: OrgRole): string[] {
  return ROLE_MODULE_ACCESS[role] ?? [];
}

export function getFilteredModuleDescriptions(role: OrgRole): Record<string, string> {
  const allowed = ROLE_MODULE_ACCESS[role] ?? [];
  const isAll = allowed.includes("*");
  const result: Record<string, string> = {};
  for (const [key, desc] of Object.entries(ALL_MODULE_DESCRIPTIONS)) {
    if (isAll || allowed.includes(key)) {
      result[key] = desc;
    }
  }
  return result;
}

export function getFilteredNav(role: OrgRole): typeof ALL_NAV {
  const allowed = ROLE_MODULE_ACCESS[role] ?? [];
  const isAll = allowed.includes("*");
  return ALL_NAV.filter((n) => isAll || allowed.includes(n.module));
}
