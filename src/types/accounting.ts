export type AccountingRole = "Finance_Manager" | "Accountant" | "Finance_Viewer";

export type AccountingAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountingNormalBalance = "debit" | "credit";
export type AccountingJournalStatus = "draft" | "pending_approval" | "posted" | "reversed" | "cancelled";
export type AccountingInvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled" | "void";
export type AccountingExpenseStatus = "draft" | "pending_approval" | "approved" | "rejected" | "paid" | "cancelled";
export type AccountingPaymentStatus = "draft" | "posted" | "cancelled";
export type AccountingPaymentType = "customer_receipt" | "vendor_payment" | "payroll_payment" | "employee_advance" | "manual";
export type AccountingPaymentDirection = "inbound" | "outbound";
export type AccountingCostCenterType = "department" | "location" | "project" | "sales_company" | "branch" | "channel" | "custom";

export interface AccountingAccount {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: AccountingAccountType;
  subtype: string | null;
  parent_id: string | null;
  normal_balance: AccountingNormalBalance;
  is_system: boolean;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingCostCenter {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: AccountingCostCenterType;
  reference_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingJournalLine {
  id?: string;
  organization_id?: string;
  journal_entry_id?: string;
  account_id: string;
  debit: number;
  credit: number;
  description?: string | null;
  cost_center_id?: string | null;
  employee_id?: string | null;
  department_id?: string | null;
  location_id?: string | null;
}

export interface AccountingJournalEntry {
  id: string;
  organization_id: string;
  entry_no: string;
  entry_date: string;
  description: string;
  source_module: string;
  source_id: string | null;
  status: AccountingJournalStatus;
  currency: string;
  total_debit: number;
  total_credit: number;
  reversal_of: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  lines?: AccountingJournalLine[];
}

export interface AccountingVendor {
  id: string;
  organization_id: string;
  name_ar: string;
  name_en: string | null;
  vat_number: string | null;
  commercial_registration: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  bank_name?: string | null;
  iban?: string | null;
  is_active: boolean;
}

export interface AccountingTaxRate {
  id: string;
  organization_id: string;
  name_ar: string;
  name_en: string | null;
  rate: number;
  tax_account_id: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface AccountingCustomer extends AccountingVendor {
  sales_company_id: string | null;
  version: number;
}

export interface AccountingInvoiceLine {
  id?: string;
  description_ar: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  vat_amount: number;
  line_total: number;
  product_id?: string | null;
  tax_rate_id?: string | null;
  revenue_account_id?: string | null;
  cost_center_id?: string | null;
}

export interface AccountingInvoice {
  id: string;
  organization_id: string;
  customer_id: string | null;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  status: AccountingInvoiceStatus;
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  currency: string;
  journal_entry_id: string | null;
  version: number;
  lines?: AccountingInvoiceLine[];
}

export interface AccountingExpense {
  id: string;
  organization_id: string;
  expense_no: string;
  vendor_id: string | null;
  employee_id: string | null;
  expense_date: string;
  category_account_id: string | null;
  payment_account_id: string | null;
  cost_center_id: string | null;
  description: string;
  amount_before_vat: number;
  vat_amount: number;
  total_amount: number;
  status: AccountingExpenseStatus;
  paid_status: "unpaid" | "partially_paid" | "paid";
  rejection_reason?: string | null;
  attachment_url?: string | null;
  journal_entry_id: string | null;
  version: number;
}

export interface AccountingPayment {
  id: string;
  organization_id: string;
  payment_no: string;
  payment_date: string;
  type: AccountingPaymentType;
  direction: AccountingPaymentDirection;
  amount: number;
  currency: string;
  account_id?: string | null;
  counterpart_account_id?: string | null;
  cost_center_id?: string | null;
  description?: string | null;
  attachment_url?: string | null;
  status: AccountingPaymentStatus;
  journal_entry_id: string | null;
  version: number;
}

export type PayrollAccountingStatusValue = "not_generated" | "draft_created" | "posted" | "paid";

export interface PayrollAccountingStatus {
  month: string;
  payroll_id: string | null;
  payroll_run_status: "draft" | "approved" | "paid" | "void" | null;
  formula_version: string | null;
  payroll_run_version: number | null;
  status: PayrollAccountingStatusValue;
  payslip_count: number;
  total_net: number;
  advance_deductions: number;
  journal_entry_id: string | null;
  journal_entry_no: string | null;
  journal_status: AccountingJournalStatus | null;
  payment_id: string | null;
  payment_no: string | null;
  payment_status: AccountingPaymentStatus | null;
  payment_journal_entry_id: string | null;
  payment_journal_entry_no: string | null;
}

export interface AccountingSettings {
  id: string;
  organization_id: string;
  default_cash_account_id: string | null;
  default_bank_account_id: string | null;
  default_accounts_receivable_id: string | null;
  default_accounts_payable_id: string | null;
  default_sales_revenue_id: string | null;
  default_vat_payable_id: string | null;
  default_vat_receivable_id: string | null;
  default_salary_expense_id: string | null;
  default_salary_payable_id: string | null;
  default_employee_advances_id: string | null;
  default_asset_account_id: string | null;
  default_depreciation_expense_id: string | null;
  default_accumulated_depreciation_id: string | null;
  default_commission_expense_id: string | null;
  default_commission_payable_id: string | null;
  // Phase 7: GOSI
  default_gosi_payable_id: string | null;
  default_gosi_expense_id: string | null;
  // Phase 5: EOSB
  default_eosb_expense_id: string | null;
  default_eosb_provision_id: string | null;
  // Phase 6: Leave encashment
  default_leave_encashment_id: string | null;
  // Phase 2: Allowances
  default_allowances_expense_id: string | null;
  // Auto-posting toggles (schema_v44)
  auto_post_sales: boolean;
  auto_post_payroll: boolean;
  auto_post_advances: boolean;
  auto_post_assets: boolean;
  auto_post_eosb: boolean;
  fiscal_year_start_month: number;
  invoice_prefix: string;
  expense_prefix: string;
  journal_prefix: string;
  payment_prefix: string;
}

export interface AccountingReportRow {
  account_id?: string;
  account_code?: string;
  account_name?: string;
  debit: number;
  credit: number;
  balance: number;
  [key: string]: unknown;
}

export interface AccountingSalesCompanyLink {
  id: string;
  name: string;
  code: string | null;
  brand_color: string | null;
  is_active: boolean;
  accounting_customer_id: string | null;
  accounting_customer?: Pick<AccountingCustomer, "id" | "name_ar"> | null;
}

export interface SalesCommissionSummary {
  unpaid_agent_total: number;
  unpaid_merchant_total: number;
  paid_total: number;
  total_commission_expense: number;
}

export type CommissionPaymentMethod = "cash" | "bank_transfer" | "wallet" | "other";

export interface BaseCommissionFinanceRow {
  id: string;
  organization_id: string;
  beneficiary_type: "agent" | "merchant";
  sim_unit_id: string;
  sim_package_id: string | null;
  sale_id: string | null;
  sale_price: number;
  commission_currency: string;
  commission_type: "percentage" | "flat";
  commission_rate: number;
  commission_amount: number;
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  payment_method: CommissionPaymentMethod | null;
  payment_reference: string | null;
  finance_notes: string | null;
  accounting_journal_entry_id: string | null;
  created_at: string;
  updated_at: string;
  beneficiary_name: string;
  agent_name: string;
  owner_agent_name?: string;
  package_name: string;
  package_provider: string;
  sim_label: string;
  sim_iccid: string;
  sim_kit_code: string;
  sale_date: string;
  sale_customer_name: string | null;
}

export interface AgentCommissionFinanceRow extends BaseCommissionFinanceRow {
  beneficiary_type: "agent";
  agent_id: string;
}

export interface MerchantCommissionFinanceRow extends BaseCommissionFinanceRow {
  beneficiary_type: "merchant";
  merchant_id: string;
  agent_id: string;
}

export interface SalesCommissionsResponse {
  summary: SalesCommissionSummary;
  agent_commissions: AgentCommissionFinanceRow[];
  merchant_commissions: MerchantCommissionFinanceRow[];
}

export interface CommissionSettlementPayload {
  beneficiary_type: "agent" | "merchant";
  commission_ids: string[];
  payment_method: CommissionPaymentMethod;
  payment_reference?: string;
  finance_notes?: string;
  payment_date?: string;
  account_id?: string;
  command_id?: string;
}

// Multi-entity types (Phase 1)

export type LegalEntityStatus = "draft" | "active" | "suspended" | "closed";
export type BookType = "statutory" | "management" | "tax" | "consolidation_adjustment";
export type BookStatus = "active" | "suspended" | "closed";
export type ExchangeRateType = "spot" | "average" | "closing" | "historical";
export type UserScopeCapability = "full" | "branch_only" | "view_only";

export interface AccountingLegalEntity {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  trade_name_ar: string | null;
  trade_name_en: string | null;
  commercial_registration: string | null;
  vat_number: string | null;
  tax_identification_number: string | null;
  country: string;
  address: string | null;
  city: string | null;
  functional_currency_code: string;
  fiscal_calendar_id: string | null;
  default_language: "ar" | "en";
  timezone: string;
  status: LegalEntityStatus;
  consolidation_parent_id: string | null;
  is_default: boolean;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingBranch {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  parent_branch_id: string | null;
  location_id: string | null;
  tax_registration_override: string | null;
  default_cost_center_id: string | null;
  is_active: boolean;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingBook {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  book_type: BookType;
  functional_currency_code: string;
  fiscal_calendar_id: string | null;
  status: BookStatus;
  is_default: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AccountingUserScope {
  id: string;
  organization_id: string;
  user_id: string;
  legal_entity_id: string;
  branch_id: string | null;
  capability_group: UserScopeCapability;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  granted_by: string | null;
  granted_at: string;
  created_at: string;
  updated_at: string;
}

export interface AccountingCurrency {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  symbol: string | null;
  minor_units: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingExchangeRate {
  id: string;
  organization_id: string;
  from_currency_code: string;
  to_currency_code: string;
  rate_date: string;
  rate_type: ExchangeRateType;
  rate: string;
  source: string | null;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingFiscalCalendar {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  start_month: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingEntityContext {
  organizationId: string;
  legalEntityId: string;
  branchId?: string;
  bookId?: string;
  functionalCurrency: string;
  fiscalCalendarId?: string;
  locale: "ar" | "en";
  timezone: string;
}

// Dimensions and COA types (Phase 2)

export type DimensionCategory = "branch" | "cost_center" | "profit_center" | "department" | "region" | "project" | "contract" | "product_line" | "employee" | "location" | "custom";
export type DimensionRequirement = "required" | "optional" | "blocked";
export type AllocationMethod = "percentage" | "fixed" | "driver";
export type AllocationFrequency = "monthly" | "quarterly" | "annually" | "on_demand";
export type AccountControlType = "none" | "customer" | "vendor" | "asset" | "bank" | "cash" | "employee" | "tax";

export interface AccountingDimensionType {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  category: DimensionCategory;
  is_hierarchical: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AccountingDimensionValue {
  id: string;
  organization_id: string;
  dimension_type_id: string;
  legal_entity_id: string | null;
  code: string;
  name_ar: string;
  name_en: string | null;
  parent_id: string | null;
  reference_table: string | null;
  reference_id: string | null;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingDimensionPolicy {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  account_id: string | null;
  account_type: string | null;
  dimension_type_id: string;
  requirement: DimensionRequirement;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingAllocationRule {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  code: string;
  name_ar: string;
  name_en: string | null;
  source_account_id: string | null;
  source_dimension_type_id: string | null;
  source_dimension_value_id: string | null;
  method: AllocationMethod;
  frequency: AllocationFrequency;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingAllocationRuleLine {
  id: string;
  rule_id: string;
  organization_id: string;
  target_dimension_type_id: string | null;
  target_dimension_value_id: string | null;
  target_account_id: string | null;
  weight: string;
  sort_order: number;
  created_at: string;
}

export interface AccountingAccountTemplate {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  version: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Phase 3: GL Workflow types

export type ApprovalDocumentType = "journal" | "payment" | "expense" | "invoice" | "budget" | "write_off" | "period_reopen";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "returned" | "cancelled";
export type ApprovalDecision = "approve" | "reject" | "return";
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "annually";
export type RecurringRunStatus = "completed" | "failed" | "skipped";
export type RecognitionScheduleType = "accrual" | "prepayment" | "deferred_revenue";
export type RecognitionMethod = "straight_line" | "custom";
export type RecognitionScheduleStatus = "active" | "suspended" | "terminated" | "completed";
export type RecognitionLineStatus = "pending" | "posted" | "skipped";
export type OpeningBalanceBatchType = "trial_balance" | "customer_items" | "vendor_items" | "asset_register" | "bank_positions" | "historical_journals";
export type OpeningBalanceStatus = "draft" | "validated" | "approved" | "posted" | "locked" | "rejected";
export type CloseType = "soft" | "hard";
export type CloseRunStatus = "in_progress" | "completed" | "failed" | "cancelled";
export type CloseTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped" | "exception";

export interface AccountingApprovalPolicy {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  name_ar: string;
  name_en: string | null;
  document_type: ApprovalDocumentType;
  min_amount: number | null;
  max_amount: number | null;
  currency_code: string | null;
  source_module: string | null;
  branch_id: string | null;
  required_steps: number;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AccountingApprovalStep {
  id: string;
  policy_id: string;
  organization_id: string;
  step_number: number;
  required_capability: string;
  required_approver_count: number;
  created_at: string;
}

export interface AccountingApprovalRequest {
  id: string;
  organization_id: string;
  policy_id: string;
  policy_version: number;
  target_type: string;
  target_id: string;
  current_step: number;
  status: ApprovalRequestStatus;
  submitted_by: string | null;
  submitted_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface AccountingApprovalDecision {
  id: string;
  request_id: string;
  organization_id: string;
  step_number: number;
  decision: ApprovalDecision;
  actor_user_id: string;
  reason: string | null;
  decided_at: string;
}

export interface AccountingRecurringTemplate {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  branch_id: string | null;
  book_id: string | null;
  currency_code: string;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingRecurringSchedule {
  id: string;
  organization_id: string;
  template_id: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  auto_submit: boolean;
  auto_post: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingRecurringRun {
  id: string;
  organization_id: string;
  schedule_id: string;
  run_date: string;
  journal_entry_id: string | null;
  status: RecurringRunStatus;
  error_message: string | null;
  created_at: string;
}

export interface AccountingRecognitionSchedule {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  name_ar: string;
  name_en: string | null;
  schedule_type: RecognitionScheduleType;
  source_document_type: string | null;
  source_document_id: string | null;
  total_amount: number;
  recognized_amount: number;
  remaining_amount: number;
  currency_code: string;
  debit_account_id: string | null;
  credit_account_id: string | null;
  start_date: string;
  end_date: string;
  recognition_method: RecognitionMethod;
  status: RecognitionScheduleStatus;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingRecognitionLine {
  id: string;
  schedule_id: string;
  organization_id: string;
  period_date: string;
  amount: number;
  journal_entry_id: string | null;
  status: RecognitionLineStatus;
  created_at: string;
}

export interface AccountingOpeningBalanceBatch {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  batch_type: OpeningBalanceBatchType;
  name: string;
  as_of_date: string;
  total_debit: number;
  total_credit: number;
  row_count: number;
  error_count: number;
  status: OpeningBalanceStatus;
  journal_entry_id: string | null;
  uploaded_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingCloseChecklistTemplate {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  name_ar: string;
  name_en: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingCloseRun {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  period_id: string | null;
  checklist_template_id: string | null;
  close_type: CloseType;
  status: CloseRunStatus;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface AccountingCloseTask {
  id: string;
  close_run_id: string;
  organization_id: string;
  task_order: number;
  name_ar: string;
  name_en: string | null;
  status: CloseTaskStatus;
  assignee_id: string | null;
  completed_by: string | null;
  completed_at: string | null;
  exception_reason: string | null;
  exception_approved_by: string | null;
  created_at: string;
  updated_at: string;
}

// Phase 4: Treasury types

export type BankStatementImportSource = "manual" | "csv" | "mt940" | "camt053" | "api";
export type BankStatementStatus = "imported" | "in_progress" | "reconciled" | "closed";
export type BankStatementLineStatus = "unmatched" | "matched" | "reconciled" | "excluded";
export type ReconciliationStatus = "in_progress" | "completed" | "approved";
export type ReconciliationMatchMethod = "auto_exact" | "auto_fuzzy" | "manual" | "rule_based";
export type CashForecastCategory = "receivable" | "payable" | "payroll" | "tax" | "loan" | "capex" | "other_inflow" | "other_outflow";
export type CashForecastStatus = "draft" | "published" | "archived";
export type PaymentBatchStatus = "draft" | "approved" | "sent_to_bank" | "processed" | "partially_processed" | "failed";
export type PaymentBatchItemStatus = "pending" | "processed" | "failed" | "rejected";

export interface AccountingBankAccount {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  account_id: string;
  bank_name_ar: string;
  bank_name_en: string | null;
  branch_name: string | null;
  iban: string | null;
  account_number: string | null;
  swift_code: string | null;
  currency_code: string;
  opening_balance: number;
  current_balance: number;
  is_default: boolean;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AccountingBankStatement {
  id: string;
  organization_id: string;
  bank_account_id: string;
  statement_date: string;
  opening_balance: number;
  closing_balance: number;
  total_debits: number;
  total_credits: number;
  transaction_count: number;
  import_source: BankStatementImportSource | null;
  file_url: string | null;
  status: BankStatementStatus;
  created_at: string;
  updated_at: string;
}

export interface AccountingBankStatementLine {
  id: string;
  organization_id: string;
  statement_id: string;
  bank_account_id: string;
  transaction_date: string;
  value_date: string | null;
  amount: number;
  direction: "debit" | "credit";
  description: string | null;
  reference: string | null;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  category: string | null;
  status: BankStatementLineStatus;
  matched_payment_id: string | null;
  matched_journal_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingBankReconciliation {
  id: string;
  organization_id: string;
  bank_account_id: string;
  statement_id: string | null;
  reconciliation_date: string;
  statement_balance: number;
  book_balance: number;
  adjusted_book_balance: number | null;
  difference: number;
  matched_count: number;
  unmatched_count: number;
  status: ReconciliationStatus;
  reconciled_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingCashPosition {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  position_date: string;
  bank_account_id: string;
  opening_balance: number;
  inflows: number;
  outflows: number;
  closing_balance: number;
  currency_code: string;
  created_at: string;
}

export interface AccountingCashForecast {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  name: string;
  forecast_date: string;
  horizon_days: number;
  status: CashForecastStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingPaymentBatch {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  bank_account_id: string;
  name: string;
  payment_date: string;
  total_amount: number;
  payment_count: number;
  status: PaymentBatchStatus;
  file_format: string | null;
  file_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Phase 5: Fixed Asset types

export type DepreciationMethod = "straight_line" | "declining_balance" | "double_declining" | "sum_of_years" | "units_of_production";
export type FixedAssetStatus = "draft" | "active" | "fully_depreciated" | "disposed" | "impaired" | "suspended";
export type AssetDisposalMethod = "sale" | "scrap" | "donation" | "write_off" | "transfer";
export type DepreciationScheduleStatus = "scheduled" | "posted" | "skipped" | "adjusted";
export type DepreciationRunStatus = "completed" | "reversed" | "failed";
export type AssetMaintenanceType = "preventive" | "corrective" | "upgrade" | "inspection";

export interface AccountingAssetCategory {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  code: string;
  name_ar: string;
  name_en: string | null;
  parent_id: string | null;
  asset_account_id: string | null;
  depreciation_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  disposal_gain_account_id: string | null;
  disposal_loss_account_id: string | null;
  default_useful_life_months: number | null;
  default_depreciation_method: DepreciationMethod | null;
  default_salvage_rate: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountingFixedAsset {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  branch_id: string | null;
  category_id: string | null;
  asset_number: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  serial_number: string | null;
  barcode: string | null;
  location: string | null;
  custodian_employee_id: string | null;
  acquisition_date: string;
  in_service_date: string | null;
  acquisition_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: DepreciationMethod;
  depreciation_start_date: string | null;
  accumulated_depreciation: number;
  net_book_value: number;
  current_value: number | null;
  currency_code: string;
  status: FixedAssetStatus;
  disposal_date: string | null;
  disposal_amount: number | null;
  disposal_method: AssetDisposalMethod | null;
  vendor_id: string | null;
  warranty_expiry_date: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingDepreciationRun {
  id: string;
  organization_id: string;
  legal_entity_id: string | null;
  run_date: string;
  period_from: string;
  period_to: string;
  asset_count: number;
  total_depreciation: number;
  journal_entry_id: string | null;
  status: DepreciationRunStatus;
  run_by: string | null;
  created_at: string;
}

export interface AccountingAssetRevaluation {
  id: string;
  organization_id: string;
  asset_id: string;
  revaluation_date: string;
  previous_value: number;
  new_value: number;
  adjustment_amount: number;
  reason: string | null;
  journal_entry_id: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AccountingAssetTransfer {
  id: string;
  organization_id: string;
  asset_id: string;
  transfer_date: string;
  from_branch_id: string | null;
  to_branch_id: string | null;
  from_location: string | null;
  to_location: string | null;
  from_custodian_id: string | null;
  to_custodian_id: string | null;
  reason: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AccountingAssetMaintenance {
  id: string;
  organization_id: string;
  asset_id: string;
  maintenance_date: string;
  maintenance_type: AssetMaintenanceType;
  description: string | null;
  cost: number;
  capitalize: boolean;
  vendor_id: string | null;
  next_maintenance_date: string | null;
  journal_entry_id: string | null;
  created_by: string | null;
  created_at: string;
}
