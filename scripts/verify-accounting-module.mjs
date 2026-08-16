import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const files = {
  api: read("src/app/api/accounting/[...segments]/route.ts"),
  permissions: read("src/lib/accounting/permissions.ts"),
  rbac: read("src/lib/rbac.ts"),
  posting: read("src/lib/accounting/posting.ts"),
  outboxWorker: read("src/lib/server/outbox-worker.ts"),
  reports: read("src/lib/accounting/reports.ts"),
  accountingUi: read("src/components/accounting/AccountingScreens.tsx"),
  payrollUi: read("src/app/(app)/payroll/page.tsx"),
  salesProductApi: read("src/app/api/sales/products/route.ts"),
  salesProductUi: read("src/app/(app)/sales/products/page.tsx"),
  migration38: read("db/schema_v38_accounting_hardening.sql"),
  migration39: read("db/schema_v39_accounting_completion.sql"),
  migration40: read("db/schema_v40_accounting_audit_fixes.sql"),
  migration63: read("db/schema_v63_atomic_accounting_journals.sql"),
  migration96: read("db/schema_v96_durable_accounting_journal_events.sql"),
};

const apiAccountingGuard = files.rbac.match(/if \(normalizedPath\.startsWith\("\/api\/accounting"\)\) \{[\s\S]*?\n  \}/)?.[0] || "";
const roleSet = (name) => files.permissions.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\);`))?.[1] || "";
const manageRoles = roleSet("manageRoles");
const postRoles = roleSet("postRoles");
const journalValidationCalls = files.posting.match(/validateJournalLines\(input\.lines(?:, \{ sourceModule \})?\)/g)?.length || 0;

const checks = [
  ["Finance viewer cannot manage", files.permissions.includes("finance_viewer") && manageRoles.length > 0 && !manageRoles.includes("finance_viewer")],
  ["Accountant cannot post", postRoles.length > 0 && !postRoles.includes("accountant")],
  ["Finance manager can post", postRoles.includes("finance_manager")],
  ["Employee and recruiter blocked from accounting API", apiAccountingGuard.includes("Finance_Manager") && !apiAccountingGuard.includes("Employee") && !apiAccountingGuard.includes("HR_Recruitment")],
  ["Unbalanced journals blocked", journalValidationCalls >= 2 && files.migration63.includes("debit_total <> credit_total") && files.migration63.includes("Journal lines must contain equal positive debit and credit totals.")],
  ["Posted journals protected by migration", files.migration38.includes("accounting_prevent_posted_entry_mutation") && files.migration38.includes("accounting_prevent_posted_line_mutation")],
  ["Duplicate reversal blocked", files.posting.includes('rpc("accounting_reverse_journal"') && files.migration38.includes("idx_accounting_journal_entries_one_reversal") && files.migration63.includes("CREATE OR REPLACE FUNCTION public.accounting_reverse_journal")],
  ["Invoice overpayment blocked", files.api.includes("amount <= 0 || amount > Number(invoice.balance_due || 0)")],
  ["Duplicate payroll posting blocked", files.api.includes('.from("accounting_source_postings")') && files.api.includes('.eq("source_module", "payroll")') && files.migration63.includes("uq_accounting_journal_active_source")],
  ["Duplicate payroll payment blocked", files.api.includes("status.payment_id") && files.migration39.includes("uq_accounting_payroll_payment_source")],
  ["Duplicate sales invoice blocked", files.api.includes('source_module", "sales_log"') && files.migration39.includes("uq_accounting_sales_log_invoice_source")],
  ["Reports use posted ledger entries", files.reports.includes('["posted", "reversed"]') || files.reports.includes('"posted", "reversed"')],
  ["Manual payments require counterpart account", files.api.includes("counterpart_account_id") && files.migration39.includes("Manual payment counterpart account is required")],
  ["Sales products map revenue accounts", files.salesProductApi.includes("revenue_account_id") && files.salesProductUi.includes("revenue_account_id")],
  ["Payroll UI exposes accounting states", files.payrollUi.includes("not_generated") && files.payrollUi.includes("draft_created") && files.payrollUi.includes("recordPayrollPayment")],
  ["DB manage helper excludes admin", files.migration40.includes("can_manage_accounting()") && files.migration40.includes("'finance_manager', 'accountant'") && !/can_manage_accounting\(\)[\s\S]*?'admin'/.test(files.migration40)],
  ["DB post helper is finance manager only", files.migration40.includes("can_post_accounting()") && /role::text = 'finance_manager'/.test(files.migration40) && !/can_post_accounting\(\)[\s\S]*?'admin'/.test(files.migration40)],
  ["Accounting settings use finance-manager DB guard", files.migration40.includes("can_manage_accounting_settings()") && files.migration40.includes("accounting_settings_update")],
  ["Admin payroll post/payment UI hidden", !/canPostPayrollAccounting[^;\n]*Admin/s.test(files.payrollUi) && !/canGenerateAccountingDraft[^;\n]*Admin/s.test(files.payrollUi)],
  ["Draft journal edit supported", files.posting.includes("updateDraftJournalEntry") && files.api.includes("updateDraftJournalEntry") && files.accountingUi.includes("تعديل المسودة")],
  ["Operational reports exclude draft records", files.api.includes('.in("status", ["issued", "partially_paid"])') && files.api.includes('.eq("status", "approved")') && files.api.includes('.in("status", ["approved", "paid"])')],
  ["Journal notifications use durable outbox delivery", !files.posting.includes("notifyFinance") && files.migration96.includes("trg_accounting_journal_status_event") && files.migration96.includes("INSERT INTO public.event_outbox") && files.outboxWorker.includes('"accounting.journal_pending_approval"') && files.outboxWorker.includes('"accounting.journal_posted"') && files.outboxWorker.includes('"accounting.journal_reversed"')],
];

let failed = 0;
for (const [name, ok] of checks) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} ${name}`);
  if (!ok) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} accounting verification check(s) failed.`);
  process.exit(1);
}

console.log("\nAccounting verification checks passed.");
