import { createClient } from "@/lib/supabase/client";

export type ManualAdjustment = {
  id: string;
  type: "bonus" | "deduction";
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
};

export async function getPayslips(orgId: string, month?: string) {
  const supabase = createClient();
  let query = supabase
    .from("payslips")
    .select("*, employee:employee_id(full_name, employee_code, base_salary)")
    .eq("org_id", orgId)
    .order("month", { ascending: false });

  if (month) {
    query = query.eq("month", month);
  }

  const result = await query;
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function generatePayslip(orgId: string, employeeId: string, month: string) {
  return _computeAndSave(orgId, employeeId, month, false);
}

export async function recalculatePayslip(orgId: string, employeeId: string, month: string) {
  return _computeAndSave(orgId, employeeId, month, true);
}

async function _computeAndSave(
  orgId: string,
  employeeId: string,
  month: string,
  preserveAdjustments: boolean
) {
  const supabase = createClient();

  // Block recalculation on paid payslips
  const { data: existing } = await supabase
    .from("payslips")
    .select("status, manual_adjustments")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("month", month)
    .maybeSingle();

  if ((existing as Record<string, unknown> | null)?.status === "paid") {
    return { data: null, error: { message: "Cannot recalculate a paid payslip." } };
  }

  // 1. Fetch employee data
  const empRes = await supabase
    .from("employees")
    .select("base_salary, bonus, deductions, deduction_rule_group_id")
    .eq("id", employeeId)
    .single();
  if (empRes.error) return { data: null, error: empRes.error };

  const emp = empRes.data as {
    base_salary?: number | null;
    bonus?: number | null;
    deductions?: number | null;
    deduction_rule_group_id?: string | null;
  };

  const baseSalary = emp?.base_salary || 0;
  const fixedBonus = emp?.bonus || 0;
  const fixedDeductions = emp?.deductions || 0;

  // 2. Snapshot deduction rule group
  let groupName: string | null = null;
  let lateGraceMinutes = 0;
  let deductionPerLateHour = 0;
  let allowedAbsentDays = 0;
  let deductionPerAbsentDay = 0;
  let deductionPerExcessApprovedDay = 0;

  if (emp?.deduction_rule_group_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupRes = await (supabase as any)
      .from("deduction_rule_groups")
      .select("name, late_grace_minutes, deduction_per_late_hour, allowed_absent_days, deduction_per_absent_day, deduction_per_excess_approved_day")
      .eq("id", emp.deduction_rule_group_id)
      .single();

    if (!groupRes.error && groupRes.data) {
      const g = groupRes.data as {
        name: string;
        late_grace_minutes: number;
        deduction_per_late_hour: number;
        allowed_absent_days: number;
        deduction_per_absent_day: number;
        deduction_per_excess_approved_day: number;
      };
      groupName = g.name;
      lateGraceMinutes = g.late_grace_minutes;
      deductionPerLateHour = g.deduction_per_late_hour;
      allowedAbsentDays = g.allowed_absent_days;
      deductionPerAbsentDay = g.deduction_per_absent_day;
      deductionPerExcessApprovedDay = g.deduction_per_excess_approved_day;
    }
  }

  // 3. Date range
  const startOfMonth = new Date(month);
  const endOfMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0);
  const monthStart = startOfMonth.toISOString().slice(0, 10);
  const monthEnd = endOfMonth.toISOString().slice(0, 10);

  // 4. Fetch attendance records
  const attRes = await supabase
    .from("attendance_records")
    .select("status, work_date, late_minutes")
    .eq("employee_id", employeeId)
    .gte("work_date", monthStart)
    .lte("work_date", monthEnd);

  const attendanceRows = (attRes.data || []) as Array<{ status?: string; work_date?: string; late_minutes?: number }>;

  // 5. Build approved-absence date set from approved leave requests
  const leaveRes = await supabase
    .from("leave_requests")
    .select("start_date, end_date")
    .eq("employee_id", employeeId)
    .eq("status", "approved")
    .lte("start_date", monthEnd)
    .gte("end_date", monthStart);

  const approvedDates = new Set<string>();
  for (const lr of (leaveRes.data || []) as Array<{ start_date: string; end_date: string }>) {
    const cursor = new Date(lr.start_date);
    const end = new Date(lr.end_date);
    while (cursor <= end) {
      approvedDates.add(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // 6. Classify absences and accumulate late minutes
  let approvedAbsentDays = 0;
  let unapprovedAbsentDays = 0;
  let totalLateMinutes = 0;
  let attendanceDays = 0;

  for (const row of attendanceRows) {
    const status = String(row.status || "present");
    if (status === "absent") {
      if (approvedDates.has(String(row.work_date || ""))) {
        approvedAbsentDays++;
      } else {
        unapprovedAbsentDays++;
      }
    } else {
      attendanceDays++;
      totalLateMinutes += Number(row.late_minutes || 0);
    }
  }

  // 7. Late deduction (after grace period)
  const effectiveLateMinutes = Math.max(0, totalLateMinutes - lateGraceMinutes);
  const lateDeduction = Math.round((effectiveLateMinutes / 60) * deductionPerLateHour * 100) / 100;

  // 8. Absence deduction:
  //    - Unapproved: always deducted at deductionPerAbsentDay
  //    - Approved within N: free
  //    - Approved beyond N: deducted at deductionPerExcessApprovedDay
  const unapprovedDeduction = unapprovedAbsentDays * deductionPerAbsentDay;
  const excessApproved = Math.max(0, approvedAbsentDays - allowedAbsentDays);
  const absenceDeduction = Math.round((unapprovedDeduction + excessApproved * deductionPerExcessApprovedDay) * 100) / 100;

  // 9. GOSI — Saudi rates, capped at SAR 45,000/month
  const gosiBase = Math.min(baseSalary, 45000);
  const employeeGosi = Math.round(gosiBase * 0.0975 * 100) / 100;
  const employerGosi = Math.round(gosiBase * 0.1175 * 100) / 100;

  // 10. Preserve manual adjustments on recalculate
  const savedAdjustments: ManualAdjustment[] =
    preserveAdjustments && Array.isArray((existing as unknown as Record<string, unknown> | null)?.manual_adjustments)
      ? ((existing as unknown as Record<string, unknown>).manual_adjustments as ManualAdjustment[])
      : [];

  const manualAdjustmentsTotal = _sumAdjustments(savedAdjustments);

  // 11. Net salary
  const totalAllowances = fixedBonus;
  const totalDeductions = fixedDeductions + absenceDeduction + lateDeduction;
  const netSalary = Math.max(0, baseSalary + totalAllowances - totalDeductions + manualAdjustmentsTotal);

  const values = {
    org_id: orgId,
    employee_id: employeeId,
    month,
    base_salary: baseSalary,
    total_allowances: totalAllowances,
    total_deductions: totalDeductions,
    net_salary: netSalary,
    employee_gosi: employeeGosi,
    employer_gosi: employerGosi,
    attendance_days: attendanceDays,

    snapshot_group_name: groupName,
    snapshot_late_grace_minutes: lateGraceMinutes,
    snapshot_deduction_per_late_hour: deductionPerLateHour,
    snapshot_allowed_absent_days: allowedAbsentDays,
    snapshot_deduction_per_absent_day: deductionPerAbsentDay,
    snapshot_deduction_per_excess_approved_day: deductionPerExcessApprovedDay,

    approved_absent_days: approvedAbsentDays,
    unapproved_absent_days: unapprovedAbsentDays,
    late_minutes: totalLateMinutes,
    late_deduction: lateDeduction,
    absence_deduction: absenceDeduction,

    manual_adjustments: savedAdjustments,
    manual_adjustments_total: manualAdjustmentsTotal,

    allowances_details: fixedBonus > 0 ? [{ label: "البدلات الثابتة", amount: fixedBonus }] : [],
    deductions_details: [
      fixedDeductions > 0 ? { label: "الخصومات الثابتة", amount: fixedDeductions } : null,
      absenceDeduction > 0 ? { label: "خصم الغياب", amount: absenceDeduction } : null,
      lateDeduction > 0 ? { label: "خصم التأخر", amount: lateDeduction } : null,
      employeeGosi > 0 ? { label: "حصة الموظف من التأمينات (9.75%)", amount: employeeGosi, type: "gosi" } : null,
    ].filter(Boolean),

    payroll_notes: `أيام الحضور: ${attendanceDays}؛ دقائق التأخر: ${totalLateMinutes}؛ غياب غير مبرر: ${unapprovedAbsentDays}؛ غياب معتمد: ${approvedAbsentDays}`,
    status: "draft",
  };

  const result = await supabase
    .from("payslips")
    .upsert(values as never, { onConflict: "org_id,employee_id,month" })
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function addManualAdjustment(
  payslipId: string,
  adjustment: { type: "bonus" | "deduction"; amount: number; reason: string; createdBy: string }
) {
  const supabase = createClient();

  const { data: payslip, error } = await supabase
    .from("payslips")
    .select("status, manual_adjustments, base_salary, total_allowances, total_deductions")
    .eq("id", payslipId)
    .single();

  if (error) return { data: null, error };
  const p = payslip as Record<string, unknown>;
  if (p.status === "paid") return { data: null, error: { message: "Cannot modify a paid payslip." } };

  const existing: ManualAdjustment[] = Array.isArray(p.manual_adjustments)
    ? (p.manual_adjustments as ManualAdjustment[])
    : [];

  const newEntry: ManualAdjustment = {
    id: crypto.randomUUID(),
    type: adjustment.type,
    amount: adjustment.amount,
    reason: adjustment.reason,
    created_by: adjustment.createdBy,
    created_at: new Date().toISOString(),
  };

  const updated = [...existing, newEntry];
  const newTotal = _sumAdjustments(updated);
  const newNet = Math.max(0, Number(p.base_salary || 0) + Number(p.total_allowances || 0) - Number(p.total_deductions || 0) + newTotal);

  return supabase
    .from("payslips")
    .update({ manual_adjustments: updated, manual_adjustments_total: newTotal, net_salary: newNet } as never)
    .eq("id", payslipId)
    .select()
    .single();
}

export async function removeManualAdjustment(payslipId: string, adjustmentId: string) {
  const supabase = createClient();

  const { data: payslip, error } = await supabase
    .from("payslips")
    .select("status, manual_adjustments, base_salary, total_allowances, total_deductions")
    .eq("id", payslipId)
    .single();

  if (error) return { data: null, error };
  const p = payslip as Record<string, unknown>;
  if (p.status === "paid") return { data: null, error: { message: "Cannot modify a paid payslip." } };

  const existing: ManualAdjustment[] = Array.isArray(p.manual_adjustments)
    ? (p.manual_adjustments as ManualAdjustment[])
    : [];

  const updated = existing.filter((a) => a.id !== adjustmentId);
  const newTotal = _sumAdjustments(updated);
  const newNet = Math.max(0, Number(p.base_salary || 0) + Number(p.total_allowances || 0) - Number(p.total_deductions || 0) + newTotal);

  return supabase
    .from("payslips")
    .update({ manual_adjustments: updated, manual_adjustments_total: newTotal, net_salary: newNet } as never)
    .eq("id", payslipId)
    .select()
    .single();
}

export async function updatePayslipStatus(payslipId: string, status: "draft" | "approved" | "paid") {
  const supabase = createClient();
  const result = await supabase
    .from("payslips")
    .update({ status } as never)
    .eq("id", payslipId)
    .select()
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

function _sumAdjustments(adjustments: ManualAdjustment[]): number {
  return Math.round(
    adjustments.reduce((sum, a) => sum + (a.type === "bonus" ? a.amount : -a.amount), 0) * 100
  ) / 100;
}
