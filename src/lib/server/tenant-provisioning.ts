import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function provisionOrganizationDefaults(
  admin: AdminClient,
  orgId: string,
  actorUserId?: string | null
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  const createDefaults = await db.rpc("create_organization_defaults", {
    p_org_id: orgId,
    p_actor_user_id: actorUserId || null,
  });

  if (createDefaults.error && createDefaults.error.code !== "42883") {
    return { error: createDefaults.error as { message: string; code?: string } };
  }

  if (!createDefaults.error) {
    const usage = await db.rpc("refresh_organization_usage", { p_org_id: orgId });
    if (usage.error && usage.error.code !== "42883") {
      return { error: usage.error as { message: string; code?: string } };
    }
    return { error: null };
  }

  const [organizationResult, settingsResult, featuresResult, subscriptionResult, usageResult] = await Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    db.from("organization_settings").upsert({ org_id: orgId }, { onConflict: "org_id" }),
    db.from("organization_features").upsert({ org_id: orgId, plan_code: "pro" }, { onConflict: "org_id" }),
    db.from("organization_subscriptions").upsert(
      {
        org_id: orgId,
        plan_code: "pro",
        status: "trialing",
        period_start: new Date().toISOString(),
      },
      { onConflict: "org_id" }
    ),
    db.from("organization_usage").upsert(
      { org_id: orgId, last_calculated_at: new Date().toISOString() },
      { onConflict: "org_id" }
    ),
  ]);

  const fallbackError =
    organizationResult.error ||
    settingsResult.error ||
    featuresResult.error ||
    subscriptionResult.error ||
    usageResult.error;

  if (fallbackError) {
    return { error: fallbackError as { message: string; code?: string } };
  }

  const organization = organizationResult.data as Record<string, unknown> | null;
  const name = String(organization?.name || "");
  if (name) {
    const updateSettings = await db
      .from("organization_settings")
      .update({ brand_name: name, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .is("brand_name", null);

    if (updateSettings.error) {
      return { error: updateSettings.error as { message: string; code?: string } };
    }
  }

  await db.from("approval_workflows").upsert(
    [
      {
        org_id: orgId,
        entity_type: "leave_request",
        steps: [
          { role: "manager", order: 1 },
          { role: "hr_admin", order: 2 },
        ],
      },
      {
        org_id: orgId,
        entity_type: "advance_request",
        steps: [{ role: "hr_admin", order: 1 }],
      },
    ],
    { onConflict: "org_id,entity_type" }
  );

  return { error: null };
}
