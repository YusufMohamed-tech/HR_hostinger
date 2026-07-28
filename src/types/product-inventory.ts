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
