import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";

/* ─── READ ─── */

export async function getProfile(userId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("profiles" as never)
    .select("*")
    .eq("user_id", userId)
    .single();
  return result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
}

export async function getProfilesByOrg(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("profiles" as never)
    .select("*")
    .eq("org_id", orgId)
    .order("full_name");
  return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

/* ─── UPDATE ─── */

export async function updateProfile(
  userId: string,
  values: { full_name?: string; phone?: string; title?: string },
  orgId?: string
) {
  const supabase = createClient();
  const result = await supabase
    .from("profiles" as never)
    .update(values as never)
    .eq("user_id", userId)
    .select()
    .single();

  const { data, error } = result as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (!error && orgId) {
    await writeAuditLog(supabase, {
      org_id: orgId,
      actor_user_id: userId,
      action: "updated",
      entity: "profile",
      entity_id: userId,
      new_values: values,
    });
  }

  return { data, error };
}
