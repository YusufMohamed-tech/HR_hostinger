import { createClient } from "@/lib/supabase/client";

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
  const supabase = createClient();
  
  const empRes = await supabase
    .from("employees")
    .select("base_salary, bonus, deductions")
    .eq("id", employeeId)
    .single();
  if (empRes.error) return { data: null, error: empRes.error };
  const employee = empRes.data as { base_salary?: number | null; bonus?: number | null; deductions?: number | null } | null;
  const baseSalary = employee?.base_salary || 0;
  const fixedBonus = employee?.bonus || 0;
  const fixedDeductions = employee?.deductions || 0;

  const startOfMonth = new Date(month);
  const endOfMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0);
  const monthStart = startOfMonth.toISOString().slice(0, 10);
  const monthEnd = endOfMonth.toISOString().slice(0, 10);

  const attRes = await supabase
    .from("attendance_records")
    .select("id, status, total_minutes, late_minutes")
    .eq("employee_id", employeeId)
    .gte("work_date", monthStart)
    .lte("work_date", monthEnd);
    
  const attendanceRows = (attRes.data || []) as Record<string, unknown>[];
  const attendanceDays = attendanceRows.filter((row) => String(row.status || "present") !== "absent").length;
  const lateMinutes = attendanceRows.reduce((sum, row) => sum + Number(row.late_minutes || 0), 0);
  
  const dailyRate = baseSalary / 30;
  const absenceDeduction = Math.max(0, baseSalary - Math.min(baseSalary, dailyRate * attendanceDays));
  const lateDeduction = lateMinutes > 0 ? Math.round((baseSalary / 30 / 8 / 60) * lateMinutes * 100) / 100 : 0;
  const totalAllowances = fixedBonus;
  const totalDeductions = fixedDeductions + absenceDeduction + lateDeduction;
  const netSalary = Math.max(0, baseSalary + totalAllowances - totalDeductions);

  // GOSI — Saudi rates, capped at SAR 45,000/month base salary
  const gosiBase = Math.min(baseSalary, 45000);
  const employeeGosi = Math.round(gosiBase * 0.0975 * 100) / 100;
  const employerGosi = Math.round(gosiBase * 0.1175 * 100) / 100;

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
    allowances_details: fixedBonus > 0 ? [{ label: "Fixed bonus", amount: fixedBonus }] : [],
    deductions_details: [
      fixedDeductions > 0 ? { label: "Fixed deductions", amount: fixedDeductions } : null,
      absenceDeduction > 0 ? { label: "Attendance absence deduction", amount: absenceDeduction } : null,
      lateDeduction > 0 ? { label: "Late arrival deduction", amount: lateDeduction } : null,
      employeeGosi > 0 ? { label: "Employee GOSI (9.75%)", amount: employeeGosi, type: "gosi" } : null,
    ].filter(Boolean),
    payroll_notes: `Attendance days: ${attendanceDays}; late minutes: ${lateMinutes}`,
    status: 'draft'
  };

  const result = await supabase
    .from("payslips")
    .upsert(values as never, { onConflict: "org_id,employee_id,month" })
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
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
