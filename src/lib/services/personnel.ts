import { createClient } from "@/lib/supabase/client";

export async function getPersonnelFiles(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("personnel_files")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createPersonnelFile(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("personnel_files")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function uploadPersonnelFile(orgId: string, employeeId: string, file: File) {
  const supabase = createClient();
  const extension = file.name.split(".").pop() || "bin";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const filePath = `${orgId}/${employeeId}/${fileName}`;

  const result = await supabase.storage
    .from("personnel-files")
    .upload(filePath, file, { upsert: false });

  return result as unknown as { data: { path: string } | null; error: { message: string } | null };
}

export async function getSocialInsurance(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("social_insurance")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function upsertSocialInsurance(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("social_insurance")
    .upsert(values as never, { onConflict: "org_id,employee_id" })
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getEmployeeContracts(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("employee_contracts")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("start_date", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createEmployeeContract(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_contracts")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
