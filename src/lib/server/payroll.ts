import "server-only";

import { createHash } from "node:crypto";
import {
  calculatePayroll,
  moneyToHalalas,
  prorateHalalas,
  roundDivideHalfUp,
  type PayrollFormulaInput,
  type PayrollManualAdjustment,
} from "@/lib/payroll/engine";
import type { Json } from "@/types/database";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type StoredManualAdjustment = {
  id: string;
  type: "bonus" | "deduction";
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
};

type PayrollCommandContext = {
  admin: AdminClient;
  orgId: string;
  actorUserId: string;
  requestId: string;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export class PayrollConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollConfigurationError";
  }
}

export function normalizePayrollMonth(value: string) {
  const month = value.trim();
  if (!MONTH_PATTERN.test(month)) throw new PayrollConfigurationError("Payroll month must be an ISO first-of-month date.");
  return month;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const calendarDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const end = `${year}-${String(monthNumber).padStart(2, "0")}-${String(calendarDays).padStart(2, "0")}`;
  return { start: month, end, calendarDays };
}

function dateOrdinal(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) throw new PayrollConfigurationError(`Invalid payroll date ${value}.`);
  return Math.floor(date.getTime() / 86_400_000);
}

function payableDaysFor(input: { monthStart: string; monthEnd: string; hiringDate: string; terminationDate?: string | null }) {
  const start = input.hiringDate > input.monthStart ? input.hiringDate : input.monthStart;
  const end = input.terminationDate && input.terminationDate < input.monthEnd ? input.terminationDate : input.monthEnd;
  return Math.max(0, dateOrdinal(end) - dateOrdinal(start) + 1);
}

