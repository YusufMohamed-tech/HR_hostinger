import type {
  Merchant,
  MerchantCashCollection,
  MerchantCommission,
  MerchantDashboardData,
  MerchantSimRequest,
  ResellerRanking,
  TraderSaleRecord,
} from "@/types/merchants";
import type { SimPackage, SimUnit } from "@/types/field-agents";

type ApiResult<T> = { data: T | null; error: { message: string } | null };
type QueryParams = Record<string, string | number | boolean | null | undefined>;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const isFormData = init?.body instanceof FormData;
    const res = await fetch(path, {
      ...init,
      headers: isFormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: { message: json.message ?? "خطأ في الطلب" } };
    return { data: json.data, error: null };
  } catch {
    return { data: null, error: { message: "خطأ في الاتصال" } };
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function bodyInit(method: string, body: Record<string, unknown> | FormData): RequestInit {
  return body instanceof FormData ? { method, body } : jsonInit(method, body);
}

function qs(p?: QueryParams) {
  if (!p) return "";
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== "") s.set(k, String(v));
  }
  const t = s.toString();
  return t ? `?${t}` : "";
}

const BASE = "/api/sales/merchants";

// Merchants
export const getMerchants = (p?: QueryParams) => apiFetch<Merchant[]>(BASE + qs(p));
export const getMerchant = (id: string) => apiFetch<Merchant>(`${BASE}/${id}`);
export const createMerchant = (body: Record<string, unknown> | FormData) =>
  apiFetch<Merchant>(BASE, bodyInit("POST", body));
export const updateMerchant = (id: string, body: Record<string, unknown>) =>
  apiFetch<Merchant>(`${BASE}/${id}`, jsonInit("PATCH", body));

// Packages
export const getSimPackages = (p?: QueryParams) =>
  apiFetch<SimPackage[]>(`${BASE}/packages` + qs(p));
export const createSimPackage = (body: Record<string, unknown>) =>
  apiFetch<SimPackage>(`${BASE}/packages`, jsonInit("POST", body));
export const updateSimPackage = (id: string, body: Record<string, unknown>) =>
  apiFetch<SimPackage>(`${BASE}/packages/${id}`, jsonInit("PATCH", body));

// SIM movement
export const getMerchantSims = (p?: QueryParams) =>
  apiFetch<SimUnit[]>(`${BASE}/sims` + qs(p));
export const assignSimsToMerchant = (body: Record<string, unknown>) =>
  apiFetch<{ assigned: number }>(`${BASE}/sims/assign`, jsonInit("POST", body));
export const previewSimsForMerchant = (body: Record<string, unknown>) =>
  apiFetch<{ sims: SimUnit[] }>(`${BASE}/sims/preview`, jsonInit("POST", body));
export const merchantRecordSale = (body: Record<string, unknown>) =>
  apiFetch<SimUnit>(`${BASE}/sims/sell`, jsonInit("POST", body));
export const merchantReturnSim = (body: Record<string, unknown>) =>
  apiFetch<SimUnit>(`${BASE}/sims/return`, jsonInit("POST", body));

// Trader sales
export const getTraderSales = (p?: QueryParams) =>
  apiFetch<TraderSaleRecord[]>(`${BASE}/sales` + qs(p));

// Cash collections
export const getMerchantCollections = (merchantId: string) =>
  apiFetch<MerchantCashCollection[]>(`${BASE}/${merchantId}/collections`);
export const collectMerchantCash = (body: Record<string, unknown> | FormData) =>
  apiFetch<MerchantCashCollection>(`${BASE}/collect`, bodyInit("POST", body));
export const confirmMerchantPayment = (id: string, body: Record<string, unknown>) =>
  apiFetch<MerchantCashCollection>(`${BASE}/payments/${id}/confirm`, jsonInit("PATCH", body));

// Re-orders
export const getMerchantRequests = (p?: QueryParams) =>
  apiFetch<MerchantSimRequest[]>(`${BASE}/requests` + qs(p));
export const createMerchantRequest = (body: Record<string, unknown>) =>
  apiFetch<MerchantSimRequest>(`${BASE}/requests`, jsonInit("POST", body));
export const reviewMerchantRequest = (id: string, body: Record<string, unknown>) =>
  apiFetch<MerchantSimRequest>(`${BASE}/requests/${id}/review`, jsonInit("PATCH", body));

// Commissions
export const getMerchantCommissions = (p?: QueryParams) =>
  apiFetch<MerchantCommission[]>(`${BASE}/commissions` + qs(p));
export const markMerchantCommissionPaid = (id: string) =>
  apiFetch<MerchantCommission>(`${BASE}/commissions/${id}/pay`, jsonInit("PATCH", {}));

// Dashboard / analytics
export const getMerchantDashboard = () =>
  apiFetch<MerchantDashboardData>(`${BASE}/me/dashboard`);
export const getResellerRanking = () =>
  apiFetch<ResellerRanking[]>(`${BASE}/analytics/resellers`);
