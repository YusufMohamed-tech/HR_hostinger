import { createClient } from "@/lib/supabase/client";

export async function getEvents(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("events" as never)
    .select("*, employee:employee_id(full_name)")
    .eq("org_id", orgId)
    .order("occurred_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getEventById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("events" as never)
    .select("*, employee:employee_id(full_name)")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
