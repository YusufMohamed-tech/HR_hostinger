# Blueprint: Chatbot Universal Access & Role-Aware Intelligence Upgrade

**Date:** 2026-08-02  
**Scope:** `src/components/chatbot/`, `src/lib/chatbot/`, `src/app/api/chatbot/`, `src/app/(app)/layout.tsx`, kiosk layouts  
**Goal:** Make the AI assistant available to every authenticated user and give each role a focused, accurate experience that reflects all current system features.

---

## 1. Current State Assessment

### What Works
- AI assistant widget (`ChatWidget` + `ChatProvider`) is mounted in `src/app/(app)/layout.tsx`
- API routes (`/api/chatbot/message`, `/api/chatbot/conversations`) use `requireTenantContext` with no role restriction — any org member can call them
- System prompt passes user name, role, org, current page, and language
- Knowledge base has 13 action guides covering core HR modules (employees, leave, attendance, payroll, tasks, recruitment, departments, locations, schedule, notifications, assets)

### Gaps to Fix

| Problem | Impact |
|---|---|
| `ChatWidget` only mounted in `(app)` layout — kiosk portals (`/agent`, `/promoter`, `/merchant`) may live in a separate route group | Field_Agent, Promoter, Merchant have no access |
| `MODULE_DESCRIPTIONS` in system prompt is static — all 13 modules shown regardless of role | Finance_Viewer sees payroll management options; Merchant sees HR modules they can't access |
| Navigation map is static — all 15 routes listed for every role | Confuses restricted roles; chatbot gives wrong navigation advice |
| Knowledge base missing entire modules: Inventory, Trader, Accounting, LMS, Supervisor, Balances, Evaluations, Personnel | Chatbot can't help with ~40% of the current system |
| 9 roles have zero dedicated action guides: `Supervisor`, `Account_Manager`, `Finance_Viewer`, `Promoter`, `Field_Agent`, `Merchant`, `Onground_Agent_Manager`, `HR_Recruitment`, `Training_Manager` | Those users get generic or irrelevant answers |
| `searchGuides()` accepts `userRole` but the API route (`message/route.ts`) never passes it to the knowledge search | Role filtering in knowledge base is dead code |

---

## 2. Role → Module Mapping

This is the source of truth for what each role should see in the chatbot. Add this to `src/lib/chatbot/role-modules.ts` (new file).

| Role | Accessible Modules |
|---|---|
| `admin` | employees, departments, locations, attendance, leaves, tasks, payroll, schedule, recruitment, assets, accounting, balances, evaluations, personnel, onboarding, inventory, chat, notifications, settings, lms |
| `hr_admin` | employees, departments, locations, attendance, leaves, tasks, payroll, schedule, recruitment, assets, balances, evaluations, personnel, onboarding, chat, notifications, settings, lms |
| `hr_recruitment` | recruitment, employees (view), notifications, chat |
| `training_manager` | lms, employees (view), tasks, notifications, chat |
| `sales` | sales, leaves, attendance, tasks, notifications, chat |
| `sales_manager` | sales, leaves, attendance, tasks, schedule, notifications, chat, inventory (trader) |
| `onground_agent_manager` | sales, tasks, agents, notifications, chat |
| `finance_manager` | accounting, payroll (view), balances, inventory (trader finance), notifications, chat |
| `accountant` | accounting, balances, notifications, chat |
| `finance_viewer` | accounting (read-only), balances (read-only), notifications |
| `supervisor` | supervisor (evaluations), inventory (custody), attendance (view), tasks, notifications, chat |
| `account_manager` | chat, notifications |
| `promoter` | sales (promoter kiosk), leads, attendance, notifications |
| `field_agent` | sales (agent kiosk), attendance, inventory (custody), notifications |
| `merchant` | merchant (kiosk portal), notifications |
| `employee` | leaves, attendance, tasks, payroll (own), assets (own), balances (own), lms, notifications, chat |
| `superadmin` | all |

---

## 3. Implementation Plan

### Phase 1 — Access Expansion (kiosk portals)

