import { calculateAnnualAccruedDays } from "@/lib/leave-balance-core";
import { ensureEmployeeLeaveBalance } from "@/lib/services/leaves";

export function calculateLeaveBalanceDays(values: {
  leave_accrual_start_date?: string | null;
  hiring_date?: string | null;
  leave_balance_manual_adjustment?: number | string | null;
  asOf?: Date;
}) {
  const startValue = values.leave_accrual_start_date || values.hiring_date;
  const manualAdjustment = Number(values.leave_balance_manual_adjustment || 0);
  return Number((calculateAnnualAccruedDays(startValue, values.asOf ?? new Date()) + manualAdjustment).toFixed(2));
}

export async function recalculateEmployeeLeaveBalance(employee: Record<string, unknown>) {
  const employeeId = String(employee.id || "");
  const orgId = String(employee.org_id || "");
  if (!employeeId || !orgId) return { data: null, error: { message: "Employee and organization are required." } };

  const result = await ensureEmployeeLeaveBalance({
    orgId,
    employeeId,
    hiringDate: typeof employee.hiring_date === "string" ? employee.hiring_date : null,
    accrualStartDate: typeof employee.leave_accrual_start_date === "string" ? employee.leave_accrual_start_date : null,
    manualAdjustment: typeof employee.leave_balance_manual_adjustment === "number" || typeof employee.leave_balance_manual_adjustment === "string"
      ? employee.leave_balance_manual_adjustment
      : 0,
  });

  if (result.error) return { data: null, error: result.error };
  return { data: Number(result.data?.vacation_remaining || 0), error: null };
}
