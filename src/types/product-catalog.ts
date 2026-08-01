export type ProductCatalogCommissionType = "none" | "flat" | "percentage";

export type ProductCatalogProduct = {
  id: string;
  organization_id: string;
  company_id: string;
  name: string;
  description: string | null;
  unit: string | null;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  model: string | null;
  price: number;
  default_cost: number;
  revenue_account_id: string | null;
  agent_commission_type: "flat" | "percentage" | null;
  agent_commission_value: number;
  inventory_enabled: boolean;
  tracking_mode: "serialized" | "none";
  inventory_version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  company?: { id: string; name: string; code: string | null } | null;
};
export type ProductCatalogOptions = {
  enabled: boolean;
  companies: Array<{ id: string; name: string; code: string | null }>;
  revenue_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    name_en: string | null;
  }>;
};

export type ProductCatalogImportClassification =
  | "new"
  | "existing_unchanged"
  | "existing_update"
  | "ambiguous"
  | "identifier_conflict"
  | "duplicate_in_file"
  | "invalid";

export type ProductCatalogImportRow = {
  id: string;
  source_sheet: string;
  source_row: number;
  raw_values: Record<string, unknown>;
  normalized_values: Record<string, unknown>;
  classification: ProductCatalogImportClassification;
  errors: string[];
  warnings: string[];
  matched_product_id: string | null;
  matched_inventory_version: number | null;
  suggested_changes: Record<string, { before: unknown; after: unknown }>;
};

export type ProductCatalogImportAnalysis = {
  id: string;
  company_id: string;
  status: "ready" | "needs_review" | "committing" | "committed" | "failed" | "expired";
  source_type: "excel" | "csv";
  original_filename: string;
  selected_sheet: string;
  header_row: number;
  mapping: Record<string, string>;
  confidence: number;
  summary: Record<ProductCatalogImportClassification, number> & { total: number };
  warnings: string[];
  blocking_errors: string[];
  algorithm_version: string;
  analysis_version: number;
  expires_at: string;
  committed_at: string | null;
  created_at: string;
  company?: { id: string; name: string; code: string | null } | null;
};
