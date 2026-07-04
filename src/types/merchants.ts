import type { AgentStatus, PaymentMethod, SimRequestStatus } from "@/types/field-agents";

export interface Merchant {
  id: string;
  organization_id: string;
  agent_id: string;
  user_id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  location: string | null;
  sim_price: number;
  commission_rate: number;
  status: AgentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantSimRequest {
  id: string;
  organization_id: string;
  merchant_id: string;
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

export interface MerchantCashCollection {
  id: string;
  organization_id: string;
  merchant_id: string;
  agent_id: string;
  amount: number;
  payment_method: PaymentMethod;
  collected_by: string;
  collection_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantCommission {
  id: string;
  organization_id: string;
  merchant_id: string;
  agent_id: string;
  sim_unit_id: string;
  sale_price: number;
  commission_rate: number;
  commission_amount: number;
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
}

// Derived shapes

export interface MerchantBalance {
  total_owed: number; // merchant.sim_price × sold SIMs
  total_collected: number; // cash paid to the agent
  outstanding: number; // total_owed - total_collected
}

export interface MerchantStockSummary {
  in_hand: number;
  sold_total: number;
  in_hand_value: number;
}

export interface MerchantDashboardData {
  merchant: Merchant;
  balance: MerchantBalance;
  stock: MerchantStockSummary;
  pending_requests: number;
  unpaid_commission: number;
}

export interface MerchantWithStats extends Merchant {
  in_hand: number;
  sold_total: number;
  outstanding: number;
}

// Analytics

export interface ResellerRanking {
  merchant_id: string;
  business_name: string;
  sold_total: number;
  sold_value: number;
}
