import { createClient } from "@/lib/supabase/client";

export async function getFinancialBalances(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("financial_balances")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createFinancialBalance(values: Record<string, unknown>, attachment?: File | null) {
  const form = new FormData();
  form.set("command_id", crypto.randomUUID());
  form.set("balance_id", crypto.randomUUID());
  for (const [key, value] of Object.entries(values)) {
    if (key === "org_id" || value === undefined || value === null || value === "") continue;
    form.set(key, String(value));
  }
  if (attachment) form.set("attachment", attachment);
  const response = await fetch("/api/financial-balances", { method: "POST", body: form });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as Record<string, unknown> | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to create financial balance.") } };
}

export async function acknowledgeFinancialBalance(id: string, typedName: string, expectedVersion: number) {
  const response = await fetch(`/api/financial-balances/${encodeURIComponent(id)}/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command_id: crypto.randomUUID(), expected_version: expectedVersion, typed_name: typedName }),
  });
  const payload = await response.json().catch(() => null);
  return response.ok
    ? { data: (payload?.data || null) as Record<string, unknown> | null, error: null }
    : { data: null, error: { message: String(payload?.message || "Unable to acknowledge financial balance.") } };
}

async function apiFetch<T>(path: string, options?: RequestInit) {
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { data: null, error: { message: String(payload?.message || "حدث خطأ غير متوقع.") } };
    return { data: (payload?.data ?? null) as T | null, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "تعذر الاتصال بالخادم." } };
  }
}

export async function getAdvanceRequests() {
  return apiFetch<Record<string, unknown>[]>("/api/advance-requests");
}

export async function createAdvanceRequest(values: {
  command_id: string;
  requested_amount: number;
  reason?: string;
  employee_signature_data: string;
  installment_count: number;
  first_deduction_month: string;
}) {
  return apiFetch<Record<string, unknown>>("/api/advance-requests", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function reviewAdvanceRequest(values: {
  id: string;
  command_id: string;
  expected_version: number;
  status: "approved" | "partial_approved" | "rejected";
  approved_amount?: number;
  hr_notes?: string;
}) {
  return apiFetch<Record<string, unknown>>("/api/advance-requests", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function disburseAdvanceRequest(values: {
  id: string;
  command_id: string;
  expected_version: number;
  payment_date?: string;
  account_id?: string | null;
  method?: string;
  reference_no?: string;
}) {
  const { id, ...body } = values;
  return apiFetch<Record<string, unknown>>(`/api/advance-requests/${id}/disburse`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
