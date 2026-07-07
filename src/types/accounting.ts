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
}

export type PayrollAccountingStatusValue = "not_generated" | "draft_created" | "posted" | "paid";

export interface PayrollAccountingStatus {
  month: string;
  payroll_id: string;
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
  create_accounting_entry?: boolean;
}
