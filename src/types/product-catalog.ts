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