**Files to check/modify:**
- `src/app/(app)/layout.tsx` — confirm `ChatProvider` + `ChatWidget` are present ✓ (already done)
- `src/app/(agent)/layout.tsx` — add `ChatProvider` + `ChatWidget` if they exist as separate route groups
- `src/app/(promoter)/layout.tsx` — same
- `src/app/(merchant)/layout.tsx` — same

**Steps:**
1. Run `find src/app -name "layout.tsx" | sort` to list all layout files
2. For each kiosk layout that does NOT already import `ChatProvider`/`ChatWidget`, add the same pattern as `(app)/layout.tsx`:
   ```tsx
   import { ChatProvider } from "@/components/chatbot/ChatProvider";
   import { ChatWidget } from "@/components/chatbot/ChatWidget";
   // wrap children in <ChatProvider>, render <ChatWidget /> at bottom
   ```
3. If kiosk routes are inside `(app)` already, no change needed

**Verification:** Log in as a `field_agent` or `promoter` account, navigate to `/agent` or `/promoter` — the floating chat button should appear.

---

### Phase 2 — Role-Filtered System Prompt

**File:** `src/lib/chatbot/system-prompt.ts`

#### 2a. Create role-modules mapping

Create `src/lib/chatbot/role-modules.ts`:

```typescript
import type { OrgRole } from "@/types/database";

export const ROLE_MODULE_ACCESS: Record<OrgRole | "superadmin", string[]> = {
  admin: ["employees", "departments", "locations", "attendance", "leaves", "tasks",
          "payroll", "schedule", "recruitment", "assets", "accounting", "balances",
          "evaluations", "personnel", "onboarding", "inventory", "trader",
          "chat", "notifications", "settings", "lms", "supervisor"],
  hr_admin: ["employees", "departments", "locations", "attendance", "leaves", "tasks",
             "payroll", "schedule", "recruitment", "assets", "balances", "evaluations",
             "personnel", "onboarding", "chat", "notifications", "settings", "lms"],
  hr_recruitment: ["recruitment", "employees", "notifications", "chat"],
  training_manager: ["lms", "employees", "tasks", "notifications", "chat"],
  sales: ["sales", "leaves", "attendance", "tasks", "notifications", "chat"],
  sales_manager: ["sales", "leaves", "attendance", "tasks", "schedule",
                  "notifications", "chat", "inventory", "trader"],
  onground_agent_manager: ["sales", "tasks", "notifications", "chat"],
  finance_manager: ["accounting", "payroll", "balances", "trader", "inventory",
                    "notifications", "chat"],
  accountant: ["accounting", "balances", "notifications", "chat"],
  finance_viewer: ["accounting", "balances", "notifications"],
  supervisor: ["supervisor", "inventory", "attendance", "tasks", "notifications", "chat"],
  account_manager: ["chat", "notifications"],
  promoter: ["sales", "leads", "attendance", "notifications"],
  field_agent: ["sales", "attendance", "inventory", "notifications"],
  merchant: ["merchant", "notifications"],
  employee: ["leaves", "attendance", "tasks", "payroll", "assets", "balances",
             "lms", "notifications", "chat"],
  superadmin: ["*"],
  inventory_receiver: ["inventory", "notifications"],
};

export const ROLE_NAV_MAP: Record<string, { path: string; labelEn: string; labelAr: string }[]> = {
  // ... see Phase 2b
};
```

#### 2b. Expand MODULE_DESCRIPTIONS

Replace the static `MODULE_DESCRIPTIONS` object in `system-prompt.ts` with a complete map covering all current modules:

