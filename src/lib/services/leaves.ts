import { createClient } from "@/lib/supabase/client";
import { roleFromOrgRole } from "@/lib/rbac";
import type { LeaveTypeKey } from "@/lib/leave-balance-core";

function scopeHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function commandId(scope: string) {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = `hrms-command:${scope}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function clearCommandId(scope: string) {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(`hrms-command:${scope}`);
}

async function leaveCommandResult(response: Response, key: "balance" | "request", fallback: string) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { data: null, error: { message: String(body.message || fallback) } };
  return { data: (body[key] ?? null) as Record<string, unknown> | null, error: null };
}

export async function getLeaveRequests(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("leave_requests")
    .select("*, employee:employee_id(full_name,user_id,manager_id,department:department_id(manager_employee_id),location:location_id(manager_employee_id))")
    .eq("org_id", orgId)
    .order("requested_at", { ascending: false });

  if (result.error || !result.data) {
    return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  }

  const requests = result.data as Record<string, unknown>[];
  const userIds = Array.from(
    new Set(
      requests
        .map((request) => {
          const employee = request.employee as Record<string, unknown> | null | undefined;
          return typeof employee?.user_id === "string" ? employee.user_id : null;
        })
        .filter((value): value is string => Boolean(value))
    )
  );

  if (userIds.length === 0) {
    return { data: requests, error: null };
  }

  const membershipResult = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("user_id", userIds);

  if (membershipResult.error) {
    return {
      data: requests,
      error: membershipResult.error as { message: string } | null,
    };
  }

  const roleByUserId = new Map(
    ((membershipResult.data ?? []) as Record<string, unknown>[]).map((member) => {
      const rawRole = typeof member.role === "string" ? member.role : null;
      return [String(member.user_id ?? ""), roleFromOrgRole(rawRole)];
    })
  );

  return {
    data: requests.map((request) => {
      const employee = request.employee as Record<string, unknown> | null | undefined;
      const userId = typeof employee?.user_id === "string" ? employee.user_id : "";
      return {
        ...request,
        requester_role: roleByUserId.get(userId) ?? null,
      };
    }),
    error: null,
  };
}

export function getLeaveApprovalManagerId(employee: Record<string, unknown> | null | undefined) {
  if (!employee) return "";
  const directManagerId = typeof employee.manager_id === "string" ? employee.manager_id : "";
  if (directManagerId) return directManagerId;

  const department = employee.department as Record<string, unknown> | null | undefined;
  const departmentManagerId = typeof department?.manager_employee_id === "string" ? department.manager_employee_id : "";
  if (departmentManagerId) return departmentManagerId;

  const location = employee.location as Record<string, unknown> | null | undefined;
  const locationManagerId = typeof location?.manager_employee_id === "string" ? location.manager_employee_id : "";
  return locationManagerId;
}

export async function createLeaveRequest(values: Record<string, unknown>, attachment?: File | null) {
    const commandId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const requestOptions: RequestInit = {
      method: "POST",
    };

    if (attachment) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null) formData.append(key, String(value));
      }
      formData.append("command_id", commandId);
      formData.append("row_id", rowId);
      formData.append("attachment", attachment);
      requestOptions.body = formData;
    } else {
      requestOptions.headers = { "Content-Type": "application/json" };
      requestOptions.body = JSON.stringify({ ...values, command_id: commandId, row_id: rowId });
    }

    const response = await fetch("/api/leave-requests/self", requestOptions);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        data: null,
        error: { message: String(data?.message || "Unable to create leave request.") },
      };
    }

    return {
      data: (data?.request ?? data ?? null) as Record<string, unknown> | null,
      error: null,
    } as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function advanceLeaveApproval(
  request: Record<string, unknown>,
  decision: "approved" | "rejected",
  note?: string
) {
  const requestId = typeof request.id === "string" ? request.id : "";
  if (!requestId) {
    return { data: null, error: { message: "Leave request is missing an id." } };
  }
  const scope = `leave-review:${requestId}:${decision}:${scopeHash(note || "")}`;
  try {
    const response = await fetch(`/api/leave-requests/${requestId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: note || null, commandId: commandId(scope) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { data: null, error: { message: String(body.message || "Unable to review leave request.") } };
    }
    clearCommandId(scope);
    return { data: (body.request ?? null) as Record<string, unknown> | null, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Unable to connect to leave service." } };
  }
}

export async function getLeaveBalances(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("leave_balances")
    .select("*, employee:employee_id(full_name, employee_code, hiring_date)")
    .eq("org_id", orgId);

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getLeaveBalanceTransactions(orgId: string, employeeId?: string) {
  const supabase = createClient();
  let query = supabase
    .from("leave_balance_transactions")
    .select("*, employee:employee_id(full_name, employee_code)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (employeeId) query = query.eq("employee_id", employeeId);

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function ensureEmployeeLeaveBalance(values: {
  orgId: string;
  employeeId: string;
  hiringDate?: string | null;
  accrualStartDate?: string | null;
  manualAdjustment?: number | string | null;
  actorUserId?: string;
}) {
  if (!values.employeeId) return { data: null, error: { message: "Employee is required." } };
  const scope = `leave-balance-refresh:${values.employeeId}`;
  try {
    const response = await fetch("/api/leave-balances/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: values.employeeId, command_id: commandId(scope) }),
    });
    const result = await leaveCommandResult(response, "balance", "Unable to refresh leave balance.");
    if (!result.error) clearCommandId(scope);
    return result;
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Unable to connect to leave balance service." } };
  }
}

export async function recalculateEmployeeVacationAccrual(
  balance: Record<string, unknown>,
  values?: { orgId?: string; employeeId?: string; accrualStartDate?: string | null; actorUserId?: string }
) {
  const employeeId = values?.employeeId || String(balance.employee_id || "");
  return ensureEmployeeLeaveBalance({
    orgId: values?.orgId || String(balance.org_id || ""),
    employeeId,
    accrualStartDate: values?.accrualStartDate,
    actorUserId: values?.actorUserId,
  });
}

export async function adjustLeaveBalance(values: {
  orgId: string;
  employeeId: string;
  leaveType: LeaveTypeKey;
  amount: number;
  reason: string;
  actorUserId?: string;
}) {
  const scope = `leave-balance-adjust:${values.employeeId}:${values.leaveType}:${values.amount}:${scopeHash(values.reason.trim())}`;
  try {
    const response = await fetch("/api/leave-balances/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: values.employeeId,
        leave_type: values.leaveType,
        amount: values.amount,
        reason: values.reason,
        command_id: commandId(scope),
      }),
    });
    const result = await leaveCommandResult(response, "balance", "Unable to adjust leave balance.");
    if (!result.error) clearCommandId(scope);
    return result;
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Unable to connect to leave balance service." } };
  }
}

export async function cancelLeaveRequest(requestId: string, reason: string) {
  const scope = `leave-cancel:${requestId}:${scopeHash(reason.trim())}`;
  try {
    const response = await fetch(`/api/leave-requests/${requestId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, command_id: commandId(scope) }),
    });
    const result = await leaveCommandResult(response, "request", "Unable to cancel leave request.");
    if (!result.error) clearCommandId(scope);
    return result;
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "Unable to connect to leave service." } };
  }
}
