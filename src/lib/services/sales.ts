export type SalesProduct = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  unit: string | null;
  category: string | null;
  price: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
};

export type SalesLogItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  line_total: number;
};

export type SalesLog = {
  id: string;
  organization_id: string;
  sales_agent_id: string;
  log_date: string;
  items: SalesLogItem[];
  subtotal: number;
  total_discount: number;
  grand_total: number;
  notes: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  agent?: { full_name: string | null; email: string | null } | null;
};

export type SalesAgent = {
  user_id: string;
  org_id: string;
  role: string;
  full_name: string;
  email: string;
  phone: string | null;
  national_id?: string | null;
  status: string;
  employee_id?: string | null;
};

async function apiFetch<T>(path: string, options?: RequestInit): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const json = await res.json().catch(() => ({})) as { data?: T; message?: string; error?: string };
    if (!res.ok) return { data: null, error: json.message || json.error || "حدث خطأ غير متوقع." };
    return { data: json.data ?? null, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." };
  }
}

export async function getSalesProducts(includeInactive = false) {
  return apiFetch<SalesProduct[]>(`/api/sales/products${includeInactive ? "?include_inactive=1" : ""}`);
}

export async function createSalesProduct(values: Partial<SalesProduct>) {
  return apiFetch<SalesProduct>("/api/sales/products", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function updateSalesProduct(id: string, values: Partial<SalesProduct>) {
  return apiFetch<SalesProduct>("/api/sales/products", {
    method: "PATCH",
    body: JSON.stringify({ id, ...values }),
  });
}

export async function deleteSalesProduct(id: string) {
  return apiFetch<{ id: string }>("/api/sales/products", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}

export async function getTodaySalesLog() {
  return apiFetch<{ products: SalesProduct[]; todayLog: SalesLog | null; yesterdayItems: SalesLogItem[]; soldFrequency: Record<string, number> }>("/api/sales/log");
}

export async function submitSalesLog(values: { items: SalesLogItem[]; notes?: string }) {
  return apiFetch<SalesLog>("/api/sales/log", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function getSalesHistory() {
  return apiFetch<SalesLog[]>("/api/sales/reports?scope=mine");
}

export async function getSalesReports(params?: URLSearchParams) {
  const suffix = params?.toString() ? `?${params.toString()}` : "";
  return apiFetch<{ logs: SalesLog[]; agents: SalesAgent[]; products: SalesProduct[]; summary: Record<string, unknown> }>(`/api/sales/reports${suffix}`);
}

export async function getSalesTeam() {
  return apiFetch<SalesAgent[]>("/api/sales/team");
}

export async function createSalesAgent(values: { full_name: string; email: string; password: string; phone?: string; national_id?: string }) {
  return apiFetch<SalesAgent>("/api/sales/team", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function updateSalesAgent(values: { user_id: string; full_name?: string; phone?: string; national_id?: string; status?: string }) {
  return apiFetch<SalesAgent>("/api/sales/team", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}
