export type LeaveTypeKey = "sick" | "vacation" | "emergency";

export const MONTHLY_ANNUAL_LEAVE_ACCRUAL_DAYS = 1.75;

export const leaveBalanceColumns: Record<LeaveTypeKey, string> = {
  sick: "sick_remaining",
  vacation: "vacation_remaining",
  emergency: "emergency_remaining",
};

export function leaveDays(startDateValue: unknown, endDateValue: unknown) {
  const startDate = typeof startDateValue === "string" ? new Date(startDateValue) : null;
  const endDate = typeof endDateValue === "string" ? new Date(endDateValue) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 1;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
}

export function fullMonthsBetween(start: Date, end: Date) {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

export function calculateAnnualAccruedDays(startDateValue?: string | null, asOf = new Date()) {
  if (!startDateValue) return 0;
  const start = new Date(startDateValue);
  if (Number.isNaN(start.getTime())) return 0;
  return Number((fullMonthsBetween(start, asOf) * MONTHLY_ANNUAL_LEAVE_ACCRUAL_DAYS).toFixed(2));
}

export function getLeaveBalanceColumn(leaveType: unknown) {
  const key = String(leaveType || "") as LeaveTypeKey;
  return leaveBalanceColumns[key] ?? "";
}
