import { createClient } from "@/lib/supabase/client";

export async function getPayrollCycles(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_cycles" as never)
    .select("*")
    .eq("org_id", orgId)
    .order("period_start", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getPayrollCycleById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_cycles" as never)
    .select("*, payroll_items(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getPayrollItems(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("payroll_items" as never)
    .select("*, employee:employee_id(full_name), payroll_cycle:payroll_cycle_id(name)")
    .eq("org_id", orgId);
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}
