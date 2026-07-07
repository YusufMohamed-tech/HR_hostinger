import type {
  AgentCashCollection,
  AgentCommission,
  AgentDashboardData,
  AgentSalesResponse,
  AgentSimRequest,
  FieldAgent,
  SimBoxImportConfirmPayload,
  SimBoxPreviewResult,
  SimImportBatch,
  SimTransfer,
  SimUnit,
  StockOverview,
} from "@/types/field-agents";

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

const BASE = "/api/sales/agents";

// Agents
export const getFieldAgents = (p?: QueryParams) => apiFetch<FieldAgent[]>(BASE + qs(p));
export const getFieldAgent = (id: string) => apiFetch<FieldAgent>(`${BASE}/${id}`);
export const createFieldAgent = (body: Record<string, unknown>) =>
  apiFetch<FieldAgent>(BASE, jsonInit("POST", body));
export const updateFieldAgent = (id: string, body: Record<string, unknown>) =>
  apiFetch<FieldAgent>(`${BASE}/${id}`, jsonInit("PATCH", body));
export const getAgentSales = (id: string, p?: QueryParams) =>
  apiFetch<AgentSalesResponse>(`${BASE}/${id}/sales` + qs(p));

// SIM inventory
export const getSimUnits = (p?: QueryParams) => apiFetch<SimUnit[]>(`${BASE}/sims` + qs(p));
export const importSims = (body: Record<string, unknown>) =>
  apiFetch<{ imported: number }>(`${BASE}/sims/import`, jsonInit("POST", body));
export const assignSims = (body: Record<string, unknown>) =>
  apiFetch<{ assigned: number }>(`${BASE}/sims/assign`, jsonInit("POST", body));
export const previewSimBoxImport = (body: FormData) =>
  apiFetch<SimBoxPreviewResult>(`${BASE}/sims/box-preview`, bodyInit("POST", body));
export const confirmSimBoxImport = (body: SimBoxImportConfirmPayload) =>
  apiFetch<{ batch: SimImportBatch; inserted_count: number; skipped_duplicates: string[]; assigned_agent_id: string | null }>(
    `${BASE}/sims/box-import`,
    jsonInit("POST", body)
  );
export const getSimImportBatches = (p?: QueryParams) =>
  apiFetch<SimImportBatch[]>(`${BASE}/sims/import-batches` + qs(p));
export const getSimImportBatch = (id: string) =>
  apiFetch<{ batch: SimImportBatch; sims: SimUnit[] }>(`${BASE}/sims/import-batches/${id}`);
export const recordSale = (body: Record<string, unknown>) =>
  apiFetch<SimUnit>(`${BASE}/sims/sell`, jsonInit("POST", body));
export const returnSim = (body: Record<string, unknown>) =>
  apiFetch<SimUnit>(`${BASE}/sims/return`, jsonInit("POST", body));

// Transfers
export const getSimTransfers = (p?: QueryParams) =>
  apiFetch<SimTransfer[]>(`${BASE}/transfers` + qs(p));

// Cash collections
export const getCashCollections = (agentId: string) =>
  apiFetch<AgentCashCollection[]>(`${BASE}/${agentId}/collections`);
export const collectCash = (body: Record<string, unknown>) =>
  apiFetch<AgentCashCollection>(`${BASE}/collect`, jsonInit("POST", body));

// SIM requests
export const getSimRequests = (p?: QueryParams) =>
  apiFetch<AgentSimRequest[]>(`${BASE}/requests` + qs(p));
export const createSimRequest = (body: Record<string, unknown>) =>
  apiFetch<AgentSimRequest>(`${BASE}/requests`, jsonInit("POST", body));
export const reviewSimRequest = (id: string, body: Record<string, unknown>) =>
  apiFetch<AgentSimRequest>(`${BASE}/requests/${id}/review`, jsonInit("PATCH", body));

// Commissions
export const getCommissions = (p?: QueryParams) =>
  apiFetch<AgentCommission[]>(`${BASE}/commissions` + qs(p));
export const markCommissionPaid = (id: string) =>
  apiFetch<AgentCommission>(`${BASE}/commissions/${id}/pay`, jsonInit("PATCH", {}));

// Dashboard / overview
export const getAgentDashboard = () => apiFetch<AgentDashboardData>(`${BASE}/me/dashboard`);
export const getStockOverview = () => apiFetch<StockOverview>(`${BASE}/stock/overview`);
