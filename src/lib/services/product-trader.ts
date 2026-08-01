import type { ProductTraderWorkspace } from "@/types/product-trader";

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
