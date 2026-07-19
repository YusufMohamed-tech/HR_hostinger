import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function provisionOrganizationDefaults(
  admin: AdminClient,
  orgId: string,
  actorUserId?: string | null
) {
  const createDefaults = await admin.rpc("create_organization_defaults", {
    p_org_id: orgId,
    p_actor_user_id: actorUserId || null,
  });

  if (createDefaults.error) {
    return { error: createDefaults.error };
  }

  const usage = await admin.rpc("refresh_organization_usage", { p_org_id: orgId });
  return { error: usage.error };
}
