export type ProductTraderHandoverStatus =
  | "issued"
  | "accepted"
  | "partially_accepted"
  | "rejected"
  | "cancelled"
  | "expired";

export type ProductTraderHandoverLine = {
  id: string;
  handover_id: string;
  unit_id: string;
  product_id: string;
  serial_snapshot: string;
  product_name_snapshot: string;
  planned_sale_price_snapshot: number | null;
  minimum_sale_price_snapshot: number | null;
  maximum_sale_price_snapshot: number | null;
  currency: string;
  line_status: "pending" | "accepted" | "rejected_missing" | "rejected_damaged" | "cancelled";
  accepted_condition: string | null;
  accepted_at: string | null;
  closed_at: string | null;
};

export type ProductTraderHandover = {
  id: string;
  handover_no: string;
  source_agent_id: string;
  merchant_id: string;
  status: ProductTraderHandoverStatus;
  require_acknowledgment: boolean;
  expires_at: string | null;
  issued_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  version: number;
  merchant?: { id: string; business_name: string; owner_name: string | null } | null;
  source_agent?: { id: string; agent_code: string; employee?: { full_name: string } | null } | null;
  lines: ProductTraderHandoverLine[];
};

export type ProductTraderUnit = {
  id: string;
  product_id: string;
  raw_serial_number: string;
  status: string;
  condition: string;
  planned_sale_price_snapshot: number | null;
  minimum_sale_price_snapshot: number | null;
  maximum_sale_price_snapshot: number | null;
  currency: string;
  current_agent_id: string | null;
  current_merchant_id: string | null;
  product?: { id?: string; name: string; sku: string; model: string | null } | null;
};

export type ProductTraderMerchant = {
  id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  city: string | null;
  agent_id: string;
};

export type ProductTraderWorkspace = {
  enabled: boolean;
  require_acknowledgment: boolean;
  require_signature: boolean;
  max_handover_units: number;
  identity: { id: string; name: string; kind: "agent" | "merchant" };
  merchants: ProductTraderMerchant[];
  available_units: ProductTraderUnit[];
  held_units: ProductTraderUnit[];
  handovers: ProductTraderHandover[];
};
