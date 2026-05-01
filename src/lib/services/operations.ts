import { createClient } from "@/lib/supabase/client";

export async function getAuditLogs(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("audit_logs" as never)
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getAuditLogById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("audit_logs" as never)
    .select("*")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getAiInsights(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("ai_insights" as never)
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getTrackingSessions(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("tracking_sessions" as never)
    .select("*, employee:employee_id(full_name), location:location_id(name)")
    .eq("org_id", orgId)
    .order("started_at", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getShifts(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("shifts" as never)
    .select("*, location:location_id(name), shift_assignments(*, employee:employee_id(full_name))")
    .eq("org_id", orgId)
    .order("shift_date", { ascending: false });
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getHierarchy(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("org_hierarchy" as never)
    .select("*, manager:manager_id(full_name, role), report:report_id(full_name, role)")
    .eq("org_id", orgId);
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}
