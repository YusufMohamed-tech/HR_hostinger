# Frontend Architecture

## Overview

The frontend is built with **Next.js 14 App Router**, **React 18**, and **Tailwind CSS** with a full RTL (right-to-left) Arabic-first interface. UI components are based on **ShadCN/UI** with the `base-nova` style variant.

---

## LMS v43 Frontend

The LMS frontend is implemented under `src/app/(app)/lms` with shared client screens in `src/components/lms/LmsScreens.tsx`. The app layout already runs RTL, and LMS labels are Arabic.

### Learner routes
- `/lms`
- `/lms/my`
- `/lms/catalog`
- `/lms/player/[enrollmentId]`
- `/lms/certificates`
- `/lms/community`

### Management routes
- `/lms/courses`
- `/lms/courses/new`
- `/lms/courses/[courseId]/edit`
- `/lms/courses/[courseId]/instructors`
- `/lms/courses/[courseId]/tasks`
- `/lms/courses/[courseId]/submissions`
- `/lms/courses/[courseId]/community`
- `/lms/assignments`
- `/lms/reports`
- `/lms/certificates`

### Navigation and gates
`src/components/layout/Sidebar.tsx` adds learner LMS links for workspace roles and management LMS links for Admin, HR_Admin, and Training_Manager. LMS route access is allowed in `src/lib/rbac.ts` and feature-gated in middleware.

### UX coverage
The first LMS UI pass includes dashboard stats, learner course table, catalog cards, course management table, category management, course builder, instructor assignment, task management, submission review, learner player, quiz/task submission, community feed, reports, assignments, and printable certificates.

---

## On-Ground Agent / Trader Frontend

The SIM distribution UI spans normal protected sales pages and kiosk route groups.

### Manager sales routes
- `/sales/agents` for field-agent creation, SIM stock assignment, stock overview, OCR box import access, package commission settings, requests, commissions, and manager controls.
- `/sales/stock` for stock status views and filtering.
- `/sales/traders` for trader profiles, location/photo details, trader balances, collections, and commissions.
- `/sales/trader-sales` for manager-only trader sale activation records and search across customer, SIM, package, trader, agent, device, address, and supervisor fields.

### Field-agent kiosk routes
- `/agent`
- `/agent/sims`
- `/agent/sell`
- `/agent/merchants`
- `/agent/requests`
- `/agent/balance`
- `/agent/commissions`

### Trader kiosk routes
- `/merchant`
- `/merchant/sims`
- `/merchant/sell`
- `/merchant/requests`
- `/merchant/balance`

### Components and UX coverage
- `src/components/field-agents/FieldAgentAdminScreens.tsx` implements manager stock/package/agent views, including SIM Box OCR Import.
- `src/components/field-agents/AgentScreens.tsx` implements the field-agent kiosk.
- `src/components/field-agents/TraderManagementScreen.tsx` implements trader portfolio management.
- `src/components/field-agents/TraderSalesScreen.tsx` implements the manager trader-sale detail/search screen.
- `src/components/merchants/MerchantScreens.tsx` implements the trader kiosk and v51 activation form.

The stock manager screen exposes two import paths: the legacy Excel/CSV importer and the v52 SIM Box OCR importer. The OCR dialog accepts an image, runs free local OCR in the browser with Tesseract.js (`eng`), attempts best-effort barcode reading with ZXing, shows raw OCR text in a collapsible details section, keeps provider/order/batch/kit-code fields editable, calls server preview for generated kit-code rows and duplicate status, and offers optional direct field-agent assignment plus confirm/skip-duplicate controls.

The package create/edit dialogs include an `إعدادات العمولة` section. Defaults are 15 SAR total, 5 SAR field-agent chain commission on trader sales, 10 SAR trader commission, and 15 SAR direct field-agent activation commission. Managers can change flat/percentage type, amount, currency, and notes per package. A warning appears when the trader-sale split does not equal the total, but managers can still save deliberate overrides.

