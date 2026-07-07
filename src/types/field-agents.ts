export type SimStatus = "in_stock" | "with_agent" | "with_merchant" | "sold" | "returned";
export type SimTransferType =
  | "assign_to_agent"
  | "return_to_stock"
  | "assign_to_merchant"
  | "return_from_merchant"
  | "sold"
  | "initial_import";
export type SimRequestStatus = "pending" | "approved" | "rejected" | "delivered";
export type PaymentMethod = "cash" | "bank_transfer" | "visa" | "electronic";
export type PaymentStatus = "pending" | "confirmed" | "rejected";
export type AgentStatus = "active" | "suspended";
export type PackageCommissionType = "percentage" | "flat";

export interface SimPackage {
  id: string;
  organization_id: string;
  provider: string;
  package_name: string;
  internet_allowance: string | null;
  minutes_allowance: string | null;
  validity: string | null;
  base_price: number;
  sale_price: number;
  tax_included: boolean;
  agent_commission_type: PackageCommissionType;
  agent_commission_value: number;
  merchant_commission_type: PackageCommissionType;
  merchant_commission_value: number;
  status: "active" | "inactive";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldAgent {
  id: string;
  organization_id: string;
  user_id: string;
  full_name: string;
  phone: string;
  national_id: string;
  region: string | null;
  commission_rate: number;
  sim_price: number;
  max_sim_capacity: number | null;
  status: AgentStatus;
  joined_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimUnit {
  id: string;
  organization_id: string;
  iccid: string;
  kit_code: string | null;
  provider: string;
  sim_type: string;
  price: number;
  status: SimStatus;
  current_agent_id: string | null;
  assigned_at: string | null;
  sold_at: string | null;
  sold_by_agent_id: string | null;
  sold_price: number | null;
  sold_package_id: string | null;
  sold_package_name: string | null;
  customer_name: string | null;
  current_merchant_id: string | null;
  sold_by_merchant_id: string | null;
  merchant_assigned_at: string | null;
  import_batch_id: string | null;
  dealer_box_number: number | null;
  box_sequence: number | null;
  import_source: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimTransfer {
  id: string;
  organization_id: string;
  sim_unit_id: string;
  transfer_type: SimTransferType;
  from_agent_id: string | null;
  to_agent_id: string | null;
  from_merchant_id: string | null;
  to_merchant_id: string | null;
  performed_by: string;
  notes: string | null;
  transfer_date: string;
  created_at: string;
}

export interface AgentCashCollection {
  id: string;
  organization_id: string;
  agent_id: string;
  amount: number;
  payment_method: PaymentMethod;
  collected_by: string;
  collection_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSimRequest {
  id: string;
  organization_id: string;
  agent_id: string;
  quantity: number;
  sim_type: string | null;
  notes: string | null;
  status: SimRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentCommission {
  id: string;
  organization_id: string;
  agent_id: string;
  sim_unit_id: string;
  sim_package_id: string | null;
  sale_price: number;
  commission_type: PackageCommissionType;
  commission_rate: number;
  commission_amount: number;
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
}

// Derived / aggregated shapes used by UI

export interface AgentBalance {
  total_sold_value: number; // manager-set sim_price × sold SIMs by agent/merchant chain
  total_collected: number; // sum of all cash collections
  outstanding: number; // total_sold_value - total_collected
}

export interface AgentStockSummary {
  in_hand: number; // SIMs with_agent
  sold_total: number; // SIMs sold
  in_hand_value: number;
}

export interface AgentDashboardData {
  agent: FieldAgent;
  balance: AgentBalance;
  stock: AgentStockSummary;
  pending_requests: number;
  unpaid_commission: number;
}

export interface StockOverview {
  in_stock: number;
  with_agents: number;
  with_merchants: number;
  sold: number;
  returned: number;
  total_value_in_stock: number;
  by_agent: { agent_id: string; full_name: string; count: number }[];
}

export interface SimImportBatch {
  id: string;
  organization_id: string;
  provider: string;
  order_number: string | null;
  batch_number: string | null;
  barcode_text: string | null;
  dealer_box_number: number | null;
  dealer_box_total: number | null;
  first_kitcode: string;
  last_kitcode: string;
  quantity: number;
  step: number | null;
  image_path: string | null;
  extracted_json: Record<string, unknown>;
  generated_preview: GeneratedKitCodeRow[];
  status: "draft" | "confirmed" | "cancelled" | "failed";
  imported_count: number;
  duplicate_count: number;
  assigned_agent_id: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimBoxExtractedLabel extends Record<string, unknown> {
  provider: string | null;
  order_number: string | null;
  batch_number: string | null;
  barcode_text: string | null;
  first_kitcode: string | null;
  last_kitcode: string | null;
  quantity: number | null;
  dealer_box_number: number | null;
  dealer_box_total: number | null;
  confidence?: number;
  raw_notes?: string[];
  raw_ocr_text?: string;
}

export interface GeneratedKitCodeRow {
  sequence: number;
  kit_code: string;
  is_duplicate?: boolean;
}

export interface SimBoxPreviewResult {
  extracted: SimBoxExtractedLabel;
  generation: {
    step: number;
    generated_count: number;
    kit_codes: string[];
  };
  validation: {
    is_valid: boolean;
    errors: string[];
    warnings: string[];
    duplicate_kit_codes: string[];
    duplicate_count: number;
  };
  image_path: string;
}

export interface SimBoxImportConfirmPayload {
  provider: string;
  order_number?: string;
  batch_number?: string;
  barcode_text?: string;
  first_kitcode: string;
  last_kitcode: string;
  quantity: number;
  dealer_box_number?: number | null;
  dealer_box_total?: number | null;
  step?: number;
  image_path?: string;
  extracted_json?: Record<string, unknown>;
  assigned_agent_id?: string | null;
  import_duplicate_strategy?: "skip" | "fail";
}

// Row shapes joined for admin tables

export interface FieldAgentWithStats extends FieldAgent {
  in_hand: number;
  sold_total: number;
  outstanding: number;
}