```typescript
const ALL_MODULE_DESCRIPTIONS: Record<string, string> = {
  employees: "Manage employee records, onboarding, profiles, and lifecycle",
  departments: "Create and manage organizational departments",
  locations: "Manage work locations with GPS geofencing",
  attendance: "GPS check-in/out with selfie and geofence validation",
  leaves: "Submit, review, and approve leave requests",
  tasks: "Create, assign, and track tasks with attachments",
  payroll: "Run monthly payroll, adjustments, and approval workflow",
  schedule: "Manage shifts and employee shift assignments",
  recruitment: "Job postings, application pipeline, interviews, hiring",
  sales: "Daily sales logging, edit requests, and reporting",
  assets: "Company asset registration, custody, and tracking",
  accounting: "Full double-entry accounting: journals, invoices, payments, reports (P&L, balance sheet, VAT, AR/AP aging, payroll analysis, cost centers)",
  chat: "Internal messaging between employees and groups",
  notifications: "System notifications and alerts",
  settings: "Organization settings and configuration",
  // New modules
  inventory: "Serialized product receiving via Excel/photo OCR, custody tracking for agents and employees, returns with photo evidence",
  trader: "Trader product distribution: handovers, collections, balance settlements, returns, losses, price management",
  lms: "Learning Management System: course creation (Studio), enrollments, assignments, certificates, learner community",
  supervisor: "Supervisor evaluations: site visit checklists, evaluation templates, employee performance observations",
  balances: "Financial advances and employee balance management",
  evaluations: "Performance evaluation cycles, templates, scoring, and HR oversight",
  personnel: "Employee personnel files, documents, and official records",
  onboarding: "New employee onboarding task completion tracking",
  leads: "Promoter campaign leads tracking and conversion",
  merchant: "Merchant portal for order and inventory management",
};
```

#### 2c. Update `buildSystemPrompt()` to filter by role

```typescript
import { ROLE_MODULE_ACCESS } from "./role-modules";

export function buildSystemPrompt(context: ChatContext): string {
  const allowedModules = ROLE_MODULE_ACCESS[context.userRole] ?? [];
  const isAll = allowedModules.includes("*");

  const moduleList = Object.entries(ALL_MODULE_DESCRIPTIONS)
    .filter(([key]) => isAll || allowedModules.includes(key))
    .map(([key, desc]) => `- **${key}**: ${desc}`)
    .join("\n");

  const navItems = buildNavMap(context.userRole); // see Phase 2b
  
  const roleGuidance = ROLE_GUIDANCE[context.userRole] ?? "";

  return `You are the Tatwir Talent HR Assistant...
## Your Role
...

## Current User Context
- Name: ${context.userName}
- Role: ${context.userRole}
- Organization: ${context.orgName}
- Current Page: ${context.currentPage}
- Language: ${context.language === "ar" ? "Arabic" : "English"}

## What You Can Access (${context.userRole})
${roleGuidance}

## Your Available Modules
${moduleList}

## Navigation Map
${navItems}
...`;
}
```

#### 2d. Add `ROLE_GUIDANCE` — one paragraph per role

Add to `system-prompt.ts`:

```typescript
const ROLE_GUIDANCE: Partial<Record<OrgRole, string>> = {
  admin: "You have full system access. You can manage all HR, payroll, recruitment, inventory, accounting, and system settings.",
  hr_admin: "You manage HR operations: employees, departments, attendance, leave, payroll, recruitment, onboarding, performance evaluations, and the LMS.",
  hr_recruitment: "Your focus is recruitment: job postings, candidate pipelines, interview scheduling, and hiring decisions. You can view employee records but not edit them.",
  training_manager: "You create and manage courses in the LMS Studio, track learner progress, issue certificates, and manage assignments. You can also view employees and assign tasks.",
  sales: "You log daily sales, submit leave requests, check in to attendance, and manage your tasks.",
  sales_manager: "You oversee the sales team: review/approve sales logs, manage schedules, handle edit requests, and manage trader product distribution and handovers.",
  finance_manager: "You manage the full accounting suite, run and approve payroll, handle trader finance settlements, and manage the product catalog for inventory.",
  accountant: "You work in accounting: journal entries, invoices, payments, vendor/customer management, and financial reports including VAT, AR/AP, and P&L.",
  finance_viewer: "You have read-only access to accounting reports, financial balances, and the general ledger.",
  supervisor: "You conduct site evaluations using checklists, manage equipment/router custody for your team, and view attendance records.",
  account_manager: "Your primary tool is internal chat for coordinating with the team.",
  promoter: "You manage your promoter campaigns, track leads, and record attendance through the Promoter kiosk.",
  field_agent: "You use the Agent kiosk to record sales, check in to attendance, and manage your device/router custody.",
  merchant: "You use the Merchant portal to manage your orders and product inventory.",
  employee: "You can submit leave requests, check in to attendance, view your payslips, track your tasks, access the LMS for training, and manage your advances/balances.",
};
```

---

### Phase 3 — Knowledge Base Expansion

