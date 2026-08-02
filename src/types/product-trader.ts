export type ProductTraderHandoverStatus =
  | "issued"
  | "accepted"
  | "partially_accepted"
  | "rejected"
  | "cancelled"
  | "completed"
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
  line_status: "pending" | "accepted" | "rejected_missing" | "rejected_damaged" | "sold" | "returned" | "lost" | "damaged" | "cancelled";
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
  source_agent?: { id: string; full_name: string } | null;
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
  sales: ProductTraderSale[];
  price_overrides: ProductTraderPriceOverride[];
  collections: ProductTraderCollection[];
  commissions: ProductTraderCommission[];
  balances: ProductTraderBalance[];
  returns: ProductTraderReturn[];
  losses: ProductTraderLoss[];
};

export type ProductTraderCollection = { id:string; collection_no:string; merchant_id:string; source_agent_id:string; amount:number; currency:string; payment_method:string; collection_date:string; status:string; accounting_status:string; version:number; submitted_at:string; merchant?:{business_name:string}|null };
export type ProductTraderCommission = { id:string; sale_id:string; beneficiary_type:"merchant"|"field_agent"; merchant_id:string|null; agent_id:string|null; amount:number; currency:string; status:string; settlement_method:"payable"|"netted"; accrued_at:string };
export type ProductTraderBalance = { organization_id:string; merchant_id:string; source_agent_id:string; business_name:string; sales_total:number; organization_receivable:number; confirmed_collections:number; outstanding:number; merchant_commission:number; agent_commission:number; currency:string };
export type ProductTraderReturn = { id:string;unit_id:string;merchant_id:string;source_agent_id:string;reason:string;condition:string;evidence_path:string;status:string;requested_at:string;version:number;merchant?:{business_name:string}|null;unit?:{raw_serial_number:string;product?:{name:string}|null}|null };
export type ProductTraderLoss = { id:string;unit_id:string;merchant_id:string|null;source_agent_id:string;loss_type:string;reason:string;evidence_path:string;status:string;unit_cost_snapshot:number;reported_at:string;version:number;merchant?:{business_name:string}|null;unit?:{raw_serial_number:string;product?:{name:string}|null}|null };

export type ProductTraderSale = {
  id: string; sale_no: string; merchant_id: string; source_agent_id: string; sale_date: string;
  customer_name: string | null; payment_method: string; subtotal: number; vat_amount: number;
  total_amount: number; merchant_commission_amount: number; agent_chain_commission_amount: number;
  organization_receivable_amount: number; currency:string; net_commission_at_settlement:boolean; status: string; accounting_status: string; created_at: string;
  merchant?: { business_name: string } | null;
  lines?: Array<{ unit_id: string; serial_snapshot: string; product_name_snapshot: string; actual_sale_price: number }>;
};

export type ProductTraderPriceOverride = {
  id: string; unit_id: string; merchant_id: string; source_agent_id: string; requested_price: number;
  approved_price: number | null; currency: string; reason: string; status: string; requested_at: string;
  review_note: string | null; version: number;
  merchant?: { business_name: string } | null;
  unit?: { raw_serial_number: string; product?: { name: string } | null } | null;
};