Local OCR accuracy depends on image quality. Managers must manually verify first kit code, last kit code, quantity, and dealer box data before pressing confirm.

The trader sell flow is package-first: the trader selects an active package, selects one assigned SIM, fills required activation/customer details, and confirms the sale. The UI lowercases and validates customer email before sending the sale request.

---

## Serialized Product Inventory Frontend

The product-inventory frontend is implemented with shared client screens under `src/components/product-inventory/` and protected App Router pages under `src/app/(app)/sales/inventory/`.

### Receiving routes

- `/sales/inventory` — serialized stock and receipt dashboard.
- `/sales/inventory/receipts/new` — manual grouped receipt entry.
- `/sales/inventory/receipts/import` — XLSX/CSV upload, preview, correction, and commit.
- `/sales/inventory/receipts/photo` — local OCR/barcode extraction, correction, grouping, and commit.
- `/sales/inventory/receipts/[id]` — receipt review, source evidence, pricing, confirmation, and cancellation.
- `/sales/inventory/import-profiles` — Finance-managed reusable import profiles.

### Custody and returns routes

- `/sales/inventory/employee-custody` — Finance employee-custody manager screen.
- `/sales/inventory/custody` — recipient custody view and acknowledgment workflow.
- `/sales/inventory/returns` — evidence-backed return request/review/physical-receipt workflow.
- `/sales/inventory/assignments` — legacy field-agent handover and commerce workflow.
- `/accounting/inventory` — Finance operational inventory and valuation view.

### Sidebar-only employee-custody navigation

`ProductEmployeeCustodyManagerScreen` uses the URL query parameter `tab` to render one custody view at a time. The page no longer renders a visible tab bar; users select these views only from the nested sidebar links under the `المخزون` section:

| URL | View |
|---|---|
| `/sales/inventory/employee-custody?tab=handover` | إصدار تسليم |
| `/sales/inventory/employee-custody?tab=assignments` | التكليفات التشغيلية |
| `/sales/inventory/employee-custody?tab=report` | تقرير العهد |
| `/sales/inventory/employee-custody?tab=history` | سجل التسليمات |

`src/components/layout/Sidebar.tsx` renders the four links indented beneath `تسليم وعهد الموظفين` for Finance Manager users. The inventory links are separated from the `المالية والمحاسبة` section. The original route without a query remains the handover default. The change is navigation-only and does not change custody authorization or command behavior.

### Workbook recognition UI contract

The released recognition engine returns a human-readable structure containing selected sheet, header row, workbook shape, layout fingerprint, field proposals, confidence/status, product evidence, and warnings. The import-profile screen uploads a representative sample, lets Finance review uncertain mappings, and confirms an immutable profile without exposing JSON mapping input.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| UI Library | React 18 |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS 3.4 + tailwindcss-animate |
| Component System | ShadCN/UI (base-nova) + class-variance-authority |
| CSS Utility | clsx + tailwind-merge (`cn()` helper) |
| Icons | lucide-react |
| Date Handling | date-fns |
| Calendar | react-day-picker |
| Charts | recharts + custom SVG charts |
| Maps | Leaflet |
| Font | Noto Sans Arabic (Google Fonts) |
| Validation | Zod |

---

## App Layout Structure

```
<html lang="ar" dir="rtl">
  <body>
    <RoleProvider>          ← Auth context (wraps entire app)
      <AuthGuard>           ← Redirects to /login if unauthenticated
        <div dir="rtl">
          <Sidebar />       ← Fixed left sidebar (role-based navigation)
          <div>
            <Header />      ← Top bar (search, notifications, user menu)
            <SalesShiftMonitor />  ← Real-time sales shift banner
            <main>
              <ErrorBoundary>
                {children}  ← Page content
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </AuthGuard>
    </RoleProvider>
  </body>
</html>
```

---

## Routing Structure

### Route Groups

| Group | Purpose | Layout |
|-------|---------|--------|
| `(app)` | Protected HR/business pages | Sidebar + Header shell |
| `(platform)` | Superadmin pages | Platform sidebar + header |
| Root-level | Login, auth, candidate portal | No shell |