**File:** `src/lib/chatbot/knowledge-base.ts`

Add the following new action guides. Each follows the existing `ActionGuide` shape with bilingual steps.

#### New guides to add (27 total additions):

**Inventory Module (for `supervisor`, `sales_manager`, `finance_manager`, `field_agent`, `admin`)**
1. `receive_inventory` — Receive serialized products via Excel or photo OCR
2. `manage_employee_custody` — Assign and track device custody for employees/agents
3. `submit_inventory_return` — Return a device with photo evidence
4. `view_custody_report` — View current custody status for your team

**Trader Module (for `sales_manager`, `finance_manager`, `admin`)**
5. `create_trader_handover` — Hand over products to a trader with serial numbers
6. `record_trader_collection` — Log a trader payment/collection
7. `settle_trader_balance` — Process a full trader balance settlement
8. `record_trader_return` — Record a product returned by a trader
9. `record_trader_loss` — Post a product loss event with reason
10. `manage_trader_prices` — Set and approve trader product prices
11. `view_trader_oversight` — View trader oversight dashboard (balances, outstanding)

**Accounting Module (for `finance_manager`, `accountant`, `admin`)**
12. `create_journal_entry` — Post a manual journal entry with debit/credit lines
13. `create_invoice` — Create a customer invoice
14. `record_payment` — Record a customer payment against an invoice
15. `record_expense` — Record a vendor bill/expense
16. `run_financial_report` — Generate P&L, balance sheet, or VAT report
17. `manage_cost_center` — Create and assign cost centers to transactions

**LMS Module (for `training_manager`, `employee`, `admin`)**
18. `create_course` — Create a new course in the LMS Studio with sections and lessons
19. `enroll_in_course` — Enroll in an available course as a learner
20. `track_course_progress` — Check your course completion progress and certificates

**Supervisor Module (for `supervisor`, `admin`)**
21. `create_evaluation_checklist` — Create a site evaluation checklist template
22. `submit_site_evaluation` — Conduct and submit a site evaluation visit

**Balances & Advances (for `employee`, `hr_admin`, `finance_manager`)**
23. `request_advance` — Submit a salary advance request
24. `view_my_balance` — Check your current financial balance and advance history

**Performance Evaluations (for `hr_admin`, `admin`)**
25. `create_evaluation_cycle` — Launch a performance evaluation cycle
26. `complete_employee_evaluation` — Score an employee's performance evaluation

**Kiosk-specific (for `field_agent`, `promoter`, `merchant`)**
27. `agent_log_sale` — Log a sale through the Agent kiosk (device IMEI + customer details)
28. `promoter_submit_lead` — Submit a new lead from the Promoter kiosk

---

### Phase 4 — Wire Role Filtering in the API

**File:** `src/app/api/chatbot/message/route.ts`

Currently `searchGuides()` is never called from the API route. The knowledge base search must be invoked and injected into the AI context.

**Changes:**

