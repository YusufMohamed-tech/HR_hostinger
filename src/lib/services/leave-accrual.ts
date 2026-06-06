import { createClient } from "@/lib/supabase/client";

const MONTHLY_ANNUAL_LEAVE_ACCRUAL_DAYS = 1.75;

function fullMonthsBetween(start: Date, end: Date) {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

export function calculateLeaveBalanceDays(values: {
  leave_accrual_start_date?: string | null;
  hiring_date?: string | null;
  leave_balance_manual_adjustment?: number | string | null;
  asOf?: Date;
}) {
  const startValue = values.leave_accrual_start_date || values.hiring_date;
  if (!startValue) return Number(values.leave_balance_manual_adjustment || 0);

  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return Number(values.leave_balance_manual_adjustment || 0);

  const months = fullMonthsBetween(start, values.asOf ?? new Date());
  const manualAdjustment = Number(values.leave_balance_manual_adjustment || 0);
  return Number((months * MONTHLY_ANNUAL_LEAVE_ACCRUAL_DAYS + manualAdjustment).toFixed(2));
}

export async function recalculateEmployeeLeaveBalance(employee: Record<string, unknown>) {
  const employeeId = String(employee.id || "");
  if (!employeeId) return { data: null, error: { message: "معرف الموظف مطلوب." } };

  const leaveBalanceDays = calculateLeaveBalanceDays({
    leave_accrual_start_date: typeof employee.leave_accrual_start_date === "string" ? employee.leave_accrual_start_date : null,
    hiring_date: typeof employee.hiring_date === "string" ? employee.hiring_date : null,
    leave_balance_manual_adjustment: typeof employee.leave_balance_manual_adjustment === "number" || typeof employee.leave_balance_manual_adjustment === "string"
      ? employee.leave_balance_manual_adjustment
      : 0,
  });

  const supabase = createClient();
  const result = await supabase
    .from("employees")
    .update({ leave_balance_days: leaveBalanceDays } as never)
    .eq("id", employeeId)
    .select()
    .single();

  if (result.error) return { data: leaveBalanceDays, error: result.error as { message: string } };
  return { data: leaveBalanceDays, error: null };
}
