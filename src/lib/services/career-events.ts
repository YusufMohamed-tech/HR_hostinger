import { createClient } from "@/lib/supabase/client";

export type CareerEventInput = {
  employee_id: string;
  event_type: string;
  previous_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  effective_date: string;
  notes?: string;
  created_by?: string;
};

export async function createCareerEvent(values: CareerEventInput) {
  const supabase = createClient();
  const result = await supabase
    .from("employee_career_events")
    .insert(values as never)
    .select()
    .single();

  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function createCareerEvents(events: CareerEventInput[]) {
  if (events.length === 0) return { error: null };
  const supabase = createClient();
  const result = await supabase
    .from("employee_career_events")
    .insert(events as never);

  return { error: result.error ? { message: result.error.message } : null };
}

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
