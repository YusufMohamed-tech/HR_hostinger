import { createClient } from "@/lib/supabase/client";

export async function getEmployeeAssets(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("assigned_date", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getAssets(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createAssetAssignment(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateAssetAssignment(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_assets")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function uploadAssetSignature(assetId: string, signatureData: string) {
  const supabase = createClient();
  const bytes = new TextEncoder().encode(signatureData);
  const filePath = `${assetId}/signature-${Date.now()}.txt`;

  const result = await supabase.storage
    .from("balance-attachments")
    .upload(filePath, bytes, {
      contentType: "text/plain",
      upsert: false,
    });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}

export async function acknowledgeAssetAssignment(id: string, signaturePath: string) {
  return updateAssetAssignment(id, {
    acknowledgment_signature_url: signaturePath,
    acknowledged_at: new Date().toISOString(),
  });
}
