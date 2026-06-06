import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateAnnualAccruedDays, getLeaveBalanceColumn } from "@/lib/leave-balance-core";

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayString() {
  return new Date().toISOString().split("T")[0];
}

async function insertTransaction(admin: SupabaseClient, values: Record<string, unknown>) {
  const { error } = await admin.from("leave_balance_transactions").insert(values as never);
  return error ? { message: error.message } : null;
}

export async function ensureEmployeeLeaveBalanceServer(
  admin: SupabaseClient,
  values: {
    orgId: string;
    employeeId: string;
    hiringDate?: string | null;
    accrualStartDate?: string | null;
    manualAdjustment?: number | string | null;
    actorUserId?: string;
  }
) {
  const accrualStartDate = values.accrualStartDate || values.hiringDate || todayString();
  const manualAdjustment = asNumber(values.manualAdjustment);
  const accrued = calculateAnnualAccruedDays(accrualStartDate);

  const existingResult = await admin
    .from("leave_balances")
    .select("*")
    .eq("org_id", values.orgId)
    .eq("employee_id", values.employeeId)
    .maybeSingle();

  if (existingResult.error) return { data: null, error: { message: existingResult.error.message } };

  const existing = existingResult.data as Record<string, unknown> | null;
  if (existing) {
    const previousAccrued = asNumber(existing.vacation_accrued_days);
    const delta = Number((accrued - previousAccrued).toFixed(2));
    const before = asNumber(existing.vacation_remaining);
    const after = Number((before + Math.max(0, delta)).toFixed(2));
    const updateValues: Record<string, unknown> = {
      accrual_start_date: existing.accrual_start_date || accrualStartDate,
      vacation_accrued_days: accrued,
      last_accrual_calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (delta > 0) updateValues.vacation_remaining = after;

    const updateResult = await admin
      .from("leave_balances")
      .update(updateValues as never)
      .eq("id", String(existing.id))
      .select()
      .single();

    if (updateResult.error) return { data: null, error: { message: updateResult.error.message } };

    if (delta > 0) {
      const transactionError = await insertTransaction(admin, {
        org_id: values.orgId,
        employee_id: values.employeeId,
        leave_balance_id: String(existing.id),
        leave_type: "vacation",
        transaction_type: "accrual",
        amount: delta,
        balance_before: before,
        balance_after: after,
        reason: "Automatic monthly annual leave accrual",
        created_by: values.actorUserId || null,
      });
      if (transactionError) return { data: updateResult.data, error: transactionError };
    }

    return { data: updateResult.data as Record<string, unknown>, error: null };
  }

  const initialVacationBalance = Number((accrued + manualAdjustment).toFixed(2));
  const insertResult = await admin
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

  if (insertResult.error) return { data: null, error: { message: insertResult.error.message } };

  const transactionError = await insertTransaction(admin, {
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

  return { data: insertResult.data as Record<string, unknown>, error: transactionError };
}

export async function deductApprovedLeaveBalanceServer(
  admin: SupabaseClient,
  values: {
    orgId: string;
    employeeId: string;
    leaveType: string;
    days: number;
    leaveRequestId?: string;
    actorUserId?: string;
    reason?: string;
  }
) {
  const column = getLeaveBalanceColumn(values.leaveType);
  if (!column) return { data: null, error: null };

  const ensured = await ensureEmployeeLeaveBalanceServer(admin, {
    orgId: values.orgId,
    employeeId: values.employeeId,
    actorUserId: values.actorUserId,
  });
  if (ensured.error || !ensured.data) return ensured;

  const balance = ensured.data;
  const before = asNumber(balance[column]);
  const after = Math.max(0, Number((before - values.days).toFixed(2)));
  const updateResult = await admin
    .from("leave_balances")
    .update({ [column]: after, updated_at: new Date().toISOString() } as never)
    .eq("id", String(balance.id))
    .select()
    .single();

  if (updateResult.error) return { data: null, error: { message: updateResult.error.message } };

  const transactionError = await insertTransaction(admin, {
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

  return { data: updateResult.data as Record<string, unknown>, error: transactionError };
}
