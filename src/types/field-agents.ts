export type SimStatus = "in_stock" | "with_agent" | "sold" | "returned";
export type SimTransferType = "assign_to_agent" | "return_to_stock" | "sold" | "initial_import";
export type SimRequestStatus = "pending" | "approved" | "rejected" | "delivered";
export type PaymentMethod = "cash" | "bank_transfer";
export type AgentStatus = "active" | "suspended";

export interface FieldAgent {
  id: string;
  organization_id: string;
  user_id: string;
  full_name: string;
  phone: string;
  national_id: string;
  region: string | null;
  commission_rate: number;
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
  sim_type: string;
  price: number;
  status: SimStatus;
  current_agent_id: string | null;
  assigned_at: string | null;
  sold_at: string | null;
  sold_by_agent_id: string | null;
  sold_price: number | null;
  customer_name: string | null;
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
  sale_price: number;
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
  total_sold_value: number; // sum of sold_price for all sold SIMs by agent
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
  sold: number;
  returned: number;
  total_value_in_stock: number;
  by_agent: { agent_id: string; full_name: string; count: number }[];
}

// Row shapes joined for admin tables

export interface FieldAgentWithStats extends FieldAgent {
  in_hand: number;
  sold_total: number;
  outstanding: number;
}
