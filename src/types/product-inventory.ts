export type ProductInventoryReceiptStatus =
  | "draft"
  | "needs_review"
  | "ready_to_confirm"
  | "confirmed"
  | "cancelled"
  | "failed";

export type ProductInventoryAccountingStatus =
  | "pending"
  | "pending_approval"
  | "not_required"
  | "posted"
  | "failed"
  | "reversed";

export type ProductInventoryProduct = {
  id: string;
  company_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  model: string | null;
  price: number;
  default_cost: number | null;
  agent_commission_type?: "flat" | "percentage" | null;
  agent_commission_value?: number;
};

export type ProductInventoryCompany = {
  id: string;
  name: string;
  code: string | null;
  brand_color: string | null;
};

export type ProductInventoryWarehouse = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  is_default: boolean;
};

export type ProductInventoryImportProfile = {
  id: string;
  name: string;
  version: number;
  supplier_company_id: string | null;
  sheet_name: string | null;
  use_first_sheet: boolean;
  header_row: number;
  header_mapping: Record<string, string>;
  required_fields: string[];
  default_currency: string;
  default_condition: "new" | "open_box" | "refurbished";
  default_ownership_type: "purchased" | "consignment";
  is_active: boolean;
  sample_file_sha256: string | null;
  approval_note: string | null;
  recognition_mode: "manual" | "automatic" | "reviewed";
  layout_fingerprint: string | null;
  source_analysis_id: string | null;
  mapping_confidence: Record<string, number>;
  workbook_shape: "row_per_device" | "continuation_rows" | "serial_columns" | null;
  recognition_version: string | null;
  approved_at: string | null;
  created_at: string;
};

export type ProductInventoryImportAnalysisStatus =
  | "analyzing"
  | "needs_review"
  | "ready"
  | "confirmed"
  | "failed"
  | "expired";

export type ProductInventoryImportFieldProposal = {
  field: string;
  header: string;
  column_index: number;
  column_letter: string;
  confidence: number;
  status: "confirmed" | "needs_review" | "unrecognized";
  evidence: string[];
};

export type ProductInventoryImportAnalysis = {
  id: string;
  template_name: string;
  supplier_company_id: string | null;
  managed_file_id: string;
  source_type: "excel" | "csv";
  original_name: string;
  file_sha256: string;
  status: ProductInventoryImportAnalysisStatus;
  algorithm_version: string;
  detected_sheet_name: string;
  detected_header_row: number;
  workbook_shape: "row_per_device" | "continuation_rows" | "serial_columns";
  layout_fingerprint: string;
  confidence: number;
  detected_mapping: Record<string, string>;
  field_proposals: ProductInventoryImportFieldProposal[];
  detected_metadata: Record<string, string>;
  sheet_scores: Array<{
    sheet_name: string;
    sheet_index: number;
    header_row: number;
    confidence: number;
    data_rows: number;
    recognized_fields: number;
    required_coverage: number;
  }>;
  sample_rows: Array<{ row_number: number; values: Array<string | number | boolean | null> }>;
  blocking_errors: string[];
  warnings: string[];
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
};

export type ProductInventoryCommercialTermInput = {
  receipt_line_id: string;
  sale_price: number;
  minimum_sale_price: number;
  maximum_sale_price: number;
  currency: string;
  commission_type: "none" | "flat" | "percentage";
  commission_value: number;
  commission_base: "net_amount" | "gross_amount";
  source?: "catalog_default" | "workbook_proposal" | "photo_proposal" | "finance";
  reason?: string;
};

export type ProductReceiptLine = {
  id: string;
  line_no: number;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string | null;
  model_snapshot: string | null;
  condition: "new" | "open_box" | "refurbished";
  expected_quantity: number;
  quantity: number;
  unit_cost: number;
  planned_unit_sale_price: number;
  minimum_sale_price: number;
  maximum_sale_price: number;
  commission_type: "none" | "flat" | "percentage";
  commission_value: number;
  commission_base: "net_amount" | "gross_amount";
  commercial_terms_revision: number;
  commercial_terms_approved_at: string | null;
  currency: string;
  total_cost: number;
  expected_sales_value: number;
  expected_margin: number;
  serial_numbers?: string[];
};