### Page Count by Module

| Module | Pages |
|--------|-------|
| Dashboard | 1 |
| Employees | 2 (list + detail) |
| Departments | 1 |
| Locations | 1 |
| Attendance | 1 |
| Schedule | 2 (list + builder placeholder) |
| Tasks | 2 (all + mine) |
| Leave | 1 |
| Payroll | 1 |
| Personnel | 1 |
| Assets | 1 |
| Balances | 1 |
| Chat | 1 |
| Notifications | 1 |
| Settings | 1 |
| Recruitment | 4 (list, new, detail, edit) |
| Sales | 10+ (dashboard, log, history, team, products, reports, agents, stock, traders, trader-sales, promoter pages) |
| Agent/Trader Kiosk | 12 (agent and merchant route groups for dashboards, stock, sales, requests, balances, commissions) |
| Accounting | 13+ (dashboard, CoA, journals, invoices, expenses, payments, sales commissions, customers, vendors, cost centers, team, settings, reports×9) |

### Accounting Commissions Frontend

`/accounting/commissions` shows sales commission payables and paid rows for field agents and traders. The page includes summary totals, filters for status/date/beneficiary/package/provider, separate agent and trader tables, row selection, and a settlement panel for Finance_Manager and Accountant roles. Finance_Viewer can view the data but cannot mark commissions paid.
| Superadmin | 5+ (dashboard, orgs, users, audit, approvals, settings) |
| Candidate Portal | 3 (login, register, applications) |

---

## Component Architecture

### Component Categories

```
src/components/
├── ui/             # ShadCN primitives (buttons, cards, inputs, tables, etc.)
├── layout/         # App shell (Sidebar, Header, PlatformSidebar)
├── auth/           # AuthGuard
├── forms/          # Dialog-based CRUD forms
├── charts/         # SVG chart components
├── accounting/     # Accounting-specific UI
├── attendance/     # Attendance-specific components
├── candidate/      # Candidate portal components
├── locations/      # Map picker (Leaflet)
├── recruitment/    # Kanban board, form builder
├── sales/          # Sales-specific components
├── ErrorBoundary.tsx
├── PhasePlaceholder.tsx
└── Skeletons.tsx
```

### ShadCN/UI Primitives (`src/components/ui/`)

| Component | Usage |
|-----------|-------|
| `button.tsx` | All interactive buttons (variants: default, destructive, outline, ghost) |
| `card.tsx` | Content containers with header/content/footer |
| `dialog.tsx` | Modal dialogs for forms and confirmations |
| `table.tsx` | Data tables throughout the app |
| `input.tsx` | Text inputs |
| `label.tsx` | Form labels |
| `select.tsx` | Dropdown selects |
| `badge.tsx` | Status badges (colored by status type) |
| `tabs.tsx` | Tab navigation |
| `calendar.tsx` | Date picker (react-day-picker based) |
| `popover.tsx` | Popup panels |
| `dropdown-menu.tsx` | Context menus |
| `avatar.tsx` | User avatars |
| `sheet.tsx` | Slide-out panels (mobile sidebar) |

---

## State Management

### Approach: React Context + Component State

No external state management library (Redux, Zustand, etc.) is used.

**Global State:** Only authentication context via `RoleProvider`

```tsx
interface RoleContextProps {
  currentUser: User | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<User | null>;
}
```

**Page-Level State:** Each page manages its own data via custom hooks:

```tsx
const { data: employees, loading, error, refetch } = useEmployees();
```

### Data Fetching Hooks (`src/hooks/use-data.ts`)

Core pattern: `useOrgData<T>(fetcher, initial)` generic hook that:
1. Gets `orgId` from `useRoleContext()`
2. Calls `fetcher(orgId)` on mount and when orgId changes
3. Returns `{ data, loading, error, refetch }`

