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
};

export type DeductionRuleGroupInput = Omit<DeductionRuleGroup, "id" | "org_id" | "created_at" | "updated_at">;

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

export async function createDeductionRuleGroup(orgId: string, data: DeductionRuleGroupInput) {
  const supabase = createClient();
  return supabase
    .from("deduction_rule_groups")
    .insert({ ...data, org_id: orgId })
    .select()
    .single();
}

export async function updateDeductionRuleGroup(id: string, data: Partial<DeductionRuleGroupInput>) {
  const supabase = createClient();
  return supabase
    .from("deduction_rule_groups")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function deleteDeductionRuleGroup(id: string) {
  const supabase = createClient();

  // Block deletion if any employees are assigned to this group
  const { count } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("deduction_rule_group_id", id);

  if (count && count > 0) {
    return {
      data: null,
      error: {
        message: `Cannot delete: ${count} employee${count > 1 ? "s are" : " is"} assigned to this group.`,
        assignedCount: count,
      },
    };
  }

  return supabase.from("deduction_rule_groups").delete().eq("id", id);
}

export async function getGroupAssignedCount(id: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("deduction_rule_group_id", id);
  return count ?? 0;
}
