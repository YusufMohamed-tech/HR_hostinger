import type {
  AccountingAccount,
  AccountingCostCenter,
  AccountingCustomer,
  AccountingExpense,
  AccountingInvoice,
  AccountingJournalEntry,
  AccountingPayment,
  AccountingSalesCompanyLink,
  AccountingSettings,
  AccountingVendor,
  PayrollAccountingStatus,
} from "@/types/accounting";

type ApiResult<T> = { data: T | null; error: string | null };

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      cache: options?.method ? undefined : "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: String(payload?.message || "تعذر تنفيذ العملية.") };
    return { data: (payload?.data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." };
  }
}

function qs(params?: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

export function getAccountingDashboard(params?: Record<string, string | undefined>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/dashboard${qs(params)}`);
}

export function initializeAccountingDefaults() {
  return apiFetch<{ ok: boolean }>("/api/accounting/init-defaults", { method: "POST", body: "{}" });
}

export function getAccountingSettings() {
  return apiFetch<AccountingSettings>("/api/accounting/settings");
}

export function updateAccountingSettings(values: Partial<AccountingSettings>) {
  return apiFetch<AccountingSettings>("/api/accounting/settings", { method: "PATCH", body: JSON.stringify(values) });
}

export function getAccountingAccounts(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingAccount[]>(`/api/accounting/accounts${qs(params)}`);
}

export function createAccountingAccount(values: Partial<AccountingAccount>) {
  return apiFetch<AccountingAccount>("/api/accounting/accounts", { method: "POST", body: JSON.stringify(values) });
}

export function updateAccountingAccount(id: string, values: Partial<AccountingAccount>) {
  return apiFetch<AccountingAccount>(`/api/accounting/accounts/${id}`, { method: "PATCH", body: JSON.stringify(values) });
}

export function getCostCenters() {
  return apiFetch<AccountingCostCenter[]>("/api/accounting/cost-centers");
}

export function createCostCenter(values: Partial<AccountingCostCenter>) {
  return apiFetch<AccountingCostCenter>("/api/accounting/cost-centers", { method: "POST", body: JSON.stringify(values) });
}

export function getVendors(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingVendor[]>(`/api/accounting/vendors${qs(params)}`);
}

export function createVendor(values: Partial<AccountingVendor>) {
  return apiFetch<AccountingVendor>("/api/accounting/vendors", { method: "POST", body: JSON.stringify(values) });
}

export function getCustomers(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingCustomer[]>(`/api/accounting/customers${qs(params)}`);
}

export function createCustomer(values: Partial<AccountingCustomer>) {
  return apiFetch<AccountingCustomer>("/api/accounting/customers", { method: "POST", body: JSON.stringify(values) });
}

export function getJournalEntries(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingJournalEntry[]>(`/api/accounting/journal-entries${qs(params)}`);
}

export function getJournalEntry(id: string) {
  return apiFetch<AccountingJournalEntry>(`/api/accounting/journal-entries/${id}`);
}

export function createJournalEntry(values: Record<string, unknown>) {
  return apiFetch<AccountingJournalEntry>("/api/accounting/journal-entries", { method: "POST", body: JSON.stringify(values) });
}

export function updateJournalEntry(id: string, values: Record<string, unknown>) {
  return apiFetch<AccountingJournalEntry>(`/api/accounting/journal-entries/${id}`, { method: "PATCH", body: JSON.stringify(values) });
}

export function postJournalEntry(id: string) {
  return apiFetch<AccountingJournalEntry>(`/api/accounting/journal-entries/${id}/post`, { method: "POST", body: "{}" });
}

export function reverseJournalEntry(id: string, reason?: string) {
  return apiFetch<AccountingJournalEntry>(`/api/accounting/journal-entries/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function getExpenses(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingExpense[]>(`/api/accounting/expenses${qs(params)}`);
}

export function getExpense(id: string) {
  return apiFetch<AccountingExpense>(`/api/accounting/expenses/${id}`);
}

export function createExpense(values: Record<string, unknown>) {
  return apiFetch<AccountingExpense>("/api/accounting/expenses", { method: "POST", body: JSON.stringify(values) });
}

export function approveExpense(id: string, values?: Record<string, unknown>) {
  return apiFetch<AccountingExpense>(`/api/accounting/expenses/${id}/approve`, { method: "POST", body: JSON.stringify(values || {}) });
}

export function rejectExpense(id: string, reason?: string) {
  return apiFetch<AccountingExpense>(`/api/accounting/expenses/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function payExpense(id: string, values?: Record<string, unknown>) {
  return apiFetch<AccountingExpense>(`/api/accounting/expenses/${id}/pay`, { method: "POST", body: JSON.stringify(values || {}) });
}

export function getInvoices(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingInvoice[]>(`/api/accounting/invoices${qs(params)}`);
}

export function getInvoice(id: string) {
  return apiFetch<AccountingInvoice>(`/api/accounting/invoices/${id}`);
}

export function createInvoice(values: Record<string, unknown>) {
  return apiFetch<AccountingInvoice>("/api/accounting/invoices", { method: "POST", body: JSON.stringify(values) });
}

export function issueInvoice(id: string) {
  return apiFetch<AccountingInvoice>(`/api/accounting/invoices/${id}/issue`, { method: "POST", body: "{}" });
}

export function recordInvoicePayment(id: string, values: Record<string, unknown>) {
  return apiFetch<AccountingInvoice>(`/api/accounting/invoices/${id}/record-payment`, { method: "POST", body: JSON.stringify(values) });
}

export function getPayments(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingPayment[]>(`/api/accounting/payments${qs(params)}`);
}

export function createPayment(values: Record<string, unknown>) {
  return apiFetch<AccountingPayment>("/api/accounting/payments", { method: "POST", body: JSON.stringify(values) });
}

export function postPayment(id: string) {
  return apiFetch<AccountingPayment>(`/api/accounting/payments/${id}/post`, { method: "POST", body: "{}" });
}

export function getAccountingReport(name: string, params?: Record<string, string | undefined>) {
  return apiFetch<Record<string, unknown> | Record<string, unknown>[]>(`/api/accounting/reports/${name}${qs(params)}`);
}

export function createPayrollDraftEntry(month: string, payrollId?: string) {
  return apiFetch<AccountingJournalEntry>("/api/accounting/payroll/create-draft-entry", {
    method: "POST",
    body: JSON.stringify({ month, payroll_id: payrollId }),
  });
}

export function getPayrollAccountingStatus(month: string) {
  return apiFetch<PayrollAccountingStatus>(`/api/accounting/payroll/status${qs({ month })}`);
}

export function recordPayrollPayment(values: { month: string; amount?: number; account_id?: string; payment_date?: string; method?: string; reference_no?: string }) {
  return apiFetch<{ payment: AccountingPayment; journal: AccountingJournalEntry; status: PayrollAccountingStatus }>("/api/accounting/payroll/record-payment", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getAccountingSalesCompanies() {
  return apiFetch<AccountingSalesCompanyLink[]>("/api/accounting/sales/companies");
}

export function linkSalesCompanyCustomer(values: { company_id: string; customer_id: string }) {
  return apiFetch<{ company: AccountingSalesCompanyLink; customer: AccountingCustomer }>("/api/accounting/sales/link-company-customer", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function createInvoiceFromSalesLog(values: { sales_log_id: string; customer_id?: string }) {
  return apiFetch<AccountingInvoice>("/api/accounting/sales/create-invoice-from-log", {
    method: "POST",
    body: JSON.stringify(values),
  });
}