| Hook | Service Function |
|------|-----------------|
| `useEmployees()` | `getEmployees(orgId)` |
| `useDepartments()` | `getDepartments(orgId)` |
| `useLocations()` | `getLocations(orgId)` |
| `useShifts()` | `getShifts(orgId)` |
| `useAttendance(date?)` | `getAttendance(orgId, date)` |
| `useTasks()` | `getTasks(orgId)` |
| `useLeaveRequests()` | `getLeaveRequests(orgId)` |
| `useLeaveBalances(empId?)` | `getLeaveBalances(orgId, empId)` |
| `useEmployeeShifts(empId?)` | `getEmployeeShifts(orgId, empId)` |
| `useNotifications()` | `getNotifications(orgId, userId)` |
| `useOrganizations()` | `getOrganizations()` |

---

## UI Patterns

### Dialog Form Pattern

All CRUD forms use modal dialogs:

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>Add Employee</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>New Employee</DialogTitle>
    </DialogHeader>
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
      <DialogFooter>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

### Role-Based UI Pattern

```tsx
const { currentUser } = useRoleContext();
const isAdmin = currentUser?.role === "Admin" || currentUser?.role === "HR_Admin";

// Conditionally render admin-only elements
{isAdmin && <Button onClick={handleDelete}>Delete</Button>}
```

### Data Display Pattern

Data from Supabase is typed as `Record<string, unknown>` and manually extracted for type safety:

```tsx
const record = item as Record<string, unknown>;
const name = typeof record.full_name === "string" ? record.full_name : "—";
```

### Status Badge Pattern

```tsx
<Badge variant={status === "approved" ? "success" : status === "rejected" ? "destructive" : "default"}>
  {status}
</Badge>
```

### Loading State Pattern

```tsx
if (loading) return <Skeletons.Table />;
if (error) return <div>Error loading data</div>;
```

---

## Theming

### CSS Variables (HSL-based)

Defined in `src/app/globals.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 100 40% 48%;        /* Tatwir Green */
  --primary-foreground: 0 0% 100%;
  --muted: 210 40% 96.1%;
  --border: 214.3 31.8% 91.4%;
  /* ... more variables */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... dark mode overrides */
}
```

### Brand Colors

| Name | Value | Usage |
|------|-------|-------|
| `brand` | `#5DAE46` | Primary brand green |
| `brand-dark` | `#4EA72E` | Hover/active states |
| `brand-light` | `#EAF3E8` | Light backgrounds |

---

## RTL (Right-to-Left) Support

- Root `<html>` has `lang="ar" dir="rtl"`
- App layout uses `dir="rtl"` with Tailwind RTL utilities
- Sidebar is on the right side (via `lg:pr-[240px]`)
- Font: **Noto Sans Arabic** (Google Fonts, variable weight)
- All text content flows right-to-left
- UI strings are a mix of Arabic and English (no i18n library)

---

## Charts & Visualization

### Custom SVG Charts (`src/components/charts/`)

- **MiniLineChart:** SVG polyline sparkline for trends (attendance, KPIs)
- **MiniBarChart:** SVG bar chart for comparisons

### Recharts Integration

Used for more complex visualizations in dashboards and reports (line, bar, area charts).

### Leaflet Maps

Used in `LocationMapPicker` component for:
- Geofence radius visualization
- Coordinate selection (click-to-place)
- Location display on maps

---

## Error Handling

### ErrorBoundary (`src/components/ErrorBoundary.tsx`)

React class component that catches rendering errors and displays a fallback UI. Wraps the main content area.

### API Error Handling

Pages handle errors from hooks:
```tsx
const { data, loading, error } = useEmployees();
if (error) return <div className="text-destructive">{error}</div>;
```

---

## Performance Considerations

- **No data caching library** (SWR/React Query) — data refetches on every page navigation
- **No pagination** — most queries fetch all records (acceptable for current scale)
- **Client-side rendering** for most data pages (trade-off: simpler code, slower initial paint)
- **Static generation** for login page and public routes
- **Image optimization** via Next.js Image component where applicable