export type ProductReceipt = {
  id: string;
  receipt_no: string;
  supplier_company_id: string;
  warehouse_id: string;
  ownership_type: "purchased" | "consignment";
  receipt_date: string;
  delivery_note_no: string | null;
  supplier_invoice_no: string | null;
  invoice_received: boolean;
  currency: string;
  notes: string | null;
  status: ProductInventoryReceiptStatus;
  total_units: number;
  physical_total_cost: number;
  expected_sales_value: number;
  expected_margin: number;
  accounting_status: ProductInventoryAccountingStatus;
  version: number;
  created_at: string;
  confirmed_at: string | null;
  company?: ProductInventoryCompany | null;
  warehouse?: ProductInventoryWarehouse | null;
  lines?: ProductReceiptLine[];
  sources?: ProductReceiptSource[];
};

export type ProductReceiptSource = {
  id: string;
  source_type: "manual" | "excel" | "csv" | "photo";
  original_name: string | null;
  extraction_status: string;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  unmatched_rows: number;
  committed_at: string | null;
  created_at: string;
};

export type ProductInventoryStockRow = {
  id: string;
  product_id: string;
  raw_serial_number: string;
  status: string;
  condition: string;
  ownership_type: string;
  unit_cost_snapshot: number;
  planned_sale_price_snapshot: number;
  minimum_sale_price_snapshot?: number;
  maximum_sale_price_snapshot?: number;
  commission_type_snapshot?: "none" | "flat" | "percentage";
  commission_value_snapshot?: number;
  commission_base_snapshot?: "net_amount" | "gross_amount";
  commercial_terms_revision_snapshot?: number;
  currency: string;
  current_agent_id?: string | null;
  current_custodian_assignment_id?: string | null;
  current_custodian_employee_id?: string | null;
  current_project_id?: string | null;
  current_location_id?: string | null;
  current_city_snapshot?: string | null;
  current_handover_id?: string | null;
  current_sale_id?: string | null;
  assigned_at?: string | null;
  sold_at?: string | null;
  created_at: string;
  product?: { name: string; sku: string | null; model: string | null } | null;
  warehouse?: { name_ar: string; name_en: string | null } | null;
  agent?: { full_name: string } | null;
};

export type ProductInventoryOperationalAssignment = {
  id: string;
  organization_id: string;
  employee_id: string;
  project_id: string;
  location_id: string | null;
  city: string;
  position_code: "OGPM" | "OGSV1";
  responsibility: "project_manager" | "supervisor";
  can_receive_custody: boolean;
  can_sell: boolean;
  can_request_return: boolean;
  can_approve_return: boolean;
  status: "active" | "inactive";
  effective_from: string;
  effective_to: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  employee?: ProductInventoryCustodianEmployee | null;
  project?: ProductInventoryProject | null;
  location?: ProductInventoryLocation | null;
};

export type ProductInventoryCustodianEmployee = {
  id: string;
  user_id: string;
  employee_code: string | null;
  full_name: string;
  job_title: string | null;
  work_city: string | null;
};

export type ProductInventoryProject = {
  id: string;
  name: string;
  code: string | null;
};

export type ProductInventoryLocation = {
  id: string;
  name: string;
  city: string | null;
  project_id: string | null;
};

export type ManualReceiptGroupInput = {
  product_id: string;
  product_name?: string;
  unit_cost: number;
  planned_sale_price: number;
  minimum_sale_price: number;
  maximum_sale_price: number;
  commission_type: "none" | "flat" | "percentage";
  commission_value: number;
  commission_base: "net_amount" | "gross_amount";
  currency: string;
  tax_included: boolean;
  condition: "new" | "open_box" | "refurbished";
  serial_numbers: string[];
};

export type ManualReceiptInput = {
  receipt_id: string;
  expected_version: number;
  supplier_company_id: string;
  warehouse_id: string;
  ownership_type: "purchased" | "consignment";
  receipt_date: string;
  delivery_note_no?: string;
  supplier_invoice_no?: string;
  invoice_received?: boolean;
  currency: string;
  notes?: string;
  groups: ManualReceiptGroupInput[];
};

export type ProductInventoryImportRowStatus =
  | "valid"
  | "warning"
  | "invalid"
  | "duplicate"
  | "unmatched";

export type ProductInventoryImportRow = {
  row_number: number;
  raw_data: Record<string, string | number | boolean | null>;
  supplier_code: string;
  receipt_reference: string;
  product_sku: string;
  product_name: string;
  model: string;
  product_id: string;
  serial_number: string;
  normalized_serial: string;
  barcode: string;
  unit_cost: number | null;
  planned_sale_price: number | null;
  minimum_sale_price: number | null;
  maximum_sale_price: number | null;
  commission_type: "none" | "flat" | "percentage";
  commission_value: number | null;
  commission_base: "net_amount" | "gross_amount";
  currency: string;
  tax_code: string;
  condition: "new" | "open_box" | "refurbished";
  notes: string;
  status: ProductInventoryImportRowStatus;
  confidence: number;
  validation_errors: string[];
  validation_warnings: string[];
};

