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
