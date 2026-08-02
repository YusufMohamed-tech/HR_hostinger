import type { ProductTraderCollection, ProductTraderLoss, ProductTraderPriceOverride, ProductTraderReturn, ProductTraderSale, ProductTraderWorkspace } from "@/types/product-trader";

type ApiResult<T> = { data: T | null; error: { message: string } | null };

async function request<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
    const payload = await response.json().catch(() => ({})) as { data?: T; message?: string };
    if (!response.ok) return { data: null, error: { message: payload.message || "تعذر تنفيذ الطلب." } };
    return { data: payload.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." } };
  }
}

export const productTraderCommandId = () => crypto.randomUUID();

export function getAgentProductTraderWorkspace() {
  return request<ProductTraderWorkspace>("/api/sales/inventory/trader-handovers");
}

export function issueProductTraderHandover(values: {
  handover_id: string; command_id: string; merchant_id: string; unit_ids: string[]; notes?: string;
}) {
  return request<Record<string, unknown>>("/api/sales/inventory/trader-handovers", {
    method: "POST", body: JSON.stringify(values),
  });
}

export function cancelProductTraderHandover(handoverId: string, version: number, reason: string) {
  return request<Record<string, unknown>>(`/api/sales/inventory/trader-handovers/${handoverId}/cancel`, {
    method: "POST", body: JSON.stringify({ command_id: productTraderCommandId(), expected_version: version, reason }),
  });
}

export function getMerchantProductTraderWorkspace() {
  return request<ProductTraderWorkspace>("/api/merchant/products/dashboard");
}

export function acceptProductTraderHandover(handoverId: string, values: {
  expected_version: number;
  accepted_unit_ids: string[];
  rejected_units: Array<{ unit_id: string; reason: "missing" | "damaged" }>;
  rejection_reason?: string;
  signature_data?: string;
}) {
  return request<Record<string, unknown>>(`/api/merchant/products/handovers/${handoverId}/accept`, {
    method: "POST", body: JSON.stringify({ command_id: productTraderCommandId(), ...values }),
  });
}

export function rejectProductTraderHandover(handoverId: string, version: number, rejectionReason: string) {
  return request<Record<string, unknown>>(`/api/merchant/products/handovers/${handoverId}/reject`, {
    method: "POST",
    body: JSON.stringify({ command_id: productTraderCommandId(), expected_version: version, rejection_reason: rejectionReason }),
  });
}

export function createProductTraderSale(values: {
  sale_id: string; unit_id: string; sale_price: number; payment_method: string; sale_date?: string;
  customer_name?: string; customer_phone?: string; customer_reference?: string; price_override_id?: string;
}) {
  return request<Record<string, unknown>>("/api/merchant/products/sales", {
    method: "POST", body: JSON.stringify({ command_id: productTraderCommandId(), ...values }),
  });
}

export function requestProductTraderPriceOverride(values: { unit_id: string; sale_price: number; reason: string }) {
  return request<Record<string, unknown>>("/api/merchant/products/price-overrides", {
    method: "POST", body: JSON.stringify({ override_id: crypto.randomUUID(), command_id: productTraderCommandId(), ...values }),
  });
}

export function getProductTraderFinanceWorkspace() {
  return request<{
    sales: ProductTraderSale[];
    price_overrides: ProductTraderPriceOverride[];
    collections: ProductTraderCollection[];
    returns: ProductTraderReturn[];
    losses: ProductTraderLoss[];
  }>("/api/sales/inventory/trader-prices");
}

export function reviewProductTraderPriceOverride(overrideId: string, values: { expected_version: number; decision: "approved" | "rejected"; review_note?: string }) {
  return request<Record<string, unknown>>(`/api/sales/inventory/trader-prices/${overrideId}/review`, {
    method: "POST", body: JSON.stringify({ command_id: productTraderCommandId(), ...values }),
  });
}

export function submitProductTraderCollection(values:{merchant_id?:string;amount:number;currency?:string;payment_method:string;collection_date?:string;payment_reference?:string}){
  return request<Record<string,unknown>>(values.merchant_id?"/api/sales/inventory/trader-collections":"/api/merchant/products/collections",{method:"POST",body:JSON.stringify({collection_id:crypto.randomUUID(),command_id:productTraderCommandId(),...values})});
}
export function reviewProductTraderCollection(collectionId:string,version:number,decision:"confirmed"|"rejected",reason?:string){
  return request<Record<string,unknown>>(`/api/sales/inventory/trader-collections/${collectionId}/review`,{method:"POST",body:JSON.stringify({command_id:productTraderCommandId(),expected_version:version,decision,reason})});
}
export function requestProductTraderReturn(values:{unit_id:string;reason:string;condition:"sealed"|"open_box"|"damaged";evidence_path:string}){return request<Record<string,unknown>>("/api/merchant/products/returns",{method:"POST",body:JSON.stringify({return_id:crypto.randomUUID(),command_id:productTraderCommandId(),...values})});}
export function reportProductTraderLoss(values:{unit_id:string;loss_type:"missing"|"stolen"|"damaged";reason:string;evidence_path:string}){return request<Record<string,unknown>>("/api/merchant/products/losses",{method:"POST",body:JSON.stringify({loss_id:crypto.randomUUID(),command_id:productTraderCommandId(),...values})});}
export function reviewProductTraderReturn(id:string,version:number,decision:"received"|"rejected",review_note?:string){return request<Record<string,unknown>>(`/api/sales/inventory/trader-returns/${id}/review`,{method:"POST",body:JSON.stringify({command_id:productTraderCommandId(),expected_version:version,decision,review_note})});}
export function recoverProductTraderLoss(id:string,expectedVersion:number,condition:"sellable"|"damaged",note?:string){return request<Record<string,unknown>>(`/api/sales/inventory/trader-losses/${id}/recover`,{method:"POST",body:JSON.stringify({command_id:productTraderCommandId(),expected_version:expectedVersion,condition,note})});}
export function getProductTraderOversight(){return request<Record<string,unknown>>("/api/sales/inventory/trader-oversight");}
export type ProductTraderSettings={product_trader_distribution_enabled:boolean;require_trader_handover_acknowledgment:boolean;require_trader_signature:boolean;net_product_commission_at_settlement:boolean;max_trader_handover_units:number;trader_handover_expiry_hours:number};
export function getProductTraderSettings(){return request<ProductTraderSettings>("/api/sales/inventory/trader-settings");}
export function saveProductTraderSettings(values:ProductTraderSettings){return request<ProductTraderSettings>("/api/sales/inventory/trader-settings",{method:"PATCH",body:JSON.stringify(values)});}
