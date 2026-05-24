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

export async function updateFinancialBalance(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("financial_balances")
    .update(values as never)
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

export async function uploadBalanceSignature(balanceId: string, signatureData: string) {
  const supabase = createClient();
  const bytes = new TextEncoder().encode(signatureData);
  const filePath = `${balanceId}/signature-${Date.now()}.txt`;

  const result = await supabase.storage
    .from("balance-attachments")
    .upload(filePath, bytes, {
      contentType: "text/plain",
      upsert: false,
    });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}

export async function acknowledgeFinancialBalance(id: string, signaturePath: string) {
  const supabase = createClient();
  const result = await supabase
    .from("financial_balances")
    .update({
      acknowledgment_signature_url: signaturePath,
      status: "acknowledged",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
