import type {
  AccountingAccount,
  AccountingAccountTemplate,
  AccountingAllocationRule,
  AccountingBranch,
  AccountingBook,
  AccountingCostCenter,
  AccountingCurrency,
  AccountingCustomer,
  AccountingDimensionPolicy,
  AccountingDimensionType,
  AccountingDimensionValue,
  AccountingExchangeRate,
  AccountingExpense,
  AccountingFiscalCalendar,
  AccountingInvoice,
  AccountingJournalEntry,
  AccountingLegalEntity,
  AccountingPayment,
  AccountingSalesCompanyLink,
  AccountingSettings,
  AccountingTaxRate,
  AccountingUserScope,
  AccountingVendor,
  CommissionSettlementPayload,
  PayrollAccountingStatus,
  SalesCommissionsResponse,
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

export function getSalesCommissions(filters?: Record<string, string | undefined>) {
  return apiFetch<SalesCommissionsResponse>(`/api/accounting/commissions${qs(filters)}`);
}

export function settleSalesCommissions(payload: CommissionSettlementPayload) {
  return apiFetch<{ settled_count: number; total_amount: number }>("/api/accounting/commissions/settle", {
    method: "POST",
    body: JSON.stringify({ command_id: crypto.randomUUID(), ...payload }),
  });
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

export function deactivateAccountingAccount(id: string) {
  return apiFetch<AccountingAccount>(`/api/accounting/accounts/${id}`, { method: "DELETE" });
}

export function getCostCenters() {
  return apiFetch<AccountingCostCenter[]>("/api/accounting/cost-centers");
}

export function createCostCenter(values: Partial<AccountingCostCenter>) {
  return apiFetch<AccountingCostCenter>("/api/accounting/cost-centers", { method: "POST", body: JSON.stringify(values) });
}

export function updateCostCenter(id: string, values: Partial<AccountingCostCenter>) {
  return apiFetch<AccountingCostCenter>(`/api/accounting/cost-centers/${id}`, { method: "PATCH", body: JSON.stringify(values) });
}

export function deactivateCostCenter(id: string) {
  return apiFetch<AccountingCostCenter>(`/api/accounting/cost-centers/${id}`, { method: "DELETE" });
}

export function getVendors(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingVendor[]>(`/api/accounting/vendors${qs(params)}`);
}

export function createVendor(values: Partial<AccountingVendor>) {
  return apiFetch<AccountingVendor>("/api/accounting/vendors", { method: "POST", body: JSON.stringify(values) });
}

export function updateVendor(id: string, values: Partial<AccountingVendor>) {
  return apiFetch<AccountingVendor>(`/api/accounting/vendors/${id}`, { method: "PATCH", body: JSON.stringify(values) });
}

export function deactivateVendor(id: string) {
  return apiFetch<AccountingVendor>(`/api/accounting/vendors/${id}`, { method: "DELETE" });
}

export function getCustomers(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingCustomer[]>(`/api/accounting/customers${qs(params)}`);
}

export function createCustomer(values: Partial<AccountingCustomer>) {
  return apiFetch<AccountingCustomer>("/api/accounting/customers", {
    method: "POST",
    body: JSON.stringify({ command_id: crypto.randomUUID(), ...values }),
  });
}

export function updateCustomer(id: string, values: Partial<AccountingCustomer>) {
  return apiFetch<AccountingCustomer>(`/api/accounting/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ command_id: crypto.randomUUID(), ...values }),
  });
}

export function deactivateCustomer(id: string) {
  return apiFetch<AccountingCustomer>(`/api/accounting/customers/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ command_id: crypto.randomUUID() }),
  });
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

export function getTaxRates(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingTaxRate[]>(`/api/accounting/tax-rates${qs(params)}`);
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
    body: JSON.stringify({ command_id: crypto.randomUUID(), ...values }),
  });
}

export function createInvoiceFromSalesLog(values: { sales_log_id: string; customer_id?: string }) {
  return apiFetch<AccountingInvoice>("/api/accounting/sales/create-invoice-from-log", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Budgets
export function getAccountingBudgets() {
  return apiFetch<Record<string, unknown>[]>("/api/accounting/budgets");
}

export function getAccountingBudget(id: string) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/budgets/${id}`);
}

export function createAccountingBudget(values: { name: string; fiscal_year: number; lines?: Record<string, unknown>[] }) {
  return apiFetch<Record<string, unknown>>("/api/accounting/budgets", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function updateAccountingBudget(id: string, values: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/budgets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export function approveBudget(id: string) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/budgets/${id}/approve`, { method: "POST", body: "{}" });
}

// Periods
export function getAccountingPeriods() {
  return apiFetch<Record<string, unknown>[]>("/api/accounting/periods");
}

export function closePeriod(id: string) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/periods/${id}/close`, { method: "POST", body: "{}" });
}

export function reopenPeriod(id: string, reason: string, expectedVersion?: number) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/periods/${id}/reopen`, {
    method: "POST",
    body: JSON.stringify({ reason, expected_version: expectedVersion }),
  });
}

