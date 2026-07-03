import type {
  PromoterCampaign,
  PromoterDashboardData,
  PromoterLead,
  PromoterReferenceKind,
  PromoterReferenceValue,
  PromoterSettings,
  TelecomOffer,
} from "@/types/promoter";

type ApiResult<T> = { data: T | null; error: { message: string } | null };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { data: null, error: { message: String(payload.message || payload.error || "Promoter request failed.") } };
    }

    return { data: (payload.data ?? null) as T | null, error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "Promoter request failed." },
    };
  }
}

function jsonInit(method: string, body?: Record<string, unknown>): RequestInit {
  return { method, body: body ? JSON.stringify(body) : undefined };
}

function qs(params?: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function getPromoterOffers(params?: { companyId?: string; activeOnly?: boolean }) {
  return apiFetch<TelecomOffer[]>("/api/sales/promoter/offers" + qs({
    company_id: params?.companyId,
    active_only: params?.activeOnly,
  }));
}

export function createPromoterOffer(values: Record<string, unknown>) {
  return apiFetch<TelecomOffer>("/api/sales/promoter/offers", jsonInit("POST", values));
}

export function updatePromoterOffer(offerId: string, values: Record<string, unknown>) {
  return apiFetch<TelecomOffer>(`/api/sales/promoter/offers/${offerId}`, jsonInit("PATCH", values));
}

export function deletePromoterOffer(offerId: string) {
  return apiFetch<TelecomOffer>(`/api/sales/promoter/offers/${offerId}`, jsonInit("DELETE"));
}

export function getPromoterReferenceValues(kind?: PromoterReferenceKind) {
  return apiFetch<PromoterReferenceValue[]>("/api/sales/promoter/reference" + qs({ kind }));
}

export function createPromoterReferenceValue(values: Record<string, unknown>) {
  return apiFetch<PromoterReferenceValue>("/api/sales/promoter/reference", jsonInit("POST", values));
}

export function updatePromoterReferenceValue(values: Record<string, unknown>) {
  return apiFetch<PromoterReferenceValue>("/api/sales/promoter/reference", jsonInit("PATCH", values));
}

export function getPromoterSettings(companyId?: string) {
  return apiFetch<PromoterSettings>("/api/sales/promoter/settings" + qs({ company_id: companyId }));
}

export function updatePromoterSettings(values: Record<string, unknown>) {
  return apiFetch<PromoterSettings>("/api/sales/promoter/settings", jsonInit("PATCH", values));
}

export function getPromoterLeads(params?: Record<string, string | number | boolean | null | undefined>) {
  return apiFetch<PromoterLead[]>("/api/sales/promoter/leads" + qs(params));
}

export function getPromoterLead(leadId: string) {
  return apiFetch<PromoterLead>(`/api/sales/promoter/leads/${leadId}`);
}

export function createPromoterLead(values: Record<string, unknown>) {
  return apiFetch<PromoterLead>("/api/sales/promoter/leads", jsonInit("POST", values));
}

export function updatePromoterLeadStatus(leadId: string, values: Record<string, unknown>) {
  return apiFetch<PromoterLead>(`/api/sales/promoter/leads/${leadId}`, jsonInit("PATCH", values));
}

export function assignPromoterLead(leadId: string, assignedAgentId: string) {
  return updatePromoterLeadStatus(leadId, { assigned_agent_id: assignedAgentId, status: "sent_to_agent" });
}

export function getPromoterCampaigns(params?: { activeOnly?: boolean; companyId?: string }) {
  return apiFetch<PromoterCampaign[]>("/api/sales/promoter/campaigns" + qs({
    active_only: params?.activeOnly,
    company_id: params?.companyId,
  }));
}

export function createPromoterCampaign(values: Record<string, unknown>) {
  return apiFetch<PromoterCampaign>("/api/sales/promoter/campaigns", jsonInit("POST", values));
}

export function updatePromoterCampaign(values: Record<string, unknown>) {
  return apiFetch<PromoterCampaign>("/api/sales/promoter/campaigns", jsonInit("PATCH", values));
}

export function getPromoterDashboard(params?: Record<string, string | number | boolean | null | undefined>) {
  return apiFetch<PromoterDashboardData>("/api/sales/promoter/dashboard" + qs(params));
}