function deterministicCommandUuid(namespace: string, value: string) {
  const hex = createHash("sha256").update(`${namespace}:${value}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] || "0", 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function manualAdjustmentsFromStored(value: unknown): PayrollManualAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const row = raw as Partial<StoredManualAdjustment>;
    if (!row.id || !row.type || !row.reason || !row.created_by || !row.created_at) {
      throw new PayrollConfigurationError(`Manual adjustment ${index + 1} is incomplete.`);
    }
    return {
      id: row.id,
      type: row.type,
      amountHalalas: moneyToHalalas(row.amount, `manual adjustment ${row.id}`),
      reason: row.reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  });
}

async function loadEmployeePayrollInput(
  context: PayrollCommandContext,
  employeeId: string,
  month: string,
  adjustmentOverride?: PayrollManualAdjustment[]
) {
  const { start: monthStart, end: monthEnd, calendarDays } = monthBounds(month);
  const [employeeResult, payslipResult, attendanceResult, leaveResult, advanceInstallmentResult] = await Promise.all([
    context.admin
      .from("employees")
      .select("id, org_id, full_name, employee_code, hiring_date, termination_date, lifecycle_status, base_salary, bonus, deductions, deduction_rule_group_id, gosi_registered")
      .eq("id", employeeId)
      .eq("org_id", context.orgId)
      .maybeSingle(),
    context.admin
      .from("payslips")
      .select("id, status, calculation_version, manual_adjustments")
      .eq("org_id", context.orgId)
      .eq("employee_id", employeeId)
      .eq("month", month)
      .maybeSingle(),
    context.admin
      .from("attendance_records")
      .select("status, work_date, late_minutes")
      .eq("org_id", context.orgId)
      .eq("employee_id", employeeId)
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd),
    context.admin
      .from("leave_requests")
      .select("start_date, end_date")
      .eq("org_id", context.orgId)
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart),
    context.admin
      .from("advance_installments")
      .select("id, advance_request_id, amount, status, payslip_id")
      .eq("organization_id", context.orgId)
      .eq("employee_id", employeeId)
      .eq("due_month", month)
      .in("status", ["scheduled", "allocated"]),
  ]);
  const firstError = [
    employeeResult.error,
    payslipResult.error,
    attendanceResult.error,
    leaveResult.error,
    advanceInstallmentResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(`Unable to load payroll inputs: ${firstError.message}`);

  const employee = employeeResult.data;
  if (!employee) throw new PayrollConfigurationError("Employee was not found in this organization.");
  if (!employee.hiring_date) throw new PayrollConfigurationError(`${employee.full_name} has no hiring date.`);
  if (employee.lifecycle_status === "archived") throw new PayrollConfigurationError(`${employee.full_name} is archived.`);
  const payableDays = payableDaysFor({
    monthStart,
    monthEnd,
    hiringDate: employee.hiring_date,
    terminationDate: employee.termination_date,
  });
  if (payableDays === 0) throw new PayrollConfigurationError(`${employee.full_name} is not eligible for ${month.slice(0, 7)}.`);

  const existing = payslipResult.data as unknown as Record<string, unknown> | null;
  if (existing && String(existing.status) !== "draft") {
    throw new PayrollConfigurationError(`${employee.full_name}'s payslip is ${String(existing.status)} and cannot be recalculated.`);
  }

  const installmentCandidates = (advanceInstallmentResult.data || []) as unknown as Array<Record<string, unknown>>;
  const advanceRequestIds = [...new Set(installmentCandidates.map((row) => String(row.advance_request_id)))];
  let eligibleInstallments: Array<Record<string, unknown>> = [];
  if (advanceRequestIds.length > 0) {
    const requestResult = await context.admin
      .from("advance_requests")
      .select("id, status")
      .eq("organization_id", context.orgId)
      .in("id", advanceRequestIds)
      .in("status", ["disbursed", "repaying"]);
    if (requestResult.error) throw new Error(`Unable to load advance requests: ${requestResult.error.message}`);
    const eligibleRequestIds = new Set(
      ((requestResult.data || []) as unknown as Array<Record<string, unknown>>).map((row) => String(row.id))
    );
    eligibleInstallments = installmentCandidates.filter((row) => eligibleRequestIds.has(String(row.advance_request_id)));
  }
  const existingPayslipId = existing?.id ? String(existing.id) : null;
  const conflictingAllocation = eligibleInstallments.find(
    (row) => row.status === "allocated" && String(row.payslip_id || "") !== existingPayslipId
  );
  if (conflictingAllocation) {
    throw new PayrollConfigurationError("An advance installment is already allocated to another payroll calculation.");
  }
  const advanceInstallmentIds = eligibleInstallments.map((row) => String(row.id)).sort();
  const advanceDeductionHalalas = eligibleInstallments.reduce(
    (sum, row) => sum + moneyToHalalas(row.amount as number | string, `advance installment ${String(row.id)}`),
    0
  );
  if (!Number.isSafeInteger(advanceDeductionHalalas)) {
    throw new PayrollConfigurationError("Advance deductions exceed the supported money range.");
  }

  const rule = {
    name: "Manual",
    lateGraceMinutes: 0,
    deductionPerLateHourHalalas: 0,
    allowedAbsentDays: 0,
    deductionPerAbsentDayHalalas: 0,
    deductionPerExcessApprovedDayHalalas: 0,
  };

  const approvedDates = new Set<string>();
  for (const leave of leaveResult.data || []) {
    const first = Math.max(dateOrdinal(leave.start_date), dateOrdinal(monthStart));
    const last = Math.min(dateOrdinal(leave.end_date), dateOrdinal(monthEnd));
    for (let day = first; day <= last; day += 1) {
      approvedDates.add(new Date(day * 86_400_000).toISOString().slice(0, 10));
    }
  }

  let attendanceDays = 0;
  let approvedAbsentDays = 0;
  let unapprovedAbsentDays = 0;
  let lateMinutes = 0;
  for (const attendance of attendanceResult.data || []) {
    if (String(attendance.status || "present") === "absent") {
      if (approvedDates.has(attendance.work_date)) approvedAbsentDays += 1;
      else unapprovedAbsentDays += 1;
    } else {
      attendanceDays += 1;
      lateMinutes += Number(attendance.late_minutes || 0);
    }
  }
  // Manual entries replace automatic rule-based deductions
  const manualEntriesResult = await context.admin
    .from("employee_manual_entries")
    .select("id, entry_type, amount, days")
    .eq("org_id", context.orgId)
    .eq("employee_id", employeeId)
    .eq("month", month)
    .eq("status", "pending");
  if (manualEntriesResult.error) throw new Error(`Unable to load manual entries: ${manualEntriesResult.error.message}`);
  const manualEntries = (manualEntriesResult.data || []) as Array<{ id: string; entry_type: string; amount: number | null; days: number | null }>;
  const manualDeductionHalalas = manualEntries
    .filter((e) => e.entry_type === "deduction")
    .reduce((sum, e) => sum + moneyToHalalas(e.amount, `manual deduction ${e.id}`), 0);
  const manualAbsenceDays = manualEntries
    .filter((e) => e.entry_type === "absence")
    .reduce((sum, e) => sum + (e.days || 0), 0);
  const dailySalaryHalalas = roundDivideHalfUp(moneyToHalalas(employee.base_salary, "base salary"), 30);
  const absenceDeductionHalalas = manualAbsenceDays * dailySalaryHalalas;
  const lateDeductionHalalas = 0;
  if (!Number.isSafeInteger(manualDeductionHalalas + absenceDeductionHalalas)) {
    throw new PayrollConfigurationError("Manual deductions exceed the supported money range.");
  }

  let insurance: PayrollFormulaInput["insurance"] = { registered: false };
  if (employee.gosi_registered) {
    const insuranceResult = await context.admin
      .from("social_insurance")
      .select("status, scheme_code, contributory_wage, maximum_contributory_wage, employee_rate_basis_points, employer_rate_basis_points, prorate_partial_month, effective_from, effective_to, configuration_status")
      .eq("org_id", context.orgId)
      .eq("employee_id", employeeId)
      .eq("status", "active")
      .maybeSingle();
    if (insuranceResult.error) throw new Error(`Unable to load social-insurance configuration: ${insuranceResult.error.message}`);
    const configured = insuranceResult.data as Record<string, unknown> | null;
    if (
      !configured
      || configured.configuration_status !== "verified"
      || !configured.scheme_code
      || configured.contributory_wage === null
      || configured.contributory_wage === undefined
      || !configured.maximum_contributory_wage
      || configured.employee_rate_basis_points === null
      || configured.employee_rate_basis_points === undefined
      || configured.employer_rate_basis_points === null
      || configured.employer_rate_basis_points === undefined
      || !configured.effective_from
      || String(configured.effective_from) > monthEnd
      || (configured.effective_to && String(configured.effective_to) < monthStart)
    ) {
      throw new PayrollConfigurationError(`${employee.full_name} requires an active, verified social-insurance configuration for this month.`);
    }
    let contributoryWageHalalas = moneyToHalalas(configured.contributory_wage as number | string, "contributory wage");
    if (configured.prorate_partial_month && payableDays < calendarDays) {
      contributoryWageHalalas = prorateHalalas(contributoryWageHalalas, payableDays, calendarDays);
    }
    insurance = {
      registered: true,
      verified: true,
      schemeCode: String(configured.scheme_code),
      contributoryWageHalalas,
      maximumContributoryWageHalalas: moneyToHalalas(
        configured.maximum_contributory_wage as number | string,
        "maximum contributory wage"
      ),
      employeeRateBasisPoints: Number(configured.employee_rate_basis_points),
      employerRateBasisPoints: Number(configured.employer_rate_basis_points),
    };
  }

  const manualAdjustments = adjustmentOverride
    ?? manualAdjustmentsFromStored(existing?.manual_adjustments);
  const formulaInput: PayrollFormulaInput = {
    month,
    calendarDays,
    payableDays,
    monthlyBaseSalaryHalalas: moneyToHalalas(employee.base_salary, "base salary"),
    allowances: Number(employee.bonus || 0) > 0 ? [{
      code: "fixed-allowance",
      label: "Fixed allowance",
      amountHalalas: moneyToHalalas(employee.bonus, "fixed allowance"),
      prorate: true,
    }] : [],
    recurringDeductions: Number(employee.deductions || 0) > 0 ? [{
      code: "fixed-deduction",
      label: "Fixed deduction",
      amountHalalas: moneyToHalalas(employee.deductions, "fixed deduction"),
      prorate: true,
    }] : [],
    lateDeductionHalalas,
    absenceDeductionHalalas,
    advanceDeductionHalalas,
    otherDeductionHalalas: manualDeductionHalalas,
    manualAdjustments,
    insurance,
  };
  const result = calculatePayroll(formulaInput);
  const snapshot = {
    ...formulaInput,
    advanceInstallmentIds,
    employee: {
      id: employee.id,
      code: employee.employee_code,
      name: employee.full_name,
      hiringDate: employee.hiring_date,
      terminationDate: employee.termination_date,
    },
    attendance: { attendanceDays, approvedAbsentDays, unapprovedAbsentDays, lateMinutes },
    deductionRule: rule,
    notes: `Attendance days: ${attendanceDays}; late minutes: ${lateMinutes}; unapproved absences: ${unapprovedAbsentDays}; approved absences: ${approvedAbsentDays}`,
  };

  return {
    expectedVersion: Number(existing?.calculation_version || 0),
    formulaInput,
    inputSnapshot: snapshot as unknown as Json,
    resultSnapshot: result as unknown as Json,
  };
}

