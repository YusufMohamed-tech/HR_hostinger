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
  
  // Fetch employee salary info
  const empRes = await supabase.from("employees").select("base_salary").eq("id", employeeId).single();
  if (empRes.error) return { data: null, error: empRes.error };
  const employee = empRes.data as { base_salary?: number | null } | null;
  const baseSalary = employee?.base_salary || 0;

  // Fetch attendance to calculate days
  // Here month should be something like "2026-05-01"
  const startOfMonth = new Date(month);
  const endOfMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0);

  const attRes = await supabase
    .from("attendance_records")
    .select("id")
    .eq("employee_id", employeeId)
    .gte("work_date", startOfMonth.toISOString())
    .lte("work_date", endOfMonth.toISOString());
    
  const attendanceDays = attRes.data ? attRes.data.length : 0;
  
  // Calculate basic deductions based on attendance if required
  // E.g. (baseSalary / 30) * attendanceDays
  const dailyRate = baseSalary / 30;
  const netSalary = Math.min(baseSalary, dailyRate * attendanceDays);

  const values = {
    org_id: orgId,
    employee_id: employeeId,
    month,
    base_salary: baseSalary,
    total_allowances: 0,
    total_deductions: baseSalary - netSalary,
    net_salary: netSalary,
    attendance_days: attendanceDays,
    status: 'draft'
  };

  const result = await supabase
    .from("payslips")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
