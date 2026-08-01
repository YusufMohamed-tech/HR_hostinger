import type { ProductTraderPriceOverride, ProductTraderSale, ProductTraderWorkspace } from "@/types/product-trader";

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
  return request<{ sales: ProductTraderSale[]; price_overrides: ProductTraderPriceOverride[] }>("/api/sales/inventory/trader-prices");
}

export function reviewProductTraderPriceOverride(overrideId: string, values: { expected_version: number; decision: "approved" | "rejected"; review_note?: string }) {
  return request<Record<string, unknown>>(`/api/sales/inventory/trader-prices/${overrideId}/review`, {
    method: "POST", body: JSON.stringify({ command_id: productTraderCommandId(), ...values }),
  });
}
