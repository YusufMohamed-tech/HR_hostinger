import { createClient } from "@/lib/supabase/client";

export async function getEmployeeCareerEvents(employeeId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_career_events")
    .select("*, creator:created_by(full_name, email)")
    .eq("employee_id", employeeId)
    .order("effective_date", { ascending: true })
    .order("created_at", { ascending: true });

  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}
