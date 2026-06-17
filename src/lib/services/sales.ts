export type SalesProduct = {
  id: string;
  organization_id: string;
  company_id: string | null;
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

export type SalesCompany = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  code: string | null;
  brand_color: string | null;
  is_active: boolean;
  assignment_role?: "sales" | "manager" | "admin" | null;
};

export type SalesCompanyAssignment = {
  id: string;
  company_id: string;
  user_id: string;
  assignment_role: "sales" | "manager";
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  company?: SalesCompany | null;
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

export type SalesLogEditRequest = {
  id: string;
  organization_id: string;
  sales_log_id: string;
  company_id: string | null;
  sales_agent_id: string;
  requested_changes: string;
  status: "pending" | "applied" | "rejected";
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at?: string;
};

export type SalesLog = {
  id: string;
  organization_id: string;
  company_id: string | null;
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
  company?: { name: string | null; code: string | null; brand_color: string | null } | null;
  edit_requests?: SalesLogEditRequest[];
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
  location_id?: string | null;
  location?: { id: string; name: string | null; city?: string | null; radius_meters?: number | null } | null;
  shift_id?: string | null;
  shift?: { id: string; name: string | null; start_time?: string | null; end_time?: string | null; location_id?: string | null } | null;
  company_assignments?: SalesCompanyAssignment[];
};

export type SalesChartPoint = {
  date?: string;
  month?: string;
  label: string;
  total: number;
};

export type SalesDashboardSettings = {
  id?: string;
  organization_id?: string;
  company_id?: string | null;
  channel_title: string;
  partner_label: string;
  monthly_target: number;
  working_days: number;
  focus_1_label: string;
  focus_1_query: string;
  focus_2_label: string;
  focus_2_query: string;
  focus_3_label: string;
  focus_3_query: string;
};

export type SalesDashboardReport = {
  date: string;
  dayName: string;
  company: { id: string; name: string; code: string; brandColor: string } | null;
  settings: SalesDashboardSettings;
  metrics: {
    partner: string;
    target: number;
    activations: number;
    actualPercent: number;
    remainingOver: number;
    dailyTarget: number;
    remainingDays: number;
    expectedPercent: number;
    salesGap: number;
    requiredDaily: number;
    expectedTarget: number;
  };
  focusGroups: Array<{ label: string; value: number; percent: number }>;
  calendarDays: Array<{ date: string; day: number; label: string; value: number; percent: number; isFuture: boolean }>;
  trend: SalesChartPoint[];
};

export type SalesDashboardAgent = SalesAgent & {
  today: number;
  week: number;
  month: number;
};

export type SalesDashboardData = {
  stats: {
    today: number;
    week: number;
    month: number;
    activeAgents: number;
  };
  companies?: SalesCompany[];
  selectedCompanyId?: string;
  canManageSettings?: boolean;
  dashboardSettings?: SalesDashboardSettings;
  report?: SalesDashboardReport;
  dailySales: SalesChartPoint[];
  monthlySales: SalesChartPoint[];
  leaderboard: SalesDashboardAgent[];
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

export async function getSalesCompanies() {
  return apiFetch<SalesCompany[]>("/api/sales/companies");
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

export async function getTodaySalesLog(companyId?: string) {
  const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
  return apiFetch<{
    companies: SalesCompany[];
    selectedCompanyId: string;
    products: SalesProduct[];
    todayLogs: SalesLog[];
    todayLog: SalesLog | null;
    yesterdayItems: SalesLogItem[];
    soldFrequency: Record<string, number>;
  }>(`/api/sales/log${suffix}`);
}

export async function submitSalesLog(values: { company_id: string; items: SalesLogItem[]; notes?: string }) {
  return apiFetch<SalesLog>("/api/sales/log", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function requestSalesLogEdit(values: { sales_log_id: string; requested_changes: string }) {
  return apiFetch<SalesLogEditRequest>("/api/sales/log/edit-requests", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function resolveSalesLogEditRequest(values: {
  id: string;
  status: "applied" | "rejected";
  items?: SalesLogItem[];
  notes?: string;
  resolution_note?: string;
}) {
  return apiFetch<SalesLogEditRequest>("/api/sales/log/edit-requests", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function getSalesHistory() {
  const result = await apiFetch<{ logs: SalesLog[] }>("/api/sales/reports?scope=mine");
  return {
    data: Array.isArray(result.data?.logs) ? result.data.logs : [],
    error: result.error,
  };
}

export async function getSalesReports(params?: URLSearchParams) {
  const suffix = params?.toString() ? `?${params.toString()}` : "";
  return apiFetch<{ logs: SalesLog[]; agents: SalesAgent[]; products: SalesProduct[]; companies: SalesCompany[]; summary: Record<string, unknown> }>(`/api/sales/reports${suffix}`);
}

export async function getSalesDashboard(companyId?: string) {
  const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
  return apiFetch<SalesDashboardData>(`/api/sales/dashboard${suffix}`);
}

export async function updateSalesDashboardSettings(values: Partial<SalesDashboardSettings> & { company_id?: string | null }) {
  return apiFetch<SalesDashboardSettings>("/api/sales/dashboard", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function getSalesTeam() {
  return apiFetch<SalesAgent[]>("/api/sales/team");
}

export async function createSalesAgent(values: {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  national_id?: string;
  role?: "sales" | "sales_manager";
  location_id?: string | null;
  shift_id?: string | null;
  company_assignments?: Array<{ company_id: string; assignment_role: "sales" | "manager"; start_date?: string; end_date?: string | null }>;
}) {
  return apiFetch<SalesAgent>("/api/sales/team", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function updateSalesAgent(values: {
  user_id: string;
  full_name?: string;
  phone?: string;
  national_id?: string;
  status?: string;
  role?: "sales" | "sales_manager";
  location_id?: string | null;
  shift_id?: string | null;
  company_assignments?: Array<{ company_id: string; assignment_role: "sales" | "manager"; start_date?: string; end_date?: string | null }>;
}) {
  return apiFetch<SalesAgent>("/api/sales/team", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}
