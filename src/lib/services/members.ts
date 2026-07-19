import { createClient } from "@/lib/supabase/client";

export async function getOrgMembers(orgId: string) {
  const supabase = createClient();
  const result = await supabase
    .from("org_members")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (result.error || !result.data) {
    return result as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  }

  const userIds = result.data.map((member) => String((member as Record<string, unknown>).user_id || "")).filter(Boolean);
  const profilesResult = userIds.length
    ? await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds as never)
    : { data: [], error: null };

  if (profilesResult.error) {
    return { data: result.data as unknown as Record<string, unknown>[], error: null };
  }

  const profilesByUserId = new Map(
    (profilesResult.data || []).map((profile) => [
      String((profile as Record<string, unknown>).user_id || ""),
      profile as Record<string, unknown>,
    ])
  );

  return {
    data: (result.data as unknown as Record<string, unknown>[]).map((member) => ({
      ...member,
      profiles: profilesByUserId.get(String(member.user_id || "")) || null,
    })),
    error: null,
  };
}