export async function calculateAndSaveEmployeePayslip(
  context: PayrollCommandContext,
  values: {
    employeeId: string;
    month: string;
    commandId: string;
    commandAction?: "calculate_payslip" | "add_adjustment" | "remove_adjustment";
    manualAdjustments?: PayrollManualAdjustment[];
  }
) {
  const month = normalizePayrollMonth(values.month);
  const commandAction = values.commandAction || "calculate_payslip";
  const replayResult = await context.admin
    .from("payroll_commands")
    .select("action, status, payslip_id")
    .eq("org_id", context.orgId)
    .eq("idempotency_key", values.commandId)
    .maybeSingle();
  if (replayResult.error) throw new Error(`Unable to inspect payroll command: ${replayResult.error.message}`);
  const replay = replayResult.data as Record<string, unknown> | null;
  if (replay) {
    if (replay.action !== commandAction) throw Object.assign(new Error("Idempotency key was used for a different payroll command."), { code: "23505" });
    if (replay.status === "completed" && replay.payslip_id) {
      const completedResult = await context.admin
        .from("payslips")
        .select("*")
        .eq("id", String(replay.payslip_id))
        .eq("org_id", context.orgId)
        .maybeSingle();
      if (completedResult.error) throw new Error(`Unable to load completed payroll command: ${completedResult.error.message}`);
      if (completedResult.data) return completedResult.data;
    }
  }
  const calculation = await loadEmployeePayrollInput(
    context,
    values.employeeId,
    month,
    values.manualAdjustments
  );
  const { data, error } = await context.admin.rpc("save_payroll_calculation", {
    p_org_id: context.orgId,
    p_employee_id: values.employeeId,
    p_month: month,
    p_actor_user_id: context.actorUserId,
    p_command_id: values.commandId,
    p_request_id: context.requestId,
    p_expected_calculation_version: calculation.expectedVersion,
    p_command_action: commandAction,
    p_input_snapshot: calculation.inputSnapshot,
    p_result_snapshot: calculation.resultSnapshot,
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const payslip = data?.[0];
  if (!payslip) throw new Error("Payroll calculation command returned no payslip.");

  // Mark pending manual entries as applied
  await context.admin
    .from("employee_manual_entries")
    .update({ status: "applied", applied_to_payslip_id: (payslip as Record<string, unknown>).id as string, updated_at: new Date().toISOString() })
    .eq("org_id", context.orgId)
    .eq("employee_id", values.employeeId)
    .eq("month", month)
    .eq("status", "pending");

  return payslip;
}

export async function runPayrollMonth(
  context: PayrollCommandContext,
  values: { month: string; commandId: string }
) {
  const month = normalizePayrollMonth(values.month);
  const { end } = monthBounds(month);
  const employeeResult = await context.admin
    .from("employees")
    .select("id, full_name")
    .eq("org_id", context.orgId)
    .neq("lifecycle_status", "archived")
    .not("hiring_date", "is", null)
    .lte("hiring_date", end)
    .or(`termination_date.is.null,termination_date.gte.${month}`)
    .order("employee_code", { ascending: true });
  if (employeeResult.error) throw new Error(`Unable to load payroll employees: ${employeeResult.error.message}`);
  if (!employeeResult.data?.length) throw new PayrollConfigurationError("No payroll-eligible employees were found for this month.");

  const payslips = [];
  for (const employee of employeeResult.data) {
    const commandId = deterministicCommandUuid(values.commandId, employee.id);
    payslips.push(await calculateAndSaveEmployeePayslip(context, {
      employeeId: employee.id,
      month,
      commandId,
    }));
  }
  return payslips;
}

export async function replacePayslipManualAdjustments(
  context: PayrollCommandContext,
  values: {
    payslipId: string;
    month: string;
    employeeId: string;
    commandId: string;
    commandAction: "add_adjustment" | "remove_adjustment";
    manualAdjustments: PayrollManualAdjustment[];
  }
) {
  const payslipResult = await context.admin
    .from("payslips")
    .select("id")
    .eq("id", values.payslipId)
    .eq("org_id", context.orgId)
    .eq("employee_id", values.employeeId)
    .eq("month", normalizePayrollMonth(values.month))
    .maybeSingle();
  if (payslipResult.error) throw new Error(`Unable to verify payslip: ${payslipResult.error.message}`);
  if (!payslipResult.data) throw new PayrollConfigurationError("Payslip was not found in this organization.");
  return calculateAndSaveEmployeePayslip(context, {
    employeeId: values.employeeId,
    month: values.month,
    commandId: values.commandId,
    commandAction: values.commandAction,
    manualAdjustments: values.manualAdjustments,
  });
}

export async function loadStoredAdjustments(context: PayrollCommandContext, payslipId: string) {
  const { data, error } = await context.admin
    .from("payslips")
    .select("id, employee_id, month, status, manual_adjustments")
    .eq("id", payslipId)
    .eq("org_id", context.orgId)
    .maybeSingle();
  if (error) throw new Error(`Unable to load payslip: ${error.message}`);
  if (!data) throw new PayrollConfigurationError("Payslip was not found in this organization.");
  if (data.status !== "draft") throw new PayrollConfigurationError("Only a draft payslip can be adjusted.");
  return {
    payslipId: data.id,
    employeeId: data.employee_id,
    month: data.month,
    adjustments: manualAdjustmentsFromStored(data.manual_adjustments),
  };
}
