export type ProductInventoryReceiptStatus =
  | "draft"
  | "needs_review"
  | "ready_to_confirm"
  | "confirmed"
  | "cancelled"
  | "failed";

export type ProductInventoryAccountingStatus =
  | "pending"
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
  currency: string;
  created_at: string;
  product?: { name: string; sku: string | null; model: string | null } | null;
  warehouse?: { name_ar: string; name_en: string | null } | null;
};

export type ManualReceiptGroupInput = {
  product_id: string;
  unit_cost: number;
  planned_sale_price: number;
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
