import { createClient } from "@/lib/supabase/client";

export type DeductionRuleGroup = {
  id: string;
  org_id: string;
  name: string;
  late_grace_minutes: number;
  deduction_per_late_hour: number;
  allowed_absent_days: number;
  deduction_per_absent_day: number;
  deduction_per_excess_approved_day: number;
  created_at: string;
  updated_at: string;
  version: number;
};

export async function getDeductionRuleGroups(orgId: string) {
  const supabase = createClient();
  return supabase
    .from("deduction_rule_groups")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
}

export async function getDeductionRuleGroup(id: string) {
  const supabase = createClient();
  return supabase
    .from("deduction_rule_groups")
    .select("*")
    .eq("id", id)
    .single();
}

export async function getGroupAssignedCount(id: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("deduction_rule_group_id", id);
  return count ?? 0;
}