export type ProductInventoryWorkbookPreview = {
  receipt: ProductReceipt;
  source: {
    id: string;
    source_type: "excel" | "csv";
    original_name: string;
    total_rows: number;
    valid_rows: number;
    warning_rows: number;
    invalid_rows: number;
    duplicate_rows: number;
    unmatched_rows: number;
    file_sha256: string;
  };
  rows: ProductInventoryImportRow[];
  headers: string[];
};

export type ProductInventoryPhotoCandidate = {
  source_id: string;
  candidate_index: number;
  raw_product_name: string;
  raw_sku: string;
  raw_model: string;
  raw_serial: string;
  raw_barcode: string;
  product_id: string;
  serial_number: string;
  normalized_serial: string;
  unit_cost: number | null;
  planned_sale_price: number | null;
  minimum_sale_price: number | null;
  maximum_sale_price: number | null;
  commission_type: "none" | "flat" | "percentage";
  commission_value: number | null;
  commission_base: "net_amount" | "gross_amount";
  currency: string;
  condition: "new" | "open_box" | "refurbished";
  status: ProductInventoryImportRowStatus;
  confidence: number;
  match_method: "sku" | "barcode" | "name" | "alias" | "fuzzy" | "none";
  validation_errors: string[];
  validation_warnings: string[];
  save_as_alias: boolean;
};

export type ProductInventoryPhotoPreview = {
  receipt: ProductReceipt;
  sources: Array<{
    id: string;
    source_type: "photo";
    original_name: string;
    confidence: number | null;
    total_rows: number;
  }>;
  candidates: ProductInventoryPhotoCandidate[];
  counts: Record<ProductInventoryImportRowStatus, number>;
};

export type ProductInventoryFieldAgent = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  region: string | null;
  status: "active" | "suspended";
};

export type ProductHandoverLine = {
  id: string;
  handover_id: string;
  unit_id: string;
  product_id: string;
  planned_sale_price_snapshot: number;
  minimum_sale_price: number;
  maximum_sale_price: number;
  commission_type_snapshot: "none" | "flat" | "percentage";
  commission_value_snapshot: number;
  commission_base_snapshot: "net_amount" | "gross_amount";
  commercial_terms_revision_snapshot: number;
  currency: string;
  tax_included: boolean;
  line_status: "pending" | "accepted" | "sold" | "returned" | "voided" | "cancelled";
  unit?: ProductInventoryStockRow | null;
};

export type ProductHandover = {
  id: string;
  handover_no: string;
  warehouse_id: string;
  agent_id: string | null;
  handover_type?: "legacy_agent" | "employee_custody";
  recipient_assignment_id?: string | null;
  recipient_employee_id?: string | null;
  recipient_user_id_snapshot?: string | null;
  recipient_name_snapshot?: string | null;
  recipient_responsibility_snapshot?: "project_manager" | "supervisor" | null;
  position_code_snapshot?: "OGPM" | "OGSV1" | null;
  project_id?: string | null;
  project_name_snapshot?: string | null;
  location_id?: string | null;
  city_snapshot?: string | null;
  status: "issued" | "accepted" | "completed" | "cancelled";
  require_acknowledgment: boolean;
  notes: string | null;
  issued_at: string;
  accepted_at: string | null;
  version: number;
  agent?: ProductInventoryFieldAgent | null;
  warehouse?: ProductInventoryWarehouse | null;
  lines?: ProductHandoverLine[];
};

export type ProductEmployeeCustodyReportRow = {
  assignment_id: string;
  project_id: string;
  project_name: string;
  city: string;
  employee_id: string;
  recipient_name: string;
  responsibility: "project_manager" | "supervisor";
  position_code: "OGPM" | "OGSV1";
  received_units: number;
  ready_to_sell_units: number;
  return_pending_units: number;
  awaiting_delivery_units: number;
  physically_held_units: number;
  sold_units: number;
  returned_units: number;
};

export type ProductEmployeeCustodyManagerData = {
  assignments: ProductInventoryOperationalAssignment[];
  employees: ProductInventoryCustodianEmployee[];
  projects: ProductInventoryProject[];
  locations: ProductInventoryLocation[];
  warehouses: ProductInventoryWarehouse[];
  available_units: ProductInventoryStockRow[];
  handovers: ProductHandover[];
  report: ProductEmployeeCustodyReportRow[];
};

