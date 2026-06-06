import { createClient } from "@/lib/supabase/client";
import { roleFromOrgRole } from "@/lib/rbac";
import type { Role } from "@/types";
import { calculateAnnualAccruedDays, getLeaveBalanceColumn, type LeaveTypeKey } from "@/lib/leave-balance-core";

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayString() {
  return new Date().toISOString().split("T")[0];
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

async function getLeaveRequesterRole(orgId: string, employeeId: string) {
  const supabase = createClient();
  const employeeResult = await supabase
    .from("employees")
    .select("user_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeResult.error) {
    return { data: null, error: employeeResult.error as { message: string } | null };
  }

  const employeeData = employeeResult.data as Record<string, unknown> | null;
  const userId = typeof employeeData?.user_id === "string"
    ? String(employeeData.user_id)
    : "";

  if (!userId) {
    return { data: null, error: null };
  }

  const membershipResult = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipResult.error) {
    return { data: null, error: membershipResult.error as { message: string } | null };
  }

  const membershipData = membershipResult.data as Record<string, unknown> | null;
  const rawRole = typeof membershipData?.role === "string"
    ? String(membershipData.role)
    : null;

  return { data: roleFromOrgRole(rawRole), error: null };
}

export async function createLeaveRequest(values: Record<string, unknown>) {
    const response = await fetch("/api/leave-requests/self", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

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

  const balanceUpdate = await deductApprovedLeaveBalance({
    orgId,
    employeeId,
    leaveType,
    days: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1),
    leaveRequestId: requestId,
    actorUserId: typeof values.decided_by === "string" ? values.decided_by : undefined,
    reason: "Approved leave request",
  });

  return {
    data: updateResult.data as Record<string, unknown> | null,
    error: balanceUpdate.error,
  };
}

