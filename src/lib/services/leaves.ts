import { createClient } from "@/lib/supabase/client";

export async function getLeaveRequests(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("leave_requests")
    .select("*, employee:employee_id(full_name)")
    .eq("org_id", orgId)
    .order("requested_at", { ascending: false });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function createLeaveRequest(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("leave_requests")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function updateLeaveRequest(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase
    .from("leave_requests")
    .update(values as never)
    .eq("id", id)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getLeaveBalances(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("leave_balances")
    .select("*")
    .eq("org_id", orgId);

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}