export type ProductEmployeeCustodyDashboardData = {
  employee: ProductInventoryCustodianEmployee;
  assignments: ProductInventoryOperationalAssignment[];
  pending_handovers: ProductHandover[];
  handovers: ProductHandover[];
  units: ProductInventoryStockRow[];
};

export type ProductReturnRequestStatus =
  | "pending_approval"
  | "approved_awaiting_delivery"
  | "rejected"
  | "partially_received"
  | "received"
  | "cancelled";

export type ProductReturnLineStatus =
  | "pending"
  | "awaiting_delivery"
  | "rejected"
  | "cancelled"
  | "received_sellable"
  | "received_quarantine"
  | "received_damaged";

export type ProductReturnAttachment = {
  id: string;
  return_request_id: string;
  return_line_id: string;
  original_name: string;
  detected_mime: "image/jpeg" | "image/png" | "image/webp";
  size_bytes: number;
  sha256: string;
  evidence_type: "requester_photo" | "finance_inspection_photo";
  captured_at: string | null;
  created_at: string;
};

export type ProductReturnApproval = {
  id: string;
  return_request_id: string;
  approver_type: "finance_manager" | "project_manager";
  assigned_approver_user_id: string | null;
  decision: "pending" | "approved" | "rejected";
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  version: number;
  is_assigned_to_me?: boolean;
};

export type ProductReturnRequestLine = {
  id: string;
  return_request_id: string;
  unit_id: string;
  handover_id: string;
  serial_snapshot: string;
  product_name_snapshot: string;
  requester_note: string;
  claimed_condition: "sealed" | "good" | "open_box" | "damaged" | "unknown";
  status: ProductReturnLineStatus;
  requested_at: string;
  received_at: string | null;
  inspection_note: string | null;
  version: number;
  attachments?: ProductReturnAttachment[];
};

export type ProductReturnReceipt = {
  id: string;
  return_request_id: string;
  warehouse_id: string;
  received_by: string;
  received_at: string;
  notes: string | null;
  status: "completed" | "discrepancy";
};

export type ProductReturnRequest = {
  id: string;
  return_no: string;
  requester_user_id: string;
  requester_employee_id: string;
  custodian_assignment_id: string;
  custodian_employee_id: string;
  project_id: string;
  project_name_snapshot: string;
  location_id: string | null;
  city_snapshot: string;
  position_code_snapshot: "OGPM" | "OGSV1";
  warehouse_id: string;
  approval_mode_snapshot: "both" | "project_manager" | "finance_manager" | "either";
  status: ProductReturnRequestStatus;
  reason_summary: string;
  version: number;
  submitted_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  completed_at: string | null;
  lines?: ProductReturnRequestLine[];
  approvals?: ProductReturnApproval[];
  receipts?: ProductReturnReceipt[];
  can_cancel?: boolean;
};

export type ProductReturnWorkspaceData = {
  access: {
    role: string;
    can_submit: boolean;
    can_review_finance: boolean;
    can_receive: boolean;
  };
  settings: {
    employee_custody_returns_enabled: boolean;
    return_approval_mode: "both" | "project_manager" | "finance_manager" | "either";
    require_return_photo: boolean;
    minimum_return_photos: number;
    maximum_return_photos: number;
  };
  warehouses: ProductInventoryWarehouse[];
  eligible_units: ProductInventoryStockRow[];
  requests: ProductReturnRequest[];
  report: ProductReturnReportRow[];
};

export type ProductReturnReportRow = {
  project_id: string;
  project_name: string;
  city: string;
  total_requests: number;
  pending_approval: number;
  awaiting_delivery: number;
  received_requests: number;
  rejected_requests: number;
  cancelled_requests: number;
  total_units: number;
  received_sellable: number;
  received_quarantine: number;
  received_damaged: number;
  average_approval_hours: number | null;
  average_delivery_hours: number | null;
};

export type ProductPriceOverrideRequest = {
  id: string;
  unit_id: string;
  handover_id: string;
  agent_id: string;
  requested_price: number;
  currency: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "used" | "cancelled";
  requested_at: string;
  review_note: string | null;
  version: number;
  unit?: ProductInventoryStockRow | null;
  agent?: ProductInventoryFieldAgent | null;
};

export type AgentProductSale = {
  id: string;
  sale_no: string;
  agent_id: string;
  sale_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_reference: string | null;
  payment_method: string;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  status: "active" | "voided";
  accounting_status: ProductInventoryAccountingStatus;
  version: number;
  created_at: string;
  agent?: ProductInventoryFieldAgent | null;
  lines?: Array<{
    id: string;
    unit_id: string;
    serial_snapshot: string;
    product_name_snapshot: string;
    unit_cost_snapshot: number;
    planned_sale_price_snapshot: number;
    actual_sale_price: number;
    net_amount: number;
    vat_amount: number;
    total_amount: number;
    gross_profit: number;
    currency: string;
    agent_commission_amount: number;
  }>;
};

