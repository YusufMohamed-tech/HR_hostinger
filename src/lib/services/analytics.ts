import { createClient } from "@/lib/supabase/client";

export async function getKpiDefinitions(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_definitions" as never)
    .select("*, kpi_targets(*), kpi_results(*)")
    .eq("org_id", orgId)
    .order("name");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

export async function getKpiById(id: string) {
  const supabase = createClient();
  const result = await supabase
    .from("kpi_definitions" as never)
    .select("*, kpi_targets(*), kpi_results(*, employee:employee_id(full_name))")
    .eq("id", id)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}