```typescript
import { searchGuides } from "@/lib/chatbot/knowledge-base";

// Inside the POST handler, after building messages:
const tenantContext = await requireTenantContext({}, req);
const userRole = tenantContext.member.role;

// Inject relevant guides for current page as additional context
const pageKeyword = body.currentPage?.split("/").filter(Boolean).pop() ?? "";
const relevantGuides = searchGuides(pageKeyword, userRole);

// Add as a system message before user messages:
if (relevantGuides.length > 0) {
  const guideSummary = relevantGuides
    .map(g => `- ${g.title} (${g.route}): ${g.steps.map(s => s.instruction).join(" → ")}`)
    .join("\n");
  messages.unshift({
    role: "system",
    content: `Relevant action guides for the user's current context:\n${guideSummary}`,
  });
}
```

---

### Phase 5 — Navigation Map Completeness

**File:** `src/lib/chatbot/system-prompt.ts`

Replace the hardcoded navigation block with a role-filtered function. The complete navigation map should include all current routes:

```typescript
const ALL_NAV: { module: string; path: string; en: string; ar: string }[] = [
  { module: "employees",   path: "/employees",            en: "Sidebar > Employees",         ar: "القائمة الجانبية > الموظفين" },
  { module: "departments", path: "/departments",           en: "Sidebar > Departments",        ar: "القائمة الجانبية > الأقسام" },
  { module: "locations",   path: "/locations",            en: "Sidebar > Locations",          ar: "القائمة الجانبية > المواقع" },
  { module: "attendance",  path: "/attendance",           en: "Sidebar > Attendance",         ar: "القائمة الجانبية > الحضور" },
  { module: "leaves",      path: "/leaves",               en: "Sidebar > Leaves",             ar: "القائمة الجانبية > الإجازات" },
  { module: "tasks",       path: "/tasks",                en: "Sidebar > Tasks",              ar: "القائمة الجانبية > المهام" },
  { module: "payroll",     path: "/payroll",              en: "Sidebar > Payroll",            ar: "القائمة الجانبية > الرواتب" },
  { module: "schedule",    path: "/schedule",             en: "Sidebar > Schedule",           ar: "القائمة الجانبية > الجدول" },
  { module: "recruitment", path: "/recruitment",          en: "Sidebar > Recruitment",        ar: "القائمة الجانبية > التوظيف" },
  { module: "sales",       path: "/sales",                en: "Sidebar > Sales",              ar: "القائمة الجانبية > المبيعات" },
  { module: "assets",      path: "/assets",               en: "Sidebar > Assets",             ar: "القائمة الجانبية > الأصول" },
  { module: "accounting",  path: "/accounting",           en: "Sidebar > Accounting",         ar: "القائمة الجانبية > المحاسبة" },
  { module: "chat",        path: "/chat",                 en: "Sidebar > Chat",               ar: "القائمة الجانبية > المحادثات" },
  { module: "notifications", path: "/notifications",      en: "Bell icon (top header)",       ar: "أيقونة الجرس (الشريط العلوي)" },
  { module: "settings",    path: "/settings",             en: "Sidebar > Settings",           ar: "القائمة الجانبية > الإعدادات" },
  // New
  { module: "inventory",   path: "/sales/inventory/receipts",   en: "Sidebar > Sales > Inventory Receipts",  ar: "القائمة > المبيعات > استلام المخزون" },
  { module: "inventory",   path: "/sales/inventory/custody",    en: "Sidebar > Sales > Custody",             ar: "القائمة > المبيعات > العهدة" },
  { module: "inventory",   path: "/sales/inventory/returns",    en: "Sidebar > Sales > Returns",             ar: "القائمة > المبيعات > المرتجعات" },
  { module: "trader",      path: "/sales/traders",              en: "Sidebar > Sales > Traders",             ar: "القائمة > المبيعات > التجار" },
  { module: "trader",      path: "/sales/trader-sales",         en: "Sidebar > Sales > Trader Sales",        ar: "القائمة > المبيعات > مبيعات التجار" },
  { module: "lms",         path: "/lms",                        en: "Sidebar > LMS",                         ar: "القائمة الجانبية > نظام التعلم" },
  { module: "supervisor",  path: "/supervisor",                 en: "Sidebar > Supervisor",                  ar: "القائمة الجانبية > المشرف" },
  { module: "balances",    path: "/balances",                   en: "Sidebar > Balances",                    ar: "القائمة الجانبية > الأرصدة" },
  { module: "evaluations", path: "/evaluations",                en: "Sidebar > Evaluations",                 ar: "القائمة الجانبية > التقييمات" },
  { module: "personnel",   path: "/personnel",                  en: "Sidebar > Personnel",                   ar: "القائمة الجانبية > الملفات الشخصية" },
  { module: "field_agent", path: "/agent",                      en: "Agent Kiosk (main page)",               ar: "كشك الوكيل (الصفحة الرئيسية)" },
  { module: "promoter",    path: "/promoter",                   en: "Promoter Kiosk (main page)",            ar: "كشك المروج (الصفحة الرئيسية)" },
  { module: "merchant",    path: "/merchant",                   en: "Merchant Kiosk (main page)",            ar: "كشك التاجر (الصفحة الرئيسية)" },
];