export type AgentProductCollection = {
  id: string;
  collection_no: string;
  agent_id: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  collection_date: string;
  status: "posted" | "reversed";
  accounting_status: ProductInventoryAccountingStatus;
  version: number;
  created_at: string;
  agent?: ProductInventoryFieldAgent | null;
};

export type ProductInventoryAccountingPosting = {
  id: string;
  source_type: "receipt" | "sale" | "collection" | "loss";
  source_id: string;
  status: ProductInventoryAccountingStatus;
  journal_entry_id: string | null;
  reversal_entry_id: string | null;
  amounts: Record<string, number>;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  updated_at: string;
  journal?: {
    id: string;
    entry_no: string;
    status: string;
    total_debit: number;
    total_credit: number;
  } | null;
};

export type ProductInventoryAccountingSettings = {
  id: string;
  version: number;
  default_inventory_asset_id: string | null;
  default_inventory_grni_id: string | null;
  default_inventory_cogs_id: string | null;
  default_inventory_shrinkage_id: string | null;
  default_agent_receivable_id: string | null;
  default_accounts_payable_id: string | null;
  default_sales_revenue_id: string | null;
  default_vat_payable_id: string | null;
  default_cash_account_id: string | null;
  default_bank_account_id: string | null;
  default_commission_expense_id: string | null;
  default_commission_payable_id: string | null;
  auto_post_inventory_receipts: boolean;
  auto_post_product_sales: boolean;
  auto_post_product_collections: boolean;
  enable_product_agent_commissions: boolean;
};

export type ProductAgentCommission = {
  id: string;
  sale_id: string;
  agent_id: string;
  commission_amount: number;
  currency: string;
  status: "pending" | "accrued" | "settled" | "reversed";
  settled_at: string | null;
  agent?: { id: string; full_name: string } | null;
  sale?: { id: string; sale_no: string; sale_date: string; status: string } | null;
};

export type ProductCommerceManagerData = {
  settings: {
    require_agent_acknowledgment: boolean;
    default_price_tolerance_percent: number;
    max_handover_units: number;
  };
  agents: ProductInventoryFieldAgent[];
  warehouses: ProductInventoryWarehouse[];
  available_units: ProductInventoryStockRow[];
  available_units_pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  handovers: ProductHandover[];
  sales: AgentProductSale[];
  collections: AgentProductCollection[];
  price_overrides: ProductPriceOverrideRequest[];
  balances: Array<{
    agent_id: string;
    agent_name: string;
    active_sales: number;
    collected: number;
    outstanding: number;
    custody_cost: number;
    custody_retail: number;
  }>;
};

export type ProductAgentInventoryUnit = Omit<
  ProductInventoryStockRow,
  "unit_cost_snapshot" | "agent"
>;

export type ProductAgentHandoverLine = Omit<ProductHandoverLine, "unit"> & {
  unit?: ProductAgentInventoryUnit | null;
};

export type ProductAgentHandover = Omit<ProductHandover, "agent" | "lines"> & {
  lines?: ProductAgentHandoverLine[];
};

type AgentProductSaleLine = NonNullable<AgentProductSale["lines"]>[number];
export type ProductAgentSale = Omit<AgentProductSale, "agent" | "lines"> & {
  lines?: Array<Omit<AgentProductSaleLine, "unit_cost_snapshot" | "gross_profit">>;
};

export type ProductAgentPriceOverride = Omit<
  ProductPriceOverrideRequest,
  "agent" | "unit"
> & {
  unit?: ProductAgentInventoryUnit | null;
};

export type ProductAgentDashboardData = {
  agent: ProductInventoryFieldAgent;
  settings: {
    require_agent_acknowledgment: boolean;
    default_price_tolerance_percent: number;
  };
  warehouses: ProductInventoryWarehouse[];
  pending_handovers: ProductAgentHandover[];
  units: ProductAgentInventoryUnit[];
  handover_lines: ProductAgentHandoverLine[];
  sales: ProductAgentSale[];
  collections: AgentProductCollection[];
  price_overrides: ProductAgentPriceOverride[];
  totals: {
    custody_units: number;
    custody_retail: number;
    active_sales: number;
    collected: number;
    outstanding: number;
  };
};
