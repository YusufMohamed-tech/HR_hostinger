import type {
  AccountingAccount,
  AccountingAccountTemplate,
  AccountingAllocationRule,
  AccountingApprovalPolicy,
  AccountingApprovalRequest,
  AccountingAssetCategory,
  AccountingAssetMaintenance,
  AccountingAssetRevaluation,
  AccountingAssetTransfer,
  AccountingBankAccount,
  AccountingBankReconciliation,
  AccountingBankStatement,
  AccountingBranch,
  AccountingBook,
  AccountingCashForecast,
  AccountingCashPosition,
  AccountingCloseChecklistTemplate,
  AccountingCloseRun,
  AccountingCostCenter,
  AccountingCreditNote,
  AccountingCurrency,
  AccountingCustomer,
  AccountingDebitNote,
  AccountingDepreciationRun,
  AccountingDimensionPolicy,
  AccountingDimensionType,
  AccountingDimensionValue,
  AccountingBudgetControlRule,
  AccountingBudgetTransfer,
  AccountingCommitment,
  AccountingDunningPolicy,
  AccountingExchangeRate,
  AccountingConsolidationGroup,
  AccountingConsolidationRun,
  AccountingDashboardWidget,
  AccountingEliminationRule,
  AccountingImportDefinition,
  AccountingImportRun,
  AccountingIntercompanyAgreement,
  AccountingIntercompanyTransaction,
  AccountingReportDefinition,
  AccountingReportRun,
  AccountingReportSchedule,
  AccountingTaxCode,
  AccountingVatReturn,
  AccountingWithholdingCertificate,
  AccountingZatcaDevice,
  AccountingZatcaSubmission,
  AccountingExpense,
  AccountingFiscalCalendar,
  AccountingFixedAsset,
  AccountingInvoice,
  AccountingJournalEntry,
  AccountingLegalEntity,
  AccountingNontradeItem,
  AccountingOpeningBalanceBatch,
  AccountingParty,
  AccountingPayment,
  AccountingProject,
  AccountingPaymentBatch,
  AccountingRecognitionSchedule,
  AccountingRecurringSchedule,
  AccountingRecurringTemplate,
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

export function deleteJournalEntry(id: string) {
  return apiFetch(`/api/accounting/journal-entries/${id}`, { method: "DELETE", body: "{}" });
}

export function deleteExpense(id: string) {
  return apiFetch(`/api/accounting/expenses/${id}`, { method: "DELETE", body: "{}" });
}

export function deleteInvoice(id: string) {
  return apiFetch(`/api/accounting/invoices/${id}`, { method: "DELETE", body: "{}" });
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

// Phase 3: GL Workflow services

export function getApprovalPolicies() {
  return apiFetch<AccountingApprovalPolicy[]>("/api/accounting/approval-policies");
}

export function getApprovalPolicy(id: string) {
  return apiFetch<AccountingApprovalPolicy>(`/api/accounting/approval-policies/${id}`);
}

export function saveApprovalPolicy(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingApprovalPolicy>(`/api/accounting/approval-policies${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getApprovalRequests(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingApprovalRequest[]>(`/api/accounting/approval-requests${qs(params)}`);
}

export function submitApprovalRequest(values: Record<string, unknown>) {
  return apiFetch<AccountingApprovalRequest>("/api/accounting/approval-requests", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function decideApproval(requestId: string, values: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/approval-requests/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getRecurringTemplates() {
  return apiFetch<AccountingRecurringTemplate[]>("/api/accounting/recurring-templates");
}

export function getRecurringTemplate(id: string) {
  return apiFetch<AccountingRecurringTemplate & { lines: Record<string, unknown>[]; schedules: AccountingRecurringSchedule[] }>(`/api/accounting/recurring-templates/${id}`);
}

export function saveRecurringTemplate(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingRecurringTemplate>(`/api/accounting/recurring-templates${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getRecurringSchedules() {
  return apiFetch<AccountingRecurringSchedule[]>("/api/accounting/recurring-schedules");
}

export function saveRecurringSchedule(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingRecurringSchedule>(`/api/accounting/recurring-schedules${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getRecognitionSchedules() {
  return apiFetch<AccountingRecognitionSchedule[]>("/api/accounting/recognition-schedules");
}

export function getRecognitionSchedule(id: string) {
  return apiFetch<AccountingRecognitionSchedule & { lines: Record<string, unknown>[] }>(`/api/accounting/recognition-schedules/${id}`);
}

export function saveRecognitionSchedule(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingRecognitionSchedule>(`/api/accounting/recognition-schedules${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getOpeningBalanceBatches() {
  return apiFetch<AccountingOpeningBalanceBatch[]>("/api/accounting/opening-balances");
}

export function saveOpeningBalanceBatch(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingOpeningBalanceBatch>(`/api/accounting/opening-balances${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function approveOpeningBalanceBatch(id: string) {
  return apiFetch<AccountingOpeningBalanceBatch>(`/api/accounting/opening-balances/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getCloseChecklistTemplates() {
  return apiFetch<AccountingCloseChecklistTemplate[]>("/api/accounting/close-checklist-templates");
}

export function saveCloseChecklistTemplate(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingCloseChecklistTemplate>(`/api/accounting/close-checklist-templates${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getCloseRuns() {
  return apiFetch<AccountingCloseRun[]>("/api/accounting/close-runs");
}

export function getCloseRun(id: string) {
  return apiFetch<AccountingCloseRun & { tasks: Record<string, unknown>[] }>(`/api/accounting/close-runs/${id}`);
}

export function startCloseRun(values: Record<string, unknown>) {
  return apiFetch<AccountingCloseRun>("/api/accounting/close-runs", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function completeCloseTask(runId: string, taskId: string, values?: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/close-runs/${runId}/complete-task`, {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, ...values }),
  });
}

export function completeCloseRun(runId: string) {
  return apiFetch<AccountingCloseRun>(`/api/accounting/close-runs/${runId}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// Phase 4: Treasury services

export function getBankAccounts() {
  return apiFetch<AccountingBankAccount[]>("/api/accounting/bank-accounts");
}

export function getBankAccount(id: string) {
  return apiFetch<AccountingBankAccount>(`/api/accounting/bank-accounts/${id}`);
}

export function saveBankAccount(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingBankAccount>(`/api/accounting/bank-accounts${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getBankStatements(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingBankStatement[]>(`/api/accounting/bank-statements${qs(params)}`);
}

export function getBankStatement(id: string) {
  return apiFetch<AccountingBankStatement & { lines: Record<string, unknown>[] }>(`/api/accounting/bank-statements/${id}`);
}

export function saveBankStatement(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingBankStatement>(`/api/accounting/bank-statements${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getBankReconciliations(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingBankReconciliation[]>(`/api/accounting/bank-reconciliations${qs(params)}`);
}

export function getBankReconciliation(id: string) {
  return apiFetch<AccountingBankReconciliation & { matches: Record<string, unknown>[] }>(`/api/accounting/bank-reconciliations/${id}`);
}

export function startBankReconciliation(values: Record<string, unknown>) {
  return apiFetch<AccountingBankReconciliation>("/api/accounting/bank-reconciliations", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function addReconciliationMatch(reconciliationId: string, values: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/bank-reconciliations/${reconciliationId}/match`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function completeReconciliation(reconciliationId: string) {
  return apiFetch<AccountingBankReconciliation>(`/api/accounting/bank-reconciliations/${reconciliationId}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getCashPositions(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingCashPosition[]>(`/api/accounting/cash-positions${qs(params)}`);
}

export function getCashForecasts() {
  return apiFetch<AccountingCashForecast[]>("/api/accounting/cash-forecasts");
}

export function getCashForecast(id: string) {
  return apiFetch<AccountingCashForecast & { lines: Record<string, unknown>[] }>(`/api/accounting/cash-forecasts/${id}`);
}

export function saveCashForecast(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingCashForecast>(`/api/accounting/cash-forecasts${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getPaymentBatches() {
  return apiFetch<AccountingPaymentBatch[]>("/api/accounting/payment-batches");
}

export function getPaymentBatch(id: string) {
  return apiFetch<AccountingPaymentBatch & { items: Record<string, unknown>[] }>(`/api/accounting/payment-batches/${id}`);
}

export function savePaymentBatch(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingPaymentBatch>(`/api/accounting/payment-batches${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function approvePaymentBatch(id: string) {
  return apiFetch<AccountingPaymentBatch>(`/api/accounting/payment-batches/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// Phase 5: Fixed Asset services

export function getAssetCategories() {
  return apiFetch<AccountingAssetCategory[]>("/api/accounting/asset-categories");
}

export function saveAssetCategory(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingAssetCategory>(`/api/accounting/asset-categories${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getFixedAssets(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingFixedAsset[]>(`/api/accounting/fixed-assets${qs(params)}`);
}

export function getFixedAsset(id: string) {
  return apiFetch<AccountingFixedAsset & { depreciation_schedule: Record<string, unknown>[]; revaluations: AccountingAssetRevaluation[]; transfers: AccountingAssetTransfer[]; maintenance: AccountingAssetMaintenance[] }>(`/api/accounting/fixed-assets/${id}`);
}

export function saveFixedAsset(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingFixedAsset>(`/api/accounting/fixed-assets${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function disposeFixedAsset(id: string, values: Record<string, unknown>) {
  return apiFetch<AccountingFixedAsset>(`/api/accounting/fixed-assets/${id}/dispose`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function revalueFixedAsset(id: string, values: Record<string, unknown>) {
  return apiFetch<AccountingAssetRevaluation>(`/api/accounting/fixed-assets/${id}/revalue`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function transferFixedAsset(id: string, values: Record<string, unknown>) {
  return apiFetch<AccountingAssetTransfer>(`/api/accounting/fixed-assets/${id}/transfer`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function addAssetMaintenance(assetId: string, values: Record<string, unknown>) {
  return apiFetch<AccountingAssetMaintenance>(`/api/accounting/fixed-assets/${assetId}/maintenance`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getDepreciationRuns() {
  return apiFetch<AccountingDepreciationRun[]>("/api/accounting/depreciation-runs");
}

export function createDepreciationRun(values: Record<string, unknown>) {
  return apiFetch<AccountingDepreciationRun>("/api/accounting/depreciation-runs", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Phase 6: AR/AP/Party services

export function getParties(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingParty[]>(`/api/accounting/parties${qs(params)}`);
}

export function getParty(id: string) {
  return apiFetch<AccountingParty>(`/api/accounting/parties/${id}`);
}

export function saveParty(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingParty>(`/api/accounting/parties${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getCreditNotes(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingCreditNote[]>(`/api/accounting/credit-notes${qs(params)}`);
}

export function saveCreditNote(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingCreditNote>(`/api/accounting/credit-notes${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function issueCreditNote(id: string) {
  return apiFetch<AccountingCreditNote>(`/api/accounting/credit-notes/${id}/issue`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getDebitNotes(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingDebitNote[]>(`/api/accounting/debit-notes${qs(params)}`);
}

export function saveDebitNote(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingDebitNote>(`/api/accounting/debit-notes${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function issueDebitNote(id: string) {
  return apiFetch<AccountingDebitNote>(`/api/accounting/debit-notes/${id}/issue`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getNontradeItems(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingNontradeItem[]>(`/api/accounting/nontrade-items${qs(params)}`);
}

export function saveNontradeItem(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingNontradeItem>(`/api/accounting/nontrade-items${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function allocatePayment(values: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>("/api/accounting/payment-allocations", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getDunningPolicies() {
  return apiFetch<AccountingDunningPolicy[]>("/api/accounting/dunning-policies");
}

export function saveDunningPolicy(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingDunningPolicy>(`/api/accounting/dunning-policies${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Phase 7: Projects, Commitments, Budget services

export function getProjects(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingProject[]>(`/api/accounting/projects${qs(params)}`);
}

export function getProject(id: string) {
  return apiFetch<AccountingProject & { tasks: Record<string, unknown>[] }>(`/api/accounting/projects/${id}`);
}

export function saveProject(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingProject>(`/api/accounting/projects${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function saveProjectTask(projectId: string, values: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getCommitments(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingCommitment[]>(`/api/accounting/commitments${qs(params)}`);
}

export function getCommitment(id: string) {
  return apiFetch<AccountingCommitment & { consumptions: Record<string, unknown>[] }>(`/api/accounting/commitments/${id}`);
}

export function saveCommitment(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingCommitment>(`/api/accounting/commitments${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function consumeCommitment(commitmentId: string, values: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/commitments/${commitmentId}/consume`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getBudgetTransfers() {
  return apiFetch<AccountingBudgetTransfer[]>("/api/accounting/budget-transfers");
}

export function createBudgetTransfer(values: Record<string, unknown>) {
  return apiFetch<AccountingBudgetTransfer>("/api/accounting/budget-transfers", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function approveBudgetTransfer(id: string) {
  return apiFetch<AccountingBudgetTransfer>(`/api/accounting/budget-transfers/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getBudgetControlRules() {
  return apiFetch<AccountingBudgetControlRule[]>("/api/accounting/budget-control-rules");
}

export function saveBudgetControlRule(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingBudgetControlRule>(`/api/accounting/budget-control-rules${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Phase 8: VAT/ZATCA services

export function getTaxCodes() {
  return apiFetch<AccountingTaxCode[]>("/api/accounting/tax-codes");
}

export function saveTaxCode(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingTaxCode>(`/api/accounting/tax-codes${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getVatReturns() {
  return apiFetch<AccountingVatReturn[]>("/api/accounting/vat-returns");
}

export function saveVatReturn(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingVatReturn>(`/api/accounting/vat-returns${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function fileVatReturn(id: string) {
  return apiFetch<AccountingVatReturn>(`/api/accounting/vat-returns/${id}/file`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getZatcaSubmissions(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingZatcaSubmission[]>(`/api/accounting/zatca-submissions${qs(params)}`);
}

export function saveZatcaSubmission(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingZatcaSubmission>(`/api/accounting/zatca-submissions${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getZatcaDevices() {
  return apiFetch<AccountingZatcaDevice[]>("/api/accounting/zatca-devices");
}

export function saveZatcaDevice(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingZatcaDevice>(`/api/accounting/zatca-devices${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getWithholdingCertificates(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingWithholdingCertificate[]>(`/api/accounting/withholding-certificates${qs(params)}`);
}

export function saveWithholdingCertificate(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingWithholdingCertificate>(`/api/accounting/withholding-certificates${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Phase 9: Intercompany/Consolidation services

export function getICagreements() {
  return apiFetch<AccountingIntercompanyAgreement[]>("/api/accounting/ic-agreements");
}

export function saveICagreement(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingIntercompanyAgreement>(`/api/accounting/ic-agreements${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getICTransactions(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingIntercompanyTransaction[]>(`/api/accounting/ic-transactions${qs(params)}`);
}

export function saveICTransaction(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingIntercompanyTransaction>(`/api/accounting/ic-transactions${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function confirmICTransaction(id: string) {
  return apiFetch<AccountingIntercompanyTransaction>(`/api/accounting/ic-transactions/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getConsolidationGroups() {
  return apiFetch<AccountingConsolidationGroup[]>("/api/accounting/consolidation-groups");
}

export function getConsolidationGroup(id: string) {
  return apiFetch<AccountingConsolidationGroup & { members: Record<string, unknown>[] }>(`/api/accounting/consolidation-groups/${id}`);
}

export function saveConsolidationGroup(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingConsolidationGroup>(`/api/accounting/consolidation-groups${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getConsolidationRuns(params?: Record<string, string | undefined>) {
  return apiFetch<AccountingConsolidationRun[]>(`/api/accounting/consolidation-runs${qs(params)}`);
}

export function startConsolidationRun(values: Record<string, unknown>) {
  return apiFetch<AccountingConsolidationRun>("/api/accounting/consolidation-runs", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function approveConsolidationRun(id: string) {
  return apiFetch<AccountingConsolidationRun>(`/api/accounting/consolidation-runs/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getEliminationRules() {
  return apiFetch<AccountingEliminationRule[]>("/api/accounting/elimination-rules");
}

export function saveEliminationRule(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingEliminationRule>(`/api/accounting/elimination-rules${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Phase 10: Reporting/Import/Dashboard services

export function getReportDefinitions() {
  return apiFetch<AccountingReportDefinition[]>("/api/accounting/report-definitions");
}

export function saveReportDefinition(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingReportDefinition>(`/api/accounting/report-definitions${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getReportSchedules() {
  return apiFetch<AccountingReportSchedule[]>("/api/accounting/report-schedules");
}

export function saveReportSchedule(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingReportSchedule>(`/api/accounting/report-schedules${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getReportRuns() {
  return apiFetch<AccountingReportRun[]>("/api/accounting/report-runs");
}

export function createReportRun(values: Record<string, unknown>) {
  return apiFetch<AccountingReportRun>("/api/accounting/report-runs", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getImportDefinitions() {
  return apiFetch<AccountingImportDefinition[]>("/api/accounting/import-definitions");
}

export function saveImportDefinition(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingImportDefinition>(`/api/accounting/import-definitions${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getImportRuns() {
  return apiFetch<AccountingImportRun[]>("/api/accounting/import-runs");
}

export function createImportRun(values: Record<string, unknown>) {
  return apiFetch<AccountingImportRun>("/api/accounting/import-runs", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getAuditLog(params?: Record<string, string | undefined>) {
  return apiFetch<Record<string, unknown>[]>(`/api/accounting/audit-log${qs(params)}`);
}

export function getDashboardWidgets() {
  return apiFetch<AccountingDashboardWidget[]>("/api/accounting/dashboard-widgets");
}

export function saveDashboardWidget(values: Record<string, unknown>, id?: string) {
  return apiFetch<AccountingDashboardWidget>(`/api/accounting/dashboard-widgets${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

// Journal Attachments
export function getJournalAttachments(journalEntryId: string) {
  return apiFetch<Array<{ id: string; file_name: string; file_path: string; file_size: number; mime_type: string; description: string | null; uploaded_by: string; uploaded_at: string }>>(`/api/accounting/journal-entries/${journalEntryId}/attachments`);
}

export function addJournalAttachment(journalEntryId: string, values: { file_name: string; file_path: string; file_size: number; mime_type: string; description?: string; checksum_sha256?: string }) {
  return apiFetch<Record<string, unknown>>(`/api/accounting/journal-entries/${journalEntryId}/attachments`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function deleteJournalAttachment(journalEntryId: string, attachmentId: string) {
  return apiFetch<{ deleted: boolean }>(`/api/accounting/journal-entries/${journalEntryId}/attachments/${attachmentId}/delete`, {
    method: "POST",
    body: "{}",
  });
}

// Account Search
export function searchAccounts(query: string, limit = 30) {
  return apiFetch<Array<{ id: string; code: string; name_ar: string; name_en: string | null; type: string; normal_balance: string; parent_id: string | null; is_active: boolean }>>(`/api/accounting/accounts/search${qs({ q: query, limit: String(limit) })}`);
}

// Journal Types
export interface JournalType {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  prefix: string;
  number_format: string;
  sequence_reset: "never" | "yearly" | "monthly";
  current_sequence: number;
  is_default: boolean;
  is_active: boolean;
  allowed_roles: string[];
  requires_approval: boolean;
  auto_post: boolean;
}

export function getJournalTypes() {
  return apiFetch<JournalType[]>("/api/accounting/journal-types");
}

export function saveJournalType(values: Record<string, unknown>, id?: string) {
  return apiFetch<JournalType>(`/api/accounting/journal-types${id ? `/${id}` : ""}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function deactivateJournalType(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/accounting/journal-types/${id}/deactivate`, { method: "POST", body: "{}" });
}

// Permissions
export function getMyPermissions() {
  return apiFetch<string[]>("/api/accounting/permissions/me");
}

export function getAllPermissions() {
  return apiFetch<Array<{ id: string; role: string; permission: string }>>("/api/accounting/permissions");
}

export function grantPermission(role: string, permission: string) {
  return apiFetch<Record<string, unknown>>("/api/accounting/permissions/grant", {
    method: "POST",
    body: JSON.stringify({ role, permission }),
  });
}

export function revokePermission(role: string, permission: string) {
  return apiFetch<{ ok: boolean }>("/api/accounting/permissions/revoke", {
    method: "POST",
    body: JSON.stringify({ role, permission }),
  });
}