function buildNavMap(userRole: OrgRole): string {
  const allowed = ROLE_MODULE_ACCESS[userRole] ?? [];
  const isAll = allowed.includes("*");
  return ALL_NAV
    .filter(n => isAll || allowed.includes(n.module) || allowed.includes(userRole))
    .map(n => `- ${n.path} (${n.en} / ${n.ar})`)
    .join("\n");
}
```

---

## 4. File Change Summary

| File | Change Type | What Changes |
|---|---|---|
| `src/lib/chatbot/role-modules.ts` | **New file** | Role → module access map + role-specific nav map |
| `src/lib/chatbot/system-prompt.ts` | **Modify** | Filter modules/nav by role, add role guidance paragraph, expand ALL_NAV, add new module descriptions |
| `src/lib/chatbot/knowledge-base.ts` | **Modify** | Add 27+ new action guides for inventory, trader, accounting, LMS, supervisor, kiosks, balances |
| `src/app/api/chatbot/message/route.ts` | **Modify** | Pass `userRole` to `searchGuides()`, inject relevant guides as system context |
| `src/app/(agent)/layout.tsx` | **Modify (if exists)** | Add `ChatProvider` + `ChatWidget` |
| `src/app/(promoter)/layout.tsx` | **Modify (if exists)** | Add `ChatProvider` + `ChatWidget` |
| `src/app/(merchant)/layout.tsx` | **Modify (if exists)** | Add `ChatProvider` + `ChatWidget` |

---

## 5. New Action Guides — Detailed Specs

Below are the full bilingual step specs for each of the 27 new guides.

### Inventory: Receive Products (`receive_inventory`)
- **Roles:** `admin`, `hr_admin`, `sales_manager`, `finance_manager`
- **Route:** `/sales/inventory/receipts`
- **EN Steps:**
  1. Navigate to Sales → Inventory Receipts from the sidebar
  2. Click "New Receipt" button
  3. Choose import method: Upload Excel file, or use Photo OCR to scan a receipt image
  4. For Excel: Download the template, fill IMEI/serial numbers and product names, upload
  5. For Photo OCR: Click "Scan Receipt", take or upload a photo — the system auto-extracts data
  6. Review extracted products and quantities; correct any OCR errors
  7. Set the receipt date and supplier reference
  8. Click "Confirm Receipt" to add products to stock
- **AR Steps:** (bilingual mirror of above)

### Inventory: Assign Employee Custody (`manage_employee_custody`)
- **Roles:** `admin`, `supervisor`, `sales_manager`
- **Route:** `/sales/inventory/employee-custody`
- **EN Steps:**
  1. Navigate to Sales → Employee Custody
  2. Click "Assign Custody"
  3. Search and select the employee
  4. Select products by serial number from available stock
  5. Optionally set a project/assignment note
  6. Click "Confirm" — employee receives notification

### Inventory: Submit Return (`submit_inventory_return`)
- **Roles:** `employee`, `field_agent`, `supervisor`, `admin`
- **Route:** `/sales/inventory/returns`
- **EN Steps:**
  1. Navigate to Sales → Returns
  2. Click "New Return"
  3. Select the device/serial number from your current custody
  4. Choose return reason (End of use, Damaged, Lost, Transfer)
  5. Upload photo evidence (required for Damaged/Lost)
  6. Submit — the return is sent for manager confirmation

### Trader: Create Handover (`create_trader_handover`)
- **Roles:** `sales_manager`, `finance_manager`, `admin`
- **Route:** `/sales/traders` → Handovers tab
- **EN Steps:**
  1. Navigate to Sales → Traders
  2. Select the trader from the list
  3. Click "New Handover"
  4. Scan or enter serial numbers of products to hand over
  5. Confirm product quantities and prices
  6. Click "Submit Handover" — trader's balance is debited

### Trader: Record Collection (`record_trader_collection`)
- **Roles:** `sales_manager`, `finance_manager`, `admin`
- **Route:** `/sales/traders` → Collections tab
- **EN Steps:**
  1. Navigate to Sales → Traders → select trader
  2. Click "Record Collection"
  3. Enter the amount received (cash or transfer)
  4. Set payment date and reference number
  5. Click "Save" — balance is updated automatically

### Trader: Settle Balance (`settle_trader_balance`)
- **Roles:** `finance_manager`, `admin`
- **Route:** `/sales/traders` → Balance tab
- **EN Steps:**
  1. Navigate to Sales → Traders → select trader
  2. Go to the "Balance" tab
  3. Review outstanding amount (handovers minus collections)
  4. Click "Settle Balance"
  5. Enter settlement amount and method
  6. Click "Confirm Settlement"

### Trader: Record Return (`record_trader_return`)
- **Roles:** `sales_manager`, `finance_manager`, `admin`
- **Route:** `/sales/inventory/trader-prices` or Traders → Returns
- **EN Steps:**
  1. Navigate to Sales → Traders → select trader → Returns tab
  2. Click "New Return"
  3. Enter serial numbers of returned products
  4. Select return condition (Good, Damaged)
  5. Upload supporting photos
  6. Submit — balance is credited automatically

### Trader: Record Loss (`record_trader_loss`)
- **Roles:** `sales_manager`, `finance_manager`, `admin`
- **Route:** Traders → Losses tab
- **EN Steps:**
  1. Navigate to Sales → Traders → select trader → Losses tab
  2. Click "Report Loss"
  3. Enter serial number(s) of lost products
  4. Provide loss reason and date
  5. Upload any supporting documentation
  6. Submit — loss is posted to accounting as an expense

### Accounting: Create Journal Entry (`create_journal_entry`)
- **Roles:** `accountant`, `finance_manager`, `admin`
- **Route:** `/accounting/journals`
- **EN Steps:**
  1. Navigate to Accounting → Journal Entries
  2. Click "New Entry"
  3. Set entry date and reference/memo
  4. Add debit line: select account, enter amount, optionally set cost center
  5. Add credit line: select account, enter matching amount
  6. Ensure debits = credits (system validates)
  7. Click "Post" to record the entry in the ledger
  8. 💡 Use "Draft" status first if you need a manager to review before posting

### Accounting: Create Invoice (`create_invoice`)
- **Roles:** `accountant`, `finance_manager`, `admin`
- **Route:** `/accounting/invoices`
- **EN Steps:**
  1. Navigate to Accounting → Invoices → "New Invoice"
  2. Select or create the customer
  3. Set invoice date and due date
  4. Add line items: description, quantity, unit price, VAT rate
  5. Review totals (subtotal, VAT, grand total)
  6. Click "Save & Send" or "Save Draft"

### Accounting: Run Financial Report (`run_financial_report`)
- **Roles:** `finance_manager`, `accountant`, `finance_viewer`, `admin`
- **Route:** `/accounting/reports`
- **EN Steps:**
  1. Navigate to Accounting → Reports
  2. Select report type: P&L, Balance Sheet, Cash Flow, VAT, AR Aging, AP Aging, Trial Balance, Payroll Analysis, Cost Center, Comparative
  3. Set the date range (or period)
  4. Optionally filter by cost center or entity
  5. Click "Generate"
  6. Use "Export PDF" or "Export Excel" to download

### LMS: Create a Course (`create_course`)
- **Roles:** `training_manager`, `admin`
- **Route:** `/lms`
- **EN Steps:**
  1. Navigate to LMS from the sidebar
  2. Click "Create Course" in the Course Studio
  3. Enter course title, description, and thumbnail
  4. Add sections (chapters) using "Add Section"
  5. Within each section, add lessons: video, text, quiz, or assignment
  6. Set the course prerequisites and enrollment rules
  7. Publish the course to make it available to learners
  8. 💡 You can enroll specific employees or open it to all roles

### LMS: Enroll in a Course (`enroll_in_course`)
- **Roles:** `employee`, `sales`, `promoter`, `field_agent`, and any role
- **Route:** `/lms`
- **EN Steps:**
  1. Navigate to LMS from the sidebar
  2. Browse available courses in the catalog
  3. Click a course to see details, syllabus, and duration
  4. Click "Enroll" to start
  5. Progress through lessons in order — each lesson must be completed to unlock the next
  6. Complete all lessons and pass the final assignment to receive a certificate

### Supervisor: Conduct Site Evaluation (`submit_site_evaluation`)
- **Roles:** `supervisor`, `admin`
- **Route:** `/supervisor`
- **EN Steps:**
  1. Navigate to Supervisor from the sidebar
  2. Click "New Evaluation"
  3. Select the site/location to evaluate
  4. Choose the checklist template
  5. Go through each checklist item, marking Pass/Fail/N/A
  6. Add notes or photos for any failed items
  7. Submit the evaluation — a report is generated automatically

### Employee: Request Advance (`request_advance`)
- **Roles:** `employee`, `sales`, `field_agent`, `promoter`
- **Route:** `/balances`
- **EN Steps:**
  1. Navigate to Balances from the sidebar
  2. Click "Request Advance"
  3. Enter the advance amount
  4. Select reason (Salary advance, Emergency, Equipment)
  5. Add supporting note
  6. Submit for HR/Finance approval
  7. 💡 You will be notified when your request is approved or rejected

### Performance: Create Evaluation Cycle (`create_evaluation_cycle`)
- **Roles:** `admin`, `hr_admin`
- **Route:** `/evaluations`
- **EN Steps:**
  1. Navigate to Evaluations from the sidebar
  2. Click "New Evaluation Cycle"
  3. Set the cycle name, period (e.g., Q2 2026), and due date
  4. Select a scoring template (or create one)
  5. Choose which employees/departments are included
  6. Click "Launch" — evaluators receive notifications to complete their assigned evaluations

### Agent Kiosk: Log a Sale (`agent_log_sale`)
- **Roles:** `field_agent`
- **Route:** `/agent`
- **EN Steps:**
  1. Open the Agent Kiosk (main page after login)
  2. Click "Log Sale"
  3. Select the product from your current custody
  4. Enter customer name and phone number
  5. Scan or enter the device IMEI
  6. Submit — the sale is recorded against your daily target

### Promoter Kiosk: Submit a Lead (`promoter_submit_lead`)
- **Roles:** `promoter`
- **Route:** `/promoter`
- **EN Steps:**
  1. Open the Promoter Kiosk
  2. Click "New Lead"
  3. Enter customer name, phone, and interest details
  4. Select the product/campaign the lead is for
  5. Add any notes from the conversation
  6. Submit — the lead is tracked in the promoter campaign dashboard

---

## 6. Testing Checklist

For each role group, verify after implementation:

| Role | Widget visible? | System prompt filtered? | At least 3 relevant guides? | Navigation accurate? |
|---|---|---|---|---|
| `admin` | ✓ | ✓ (all modules) | ✓ | ✓ |
| `hr_admin` | ✓ | ✓ (no accounting/trader) | ✓ | ✓ |
| `hr_recruitment` | ✓ | ✓ (recruitment only) | ✓ | ✓ |
| `training_manager` | ✓ | ✓ (lms, tasks, employees) | ✓ | ✓ |
| `finance_manager` | ✓ | ✓ (accounting, trader, balances) | ✓ | ✓ |
| `accountant` | ✓ | ✓ (accounting, balances) | ✓ | ✓ |
| `finance_viewer` | ✓ | ✓ (read-only accounting) | ✓ | ✓ |
| `supervisor` | ✓ | ✓ (supervisor, inventory) | ✓ | ✓ |
| `account_manager` | ✓ | ✓ (chat only) | ✓ | ✓ |
| `sales` | ✓ | ✓ (sales, leaves, attendance) | ✓ | ✓ |
| `sales_manager` | ✓ | ✓ (sales, trader, schedule) | ✓ | ✓ |
| `field_agent` | ✓ (kiosk) | ✓ (agent kiosk, inventory) | ✓ | ✓ |
| `promoter` | ✓ (kiosk) | ✓ (promoter kiosk, leads) | ✓ | ✓ |
| `merchant` | ✓ (kiosk) | ✓ (merchant portal only) | ✓ | ✓ |
| `employee` | ✓ | ✓ (leaves, payroll, lms) | ✓ | ✓ |

---

## 7. Implementation Order

1. **Phase 1** (30 min): Check kiosk layout files, add ChatWidget where missing
2. **Phase 2** (2–3 hrs): Create `role-modules.ts`, rewrite `system-prompt.ts` with filtering + new modules + role guidance
3. **Phase 3** (3–4 hrs): Add 27 new action guides to `knowledge-base.ts`
4. **Phase 4** (1 hr): Update `message/route.ts` to inject role-filtered guides into AI context
5. **Testing** (1–2 hrs): Test each role group end-to-end with sample questions

**Total estimate:** 7–10 hours of development work.
