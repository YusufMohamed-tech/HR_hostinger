# API Reference

## Overview

Tatwir Talent HRMS exposes **42 API endpoints** via Next.js Route Handlers (`src/app/api/`). All endpoints require authentication via Supabase session cookies (enforced by middleware), except public candidate endpoints.

All API routes return JSON. Standard response patterns:
- **Success:** `{ data: [...] }` or `{ data: {...} }` with HTTP 200
- **Error:** `{ message: "Error description" }` with appropriate HTTP status code
- **Unauthorized:** HTTP 401 `{ message: "Unauthorized" }`
- **Forbidden:** HTTP 403 `{ message: "Forbidden" }`

## Authentication & Authorization

All routes pass through `src/middleware.ts` which:
1. Validates the Supabase auth session
2. Checks org membership and role
3. Enforces path-based RBAC via `canAccessPath(role, pathname)`

---

## HR / Employee Management

### `GET /api/hr/employee-accounts`
**Access:** Admin, HR_Admin  
**Purpose:** List employee accounts for provisioning/management  

---

## Attendance

### `GET /api/attendance/missing-location`
**Access:** Admin, HR_Admin  
**Purpose:** Find attendance records where employee location was not detected  
**Use case:** HR notification when GPS is unavailable during check-in

---

## Task Management

### `GET /api/tasks/mine`
**Access:** All authenticated users  
**Purpose:** Get tasks assigned to the current employee  

### `GET/POST /api/tasks/updates`
**Access:** Assigned employees  
**Purpose:** Get/create task progress updates (status changes, notes)  

### `GET/POST /api/tasks/messages`
**Access:** Assigned employees, task creator  
**Purpose:** Task-related messaging/comments  

### `GET /api/manager/tasks`
**Access:** Training_Manager  
**Purpose:** Get all tasks for the manager's team  

---

## Leave Requests

### `GET/POST /api/leave-requests/self`
**Access:** All employees  
**Purpose:** Get own leave requests / submit new leave request  

### `GET /api/leave-requests/notifications`
**Access:** All authenticated users  
**Purpose:** Get leave-related notifications for the current user  

---

## Advance Requests

### `GET/POST /api/advance-requests`
**Access:** Admin, HR_Admin, Employee  
**Purpose:** List/create salary advance requests  

---

## Assets

### `GET/POST /api/assets`
**Access:** Admin, HR_Admin, Employee  
**Purpose:** List/manage company assets assigned to employees  

---

## Chat / Messaging

### `GET/POST /api/chat`
**Access:** All authenticated users  
**Purpose:** Get/send internal messages  

---

## Recruitment

### `GET/POST /api/recruitment/postings`
**Access:** Admin, HR_Recruitment  
**Purpose:** List all job postings / create new posting  

### `GET/PUT/DELETE /api/recruitment/postings/[id]`
**Access:** Admin, HR_Recruitment  
**Purpose:** Get, update, or delete a specific posting  

### `POST /api/recruitment/postings/[id]/duplicate`
**Access:** Admin, HR_Recruitment  
**Purpose:** Duplicate an existing posting as a draft  

### `GET/POST /api/recruitment/applications`
**Access:** Admin, HR_Recruitment  
**Purpose:** List all applications / submit notes  

### `GET/PUT /api/recruitment/applications/[id]`
**Access:** Admin, HR_Recruitment  
**Purpose:** Get/update application details  

### `PATCH /api/recruitment/applications/[id]/stage`
**Access:** Admin, HR_Recruitment  
**Purpose:** Move application to next pipeline stage (Kanban board)  
**Body:** `{ stage: "reviewed" | "interviewed" | "offered" | "hired" | "rejected" }`

### `GET/POST /api/recruitment/interviews`
**Access:** Admin, HR_Recruitment  
**Purpose:** List/schedule interviews  

### `POST /api/recruitment/hire`
**Access:** Admin, HR_Recruitment  
**Purpose:** Convert hired candidate into employee record  

### `GET /api/recruitment/templates`
**Access:** Admin, HR_Recruitment  
**Purpose:** Get custom application form templates  

---

## Candidate Portal (Public/Semi-Public)

### `GET /api/candidate/posting`
**Access:** Public (no auth required)  
**Purpose:** Lookup job posting details by ID for public application page  
**Query:** `?id=<posting-uuid>`

### `POST /api/candidate/apply`
**Access:** Public (no auth required)  
**Purpose:** Submit a job application  
**Body:** Form data with candidate info + posting ID

