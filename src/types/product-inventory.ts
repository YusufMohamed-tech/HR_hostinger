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
  approved_at: string | null;
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
  current_handover_id?: string | null;
  current_sale_id?: string | null;
  assigned_at?: string | null;
  sold_at?: string | null;
  created_at: string;
  product?: { name: string; sku: string | null; model: string | null } | null;
  warehouse?: { name_ar: string; name_en: string | null } | null;
  agent?: { full_name: string } | null;
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
  agent_id: string;
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