export function getAccountingReconciliation(params?: { date_from?: string; date_to?: string }) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/reports/reconciliation${qs(params || {})}`);
}

// Report Export
export function exportReport(report: string, format: string, params?: Record<string, string | undefined>) {
  return apiFetch<unknown>("/api/accounting/reports/export", {
    method: "POST",
    body: JSON.stringify({ report, format, ...params }),
  });
}

// Auto-Posting Endpoints
export function autoPostPayroll(month: string) {
  return apiFetch<{ success: boolean; journalEntryId?: string; month: string }>("/api/accounting/payroll/auto-post", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export function capitalizeAsset(values: { asset_id: string; asset_name: string; purchase_price: number; paid_immediately?: boolean }) {
  return apiFetch<{ success: boolean; journalEntryId?: string }>("/api/accounting/assets/capitalize", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function runDepreciation(month: string) {
  return apiFetch<{ success: boolean; journalEntryId?: string; assetsProcessed: number }>("/api/accounting/assets/run-depreciation", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export function runEOSBAccrual(month: string) {
  return apiFetch<{ success: boolean; journalEntryId?: string; employeesProcessed: number }>("/api/accounting/eosb/run-accrual", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export function settleEOSB(employeeId: string) {
  return apiFetch<{ success: boolean; journalEntryId?: string; settlementAmount: number }>("/api/accounting/eosb/settle", {
    method: "POST",
    body: JSON.stringify({ employee_id: employeeId }),
  });
}

export function recordGOSIPayment(values: { month: string; amount: number }) {
  return apiFetch<{ success: boolean; journalEntryId?: string }>("/api/accounting/gosi/record-payment", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Multi-entity management

export function getLegalEntities() {
  return apiFetch<AccountingLegalEntity[]>("/api/accounting/entities");
}

export function getAllowedEntities() {
  return apiFetch<AccountingLegalEntity[]>("/api/accounting/entities/allowed");
}

export function getLegalEntity(id: string) {
  return apiFetch<AccountingLegalEntity>(`/api/accounting/entities/${id}`);
}

export function saveLegalEntity(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingLegalEntity>(`/api/accounting/entities${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function changeLegalEntityStatus(id: string, status: string, expectedVersion: number) {
  return apiFetch<AccountingLegalEntity>(`/api/accounting/entities/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, expected_version: expectedVersion }),
  });
}

export function backfillDefaultEntity() {
  return apiFetch<{ legal_entity_id: string }>("/api/accounting/entities/backfill-default", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getAccountingBranches(legalEntityId?: string) {
  const params = legalEntityId ? `?legal_entity_id=${legalEntityId}` : "";
  return apiFetch<AccountingBranch[]>(`/api/accounting/branches${params}`);
}

export function saveAccountingBranch(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingBranch>(`/api/accounting/branches${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function deactivateAccountingBranch(id: string, expectedVersion: number) {
  return apiFetch<AccountingBranch>(`/api/accounting/branches/${id}/deactivate`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion }),
  });
}

export function getAccountingBooks(legalEntityId?: string) {
  const params = legalEntityId ? `?legal_entity_id=${legalEntityId}` : "";
  return apiFetch<AccountingBook[]>(`/api/accounting/books${params}`);
}

export function saveAccountingBook(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingBook>(`/api/accounting/books${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getAccountingUserScopes(legalEntityId?: string) {
  const params = legalEntityId ? `?legal_entity_id=${legalEntityId}` : "";
  return apiFetch<AccountingUserScope[]>(`/api/accounting/user-scopes${params}`);
}

export function saveAccountingUserScope(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingUserScope>(`/api/accounting/user-scopes${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function revokeAccountingUserScope(id: string) {
  return apiFetch<AccountingUserScope>(`/api/accounting/user-scopes/${id}/revoke`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getAccountingCurrencies() {
  return apiFetch<AccountingCurrency[]>("/api/accounting/currencies");
}

export function saveAccountingCurrency(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingCurrency>(`/api/accounting/currencies${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getAccountingExchangeRates(filters?: Record<string, string>) {
  const params = filters ? "?" + new URLSearchParams(filters).toString() : "";
  return apiFetch<AccountingExchangeRate[]>(`/api/accounting/exchange-rates${params}`);
}

export function saveAccountingExchangeRate(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingExchangeRate>(`/api/accounting/exchange-rates${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function approveAccountingExchangeRate(id: string) {
  return apiFetch<AccountingExchangeRate>(`/api/accounting/exchange-rates/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getAccountingFiscalCalendars() {
  return apiFetch<AccountingFiscalCalendar[]>("/api/accounting/fiscal-calendars");
}

export function saveAccountingFiscalCalendar(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingFiscalCalendar>(`/api/accounting/fiscal-calendars${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Dimensions and COA (Phase 2)

export function getDimensionTypes() {
  return apiFetch<AccountingDimensionType[]>("/api/accounting/dimension-types");
}

export function saveDimensionType(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingDimensionType>(`/api/accounting/dimension-types${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getDimensionValues(typeId?: string) {
  const params = typeId ? `?dimension_type_id=${typeId}` : "";
  return apiFetch<AccountingDimensionValue[]>(`/api/accounting/dimension-values${params}`);
}

export function saveDimensionValue(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingDimensionValue>(`/api/accounting/dimension-values${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getDimensionPolicies() {
  return apiFetch<AccountingDimensionPolicy[]>("/api/accounting/dimension-policies");
}

export function saveDimensionPolicy(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingDimensionPolicy>(`/api/accounting/dimension-policies${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getAllocationRules() {
  return apiFetch<AccountingAllocationRule[]>("/api/accounting/allocation-rules");
}

export function saveAllocationRule(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingAllocationRule>(`/api/accounting/allocation-rules${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getAccountTemplates() {
  return apiFetch<AccountingAccountTemplate[]>("/api/accounting/account-templates");
}

export function saveAccountTemplate(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingAccountTemplate>(`/api/accounting/account-templates${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function backfillCostCenterDimensions() {
  return apiFetch<{ count: number }>("/api/accounting/dimensions/backfill-cost-centers", {
    method: "POST",
    body: JSON.stringify({}),
  });
}