### `GET /api/candidate/applications`
**Access:** Authenticated candidates (no org role needed)  
**Purpose:** Get candidate's own application history  

### `GET /api/candidate/notifications`
**Access:** Authenticated candidates  
**Purpose:** Get application status update notifications  

---

## Sales Module

### `GET /api/sales/dashboard`
**Access:** Sales, Sales_Manager, Admin, HR_Admin  
**Purpose:** Aggregated sales KPIs and metrics  

### `GET/POST /api/sales/log`
**Access:** Sales, Sales_Manager, Admin, HR_Admin  
**Purpose:** Get/create daily sales activity log entries  

### `GET/POST /api/sales/log/edit-requests`
**Access:** Sales (create), Sales_Manager (approve/reject)  
**Purpose:** Request edits to submitted sales logs  

### `GET /api/sales/shift-monitor`
**Access:** Sales_Manager, Admin  
**Purpose:** Real-time shift status monitoring for sales team  

### `GET/POST /api/sales/team`
**Access:** Sales_Manager, Admin, HR_Admin  
**Purpose:** Sales team member management  

### `GET/POST /api/sales/companies`
**Access:** Sales, Sales_Manager, Admin  
**Purpose:** Telecom company/customer registry  

### `GET/POST /api/sales/products`
**Access:** Sales_Manager, Admin  
**Purpose:** Product catalog management  

### `GET /api/sales/reports`
**Access:** Sales_Manager, Admin, HR_Admin  
**Purpose:** Sales analytics and reporting  

---

## Accounting Module

### `GET/POST/PUT/DELETE /api/accounting/[...segments]`
**Access:** Finance_Manager, Accountant, Finance_Viewer  
**Purpose:** Dynamic catch-all route handling all accounting CRUD operations  

Supported segment paths:
| Path | Purpose |
|------|---------|
| `/api/accounting/chart-of-accounts` | GL account registry |
| `/api/accounting/journal-entries` | Journal entries CRUD |
| `/api/accounting/journal-entries/[id]` | Single journal entry |
| `/api/accounting/invoices` | Invoice management |
| `/api/accounting/invoices/[id]` | Single invoice |
| `/api/accounting/expenses` | Expense tracking |
| `/api/accounting/expenses/[id]` | Single expense |
| `/api/accounting/payments` | Payment records |
| `/api/accounting/vendors` | Vendor registry |
| `/api/accounting/customers` | Customer registry |
| `/api/accounting/cost-centers` | Cost center management |
| `/api/accounting/reports/balance-sheet` | Balance sheet report |
| `/api/accounting/reports/profit-loss` | Profit & Loss report |
| `/api/accounting/reports/general-ledger` | General ledger |
| `/api/accounting/reports/trial-balance` | Trial balance |
| `/api/accounting/reports/ar-aging` | AR aging report |
| `/api/accounting/reports/ap-aging` | AP aging report |
| `/api/accounting/reports/vat` | VAT report |
| `/api/accounting/reports/employee-advances` | Employee advance report |
| `/api/accounting/reports/payroll-cost` | Payroll cost analysis |

**Finance_Viewer** has read-only access (cannot POST/PUT/DELETE on journal entries, expenses, invoices).

### `GET/POST /api/accounting/team`
**Access:** Finance_Manager only  
**Purpose:** Manage finance team members and role assignments  

---

## Superadmin / Platform

### `GET /api/superadmin/dashboard`
**Access:** Superadmin only  
**Purpose:** Platform-wide metrics (org count, user count, activity)  

### `GET/POST /api/superadmin/organizations`
**Access:** Superadmin only  
**Purpose:** List all organizations / create new org  

### `GET/PUT /api/superadmin/organizations/[orgId]`
**Access:** Superadmin only  
**Purpose:** View/edit organization details (including suspend/activate)  

### `GET /api/superadmin/users`
**Access:** Superadmin only  
**Purpose:** Cross-org user management  

### `GET /api/superadmin/audit`
**Access:** Superadmin only  
**Purpose:** Platform-wide audit log viewer  

### `GET /api/superadmin/tasks`
**Access:** Superadmin only  
**Purpose:** Cross-org task overview  

### `GET /api/superadmin/leave-requests`
**Access:** Superadmin only  
**Purpose:** Cross-org leave request overview  

---

## Auth Callback

### `GET /api/auth/callback`
**Access:** Public  
**Purpose:** OAuth/magic link code exchange  
**Note:** Exchanges auth code for session, sets cookies, redirects to app  
