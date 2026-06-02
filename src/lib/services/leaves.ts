import { createClient } from "@/lib/supabase/client";
import { roleFromOrgRole } from "@/lib/rbac";
import type { Role } from "@/types";

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

  if ((isHrAdminRequest || isHrRecruitmentRequest) && actorRole !== "Superadmin") {
    return {
      data: null,
      error: { message: "طلبات إجازة HR أو Recruiter تعتمد من المشرف العام فقط." },
    };
  }

  const canApproveManagerStep = actorRole === "Admin"
    || actorRole === "Superadmin"
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
    .select("*")
    .eq("org_id", orgId);

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}
