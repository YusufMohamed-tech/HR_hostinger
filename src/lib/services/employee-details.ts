import { createClient } from "@/lib/supabase/client";

export async function getEmployeeDocuments(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_documents")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeSalaryHistory(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("salary_history")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("effective_date", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeKpis(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_kpis")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("recorded_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeReviews(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_reviews")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEmployeeActions(orgId: string, employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_actions")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function uploadEmployeeDocument(orgId: string, employeeId: string, docType: string, file: File) {
  const supabase = createClient();
  const fileExt = file.name.split(".").pop() || "pdf";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
  const filePath = `${orgId}/${employeeId}/${docType}/${fileName}`;

  const uploadResult = await supabase
    .storage
    .from("employee-documents")
    .upload(filePath, file, { upsert: true });

  if (uploadResult.error) {
    return { data: null, error: uploadResult.error };
  }

  const { data: user } = await supabase.auth.getUser();

  const insertResult = await supabase
    .from("employee_documents")
    .insert({
      org_id: orgId,
      employee_id: employeeId,
      doc_type: docType,
      file_path: uploadResult.data.path,
      file_name: file.name,
      uploaded_by: user.user?.id
    } as never)
    .select()
    .single();

  return insertResult as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