export async function advanceLeaveApproval(
  request: Record<string, unknown>,
  decision: "approved" | "rejected",
  actor?: { userId?: string; employeeId?: string; role?: Role | null },
  note?: string
) {
  const requestId = typeof request.id === "string" ? request.id : "";
  const orgId = typeof request.org_id === "string" ? request.org_id : "";
  const employeeId = typeof request.employee_id === "string" ? request.employee_id : "";
  const currentStep = Number(request.current_step || 1);
  const history = Array.isArray(request.approval_history) ? request.approval_history : [];
  const now = new Date().toISOString();
  const actorUserId = actor?.userId;
  const actorEmployeeId = actor?.employeeId || "";
  const actorRole = actor?.role ?? null;
  const employee = request.employee as Record<string, unknown> | null | undefined;
  const managerId = getLeaveApprovalManagerId(employee);
  const totalSteps = Number(request.total_steps || 2);

  if (!requestId) {
    return { data: null, error: { message: "Leave request is missing an id." } };
  }

  const existingRequesterRole = typeof request.requester_role === "string" ? request.requester_role : null;
  const requesterRoleResult = existingRequesterRole
    ? { data: existingRequesterRole, error: null }
    : await getLeaveRequesterRole(orgId, employeeId);

  if (requesterRoleResult.error) {
    return { data: null, error: requesterRoleResult.error };
  }

  const isHrAdminRequest = requesterRoleResult.data === "HR_Admin";
  const isHrRecruitmentRequest = requesterRoleResult.data === "HR_Recruitment";
  const isSalesRequest = requesterRoleResult.data === "Sales";

  if ((isHrAdminRequest || isHrRecruitmentRequest) && actorRole !== "Superadmin") {
    return {
      data: null,
      error: { message: "طلبات إجازة HR أو Recruiter تعتمد من المشرف العام فقط." },
    };
  }

  const canApproveManagerStep = actorRole === "Admin"
    || actorRole === "Superadmin"
    || (isSalesRequest && actorRole === "Sales_Manager")
    || (!!actorEmployeeId && !!managerId && actorEmployeeId === managerId);
  const canApproveHrStep = actorRole === "Admin" || actorRole === "HR_Admin" || actorRole === "Superadmin";

  if (!isHrAdminRequest && !isHrRecruitmentRequest) {
    if (currentStep <= 1 && !canApproveManagerStep) {
      return {
        data: null,
        error: { message: "هذا الطلب ينتظر موافقة المدير المباشر أولًا." },
      };
    }

    if (currentStep >= 2 && !canApproveHrStep) {
      return {
        data: null,
        error: { message: "هذا الطلب ينتظر موافقة HR." },
      };
    }
  }

  const historyEntry = {
    step: currentStep,
    status: decision,
    at: now,
    by: actorUserId || null,
    note: note || null,
  };

  if (decision === "rejected") {
    return updateLeaveRequest(requestId, {
      status: "rejected",
      manager_approval_status: isHrAdminRequest
        ? "rejected"
        : currentStep === 1 ? "rejected" : request.manager_approval_status || "approved",
      hr_approval_status: isHrAdminRequest || currentStep >= 2
        ? "rejected"
        : request.hr_approval_status || "pending",
      decision_note: note || undefined,
      decided_at: now,
      decided_by: actorUserId || undefined,
      approval_history: [...history, historyEntry],
    });
  }

  if (isHrAdminRequest || isHrRecruitmentRequest) {
    return approveLeaveRequest(request, {
      status: "approved",
      manager_approval_status: "approved",
      hr_approval_status: "approved",
      current_step: 1,
      total_steps: 1,
      decision_note: note || undefined,
      decided_at: now,
      decided_by: actorUserId || undefined,
      approval_history: [...history, historyEntry],
    });
  }

  if (currentStep < totalSteps) {
    return updateLeaveRequest(requestId, {
      status: "pending",
      manager_approval_status: "approved",
      current_step: 2,
      approval_history: [...history, historyEntry],
    });
  }

  return approveLeaveRequest(request, {
    status: "approved",
    manager_approval_status: request.manager_approval_status === "approved" ? "approved" : "approved",
    hr_approval_status: "approved",
    current_step: 2,
    decision_note: note || undefined,
    decided_at: now,
    decided_by: actorUserId || undefined,
    approval_history: [...history, historyEntry],
  });
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

async function insertLeaveBalanceTransaction(values: Record<string, unknown>) {
  const supabase = createClient();
  const result = await supabase.from("leave_balance_transactions").insert(values as never);
  return { error: result.error ? { message: result.error.message } : null };
}

export async function ensureEmployeeLeaveBalance(values: {
  orgId: string;
  employeeId: string;
  hiringDate?: string | null;
  accrualStartDate?: string | null;
  manualAdjustment?: number | string | null;
  actorUserId?: string;
}) {
  const supabase = createClient();
  const accrualStartDate = values.accrualStartDate || values.hiringDate || todayString();
  const manualAdjustment = asNumber(values.manualAdjustment);
  const accrued = calculateAnnualAccruedDays(accrualStartDate);

  const existingResult = await supabase
    .from("leave_balances")
    .select("*")
    .eq("org_id", values.orgId)
    .eq("employee_id", values.employeeId)
    .maybeSingle();

  if (existingResult.error) {
    return { data: null, error: { message: existingResult.error.message } };
  }

  const existing = existingResult.data as Record<string, unknown> | null;
  if (existing) {
    return recalculateEmployeeVacationAccrual(existing, {
      orgId: values.orgId,
      employeeId: values.employeeId,
      accrualStartDate,
      actorUserId: values.actorUserId,
    });
  }

  const initialVacationBalance = Number((accrued + manualAdjustment).toFixed(2));
  const insertResult = await supabase
    .from("leave_balances")
    .insert({
      org_id: values.orgId,
      employee_id: values.employeeId,
      sick_remaining: 0,
      vacation_remaining: initialVacationBalance,
      emergency_remaining: 0,
      accrual_start_date: accrualStartDate,
      vacation_accrued_days: accrued,
      manual_adjustment: manualAdjustment,
      last_accrual_calculated_at: new Date().toISOString(),
    } as never)
    .select()
    .single();

  if (insertResult.error) {
    return { data: null, error: { message: insertResult.error.message } };
  }

  await insertLeaveBalanceTransaction({
    org_id: values.orgId,
    employee_id: values.employeeId,
    leave_balance_id: String((insertResult.data as Record<string, unknown>).id || ""),
    leave_type: "vacation",
    transaction_type: "initial",
    amount: initialVacationBalance,
    balance_before: 0,
    balance_after: initialVacationBalance,
    reason: "Initial annual leave balance",
    created_by: values.actorUserId || null,
  });

  return { data: insertResult.data as Record<string, unknown>, error: null };
}

export async function recalculateEmployeeVacationAccrual(
  balance: Record<string, unknown>,
  values?: { orgId?: string; employeeId?: string; accrualStartDate?: string | null; actorUserId?: string }
) {
  const supabase = createClient();
  const orgId = values?.orgId || String(balance.org_id || "");
  const employeeId = values?.employeeId || String(balance.employee_id || "");
  const balanceId = String(balance.id || "");
  const accrualStartDate = values?.accrualStartDate || String(balance.accrual_start_date || "") || todayString();
  const previousAccrued = asNumber(balance.vacation_accrued_days);
  const nextAccrued = calculateAnnualAccruedDays(accrualStartDate);
  const delta = Number((nextAccrued - previousAccrued).toFixed(2));
  const currentVacation = asNumber(balance.vacation_remaining);
  const nextVacation = Number((currentVacation + Math.max(0, delta)).toFixed(2));

  const updateValues: Record<string, unknown> = {
    accrual_start_date: accrualStartDate,
    vacation_accrued_days: nextAccrued,
    last_accrual_calculated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (delta > 0) updateValues.vacation_remaining = nextVacation;

  const updateResult = await supabase
    .from("leave_balances")
    .update(updateValues as never)
    .eq("id", balanceId)
    .select()
    .single();

  if (updateResult.error) {
    return { data: null, error: { message: updateResult.error.message } };
  }

  if (delta > 0) {
    await insertLeaveBalanceTransaction({
      org_id: orgId,
      employee_id: employeeId,
      leave_balance_id: balanceId,
      leave_type: "vacation",
      transaction_type: "accrual",
      amount: delta,
      balance_before: currentVacation,
      balance_after: nextVacation,
      reason: "Automatic monthly annual leave accrual",
      created_by: values?.actorUserId || null,
    });
  }

  return { data: updateResult.data as Record<string, unknown>, error: null };
}

export async function adjustLeaveBalance(values: {
  orgId: string;
  employeeId: string;
  leaveType: LeaveTypeKey;
  amount: number;
  reason: string;
  actorUserId?: string;
}) {
  const supabase = createClient();
  const column = getLeaveBalanceColumn(values.leaveType);
  if (!column) return { data: null, error: { message: "Unsupported leave type." } };

  const balanceResult = await supabase
    .from("leave_balances")
    .select("*")
    .eq("org_id", values.orgId)
    .eq("employee_id", values.employeeId)
    .maybeSingle();

  if (balanceResult.error) return { data: null, error: { message: balanceResult.error.message } };

  let balance = balanceResult.data as Record<string, unknown> | null;
  if (!balance) {
    const created = await ensureEmployeeLeaveBalance({ orgId: values.orgId, employeeId: values.employeeId, actorUserId: values.actorUserId });
    if (created.error || !created.data) return created;
    balance = created.data;
  }

  const before = asNumber(balance[column]);
  const after = Math.max(0, Number((before + values.amount).toFixed(2)));
  const updateValues: Record<string, unknown> = { [column]: after, updated_at: new Date().toISOString() };
  if (values.leaveType === "vacation") {
    updateValues.manual_adjustment = Number((asNumber(balance.manual_adjustment) + values.amount).toFixed(2));
  }

  const updateResult = await supabase
    .from("leave_balances")
    .update(updateValues as never)
    .eq("id", String(balance.id))
    .select()
    .single();

  if (updateResult.error) return { data: null, error: { message: updateResult.error.message } };

  const transaction = await insertLeaveBalanceTransaction({
    org_id: values.orgId,
    employee_id: values.employeeId,
    leave_balance_id: String(balance.id),
    leave_type: values.leaveType,
    transaction_type: "manual_adjustment",
    amount: values.amount,
    balance_before: before,
    balance_after: after,
    reason: values.reason,
    created_by: values.actorUserId || null,
  });

  return { data: updateResult.data as Record<string, unknown>, error: transaction.error };
}

export async function deductApprovedLeaveBalance(values: {
  orgId: string;
  employeeId: string;
  leaveType: string;
  days: number;
  leaveRequestId?: string;
  actorUserId?: string;
  reason?: string;
}) {
  const supabase = createClient();
  const column = getLeaveBalanceColumn(values.leaveType);
  if (!column) return { data: null, error: null };

  const balanceResult = await supabase
    .from("leave_balances")
    .select("*")
    .eq("org_id", values.orgId)
    .eq("employee_id", values.employeeId)
    .maybeSingle();

  if (balanceResult.error) return { data: null, error: { message: balanceResult.error.message } };

  let balance = balanceResult.data as Record<string, unknown> | null;
  if (!balance) {
    const created = await ensureEmployeeLeaveBalance({ orgId: values.orgId, employeeId: values.employeeId, actorUserId: values.actorUserId });
    if (created.error || !created.data) return created;
    balance = created.data;
  }

  const before = asNumber(balance[column]);
  const after = Math.max(0, Number((before - values.days).toFixed(2)));
  const updateResult = await supabase
    .from("leave_balances")
    .update({ [column]: after, updated_at: new Date().toISOString() } as never)
    .eq("id", String(balance.id))
    .select()
    .single();

  if (updateResult.error) return { data: null, error: { message: updateResult.error.message } };

  const transaction = await insertLeaveBalanceTransaction({
    org_id: values.orgId,
    employee_id: values.employeeId,
    leave_balance_id: String(balance.id),
    leave_request_id: values.leaveRequestId || null,
    leave_type: values.leaveType,
    transaction_type: "leave_deduction",
    amount: -Math.abs(values.days),
    balance_before: before,
    balance_after: after,
    reason: values.reason || "Approved leave request",
    created_by: values.actorUserId || null,
  });

  return { data: updateResult.data as Record<string, unknown>, error: transaction.error };
}
