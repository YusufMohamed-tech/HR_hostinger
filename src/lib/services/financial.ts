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

export async function createFinancialBalance(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("financial_balances")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateFinancialBalance(orgId: string, id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("financial_balances")
    .update(values as never)
    .eq("org_id", orgId)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function uploadBalanceAttachment(orgId: string, balanceId: string, file: File) {
  const supabase = createClient();
  const extension = file.name.split(".").pop() || "bin";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const filePath = `${orgId}/${balanceId}/${fileName}`;

  const result = await supabase.storage
    .from("balance-attachments")
    .upload(filePath, file, { upsert: false });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}

export async function uploadBalanceSignature(orgId: string, balanceId: string, signatureData: string) {
  const supabase = createClient();
  const bytes = new TextEncoder().encode(signatureData);
  const filePath = `${orgId}/${balanceId}/signature-${Date.now()}.txt`;

  const result = await supabase.storage
    .from("balance-attachments")
    .upload(filePath, bytes, {
      contentType: "text/plain",
      upsert: false,
    });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}

export async function acknowledgeFinancialBalance(orgId: string, id: string, signaturePath: string) {
  const supabase = createClient();
  const result = await supabase
    .from("financial_balances")
    .update({
      acknowledgment_signature_url: signaturePath,
      status: "acknowledged",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("org_id", orgId)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
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

export async function createAdvanceRequest(values: { requested_amount: number; reason?: string; employee_signature_data: string }) {
  return apiFetch<Record<string, unknown>>("/api/advance-requests", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function reviewAdvanceRequest(values: { id: string; status: "approved" | "partial_approved" | "rejected"; approved_amount?: number; hr_notes?: string }) {
  return apiFetch<Record<string, unknown>>("/api/advance-requests", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}
