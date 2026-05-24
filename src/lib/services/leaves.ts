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

export async function approveLeaveRequest(
  request: Record<string, unknown>,
  values: Record<string, unknown>
) {
  const supabase = createClient();
  const requestId = typeof request.id === "string" ? request.id : "";
  const orgId = typeof request.org_id === "string" ? request.org_id : "";
  const employeeId = typeof request.employee_id === "string" ? request.employee_id : "";
  const leaveType = typeof request.leave_type === "string" ? request.leave_type : "";
  const startDate = typeof request.start_date === "string" ? new Date(request.start_date) : null;
  const endDate = typeof request.end_date === "string" ? new Date(request.end_date) : null;
  const currentStatus = typeof request.status === "string" ? request.status : "pending";

  if (!requestId || !orgId || !employeeId || !leaveType || !startDate || !endDate) {
    return { data: null, error: { message: "Leave request is missing required fields." } };
  }

  const updateResult = await supabase
    .from("leave_requests")
    .update(values as never)
    .eq("id", requestId)
    .select()
    .single();

  if (updateResult.error || currentStatus === "approved") {
    return updateResult as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
  }

  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
  const balanceColumn = `${leaveType}_remaining`;

  if (!["sick_remaining", "vacation_remaining", "emergency_remaining"].includes(balanceColumn)) {
    return updateResult as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
  }

  const balanceResult = await supabase
    .from("leave_balances")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (balanceResult.error) {
    return { data: updateResult.data as Record<string, unknown> | null, error: balanceResult.error };
  }

  const balance = balanceResult.data as Record<string, unknown> | null;
  const currentBalance = typeof balance?.[balanceColumn] === "number"
    ? balance[balanceColumn]
    : 0;
  const nextBalance = Math.max(0, currentBalance - days);

  const { error: balanceUpdateError } = balance
    ? await supabase
      .from("leave_balances")
      .update({ [balanceColumn]: nextBalance, updated_at: new Date().toISOString() } as never)
      .eq("id", String(balance.id))
    : await supabase
      .from("leave_balances")
      .insert({
        org_id: orgId,
        employee_id: employeeId,
        [balanceColumn]: nextBalance,
      } as never);

  return {
    data: updateResult.data as Record<string, unknown> | null,
    error: balanceUpdateError as { message: string } | null,
  };
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
