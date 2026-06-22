# Accounting Browser QA Checklist

Use seeded users or known test accounts for each role. Verify in a clean browser session per role.

## finance_manager
- Can open `/accounting`, all accounting subpages, and `/payroll`.
- Can generate payroll accounting draft, post payroll journal, and record payroll payment.
- Can create/edit draft journals, post journals, reverse posted journals, create invoices, record payments, and manage settings.
- Cannot create duplicate payroll drafts/payments or duplicate sales-log invoices.

## accountant
- Can open accounting operational pages and `/payroll` accounting status.
- Can generate payroll accounting draft if one does not exist.
- Cannot post journals, reverse journals, issue invoices, approve/pay expenses, record payroll payment, or manage settings.

## finance_viewer
- Can open accounting read-only pages and `/payroll` accounting status.
- Cannot create, edit, post, reverse, approve, pay, issue, or change settings.

## HR_Admin
- Can run payroll and manage payslip statuses as before.
- Can see payroll accounting status.
- Cannot access full accounting reports/settings or post finance entries unless also assigned a finance role.

## Sales_Manager
- Can access sales product mapping to revenue accounts.
- Can view sales-related accounting status endpoints.
- Cannot access full accounting module, post journals, or manage finance settings.

## Employee
- Cannot access `/accounting` or finance API routes.
- Cannot create or post accounting records.

## Superadmin
- Can read accounting records where existing superadmin rules allow access.
- Cannot perform operational accounting actions such as create/post/reverse/payment/settings changes.
