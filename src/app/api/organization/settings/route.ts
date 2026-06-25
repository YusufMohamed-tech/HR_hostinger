import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { writeAuditLog } from "@/lib/utils/audit";

function nullableText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function loadOrganizationSettings(auth: Awaited<ReturnType<typeof requireTenantContext>>) {
  if ("error" in auth) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.admin as any;
  const [organizationResult, settingsResult, featuresResult, subscriptionResult, usageResult] = await Promise.all([
    auth.admin.from("organizations").select("*").eq("id", auth.orgId).maybeSingle(),
    db.from("organization_settings").select("*").eq("org_id", auth.orgId).maybeSingle(),
    db.from("organization_features").select("*").eq("org_id", auth.orgId).maybeSingle(),
    db.from("organization_subscriptions").select("*").eq("org_id", auth.orgId).maybeSingle(),
    db.from("organization_usage").select("*").eq("org_id", auth.orgId).maybeSingle(),
  ]);

  const error =
    organizationResult.error ||
    (settingsResult.error?.code === "42P01" ? null : settingsResult.error) ||
    (featuresResult.error?.code === "42P01" ? null : featuresResult.error) ||
    (subscriptionResult.error?.code === "42P01" ? null : subscriptionResult.error) ||
    (usageResult.error?.code === "42P01" ? null : usageResult.error);

  if (error) {
    throw new Error(error.message);
  }

  return {
    organization: organizationResult.data || null,
    settings: settingsResult.data || null,
    features: featuresResult.data || null,
    subscription: subscriptionResult.data || null,
    usage: usageResult.data || null,
  };
}

export async function GET() {
  const auth = await requireTenantContext();
  if ("error" in auth) return auth.error;

  try {
    const data = await loadOrganizationSettings(auth);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to load organization settings." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"] });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = optionalText((body as Record<string, unknown>).name);
  const settings = ((body as Record<string, unknown>).settings || {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.admin as any;
  const updates: Record<string, unknown> = {};
  const settingsUpdates: Record<string, unknown> = {
    org_id: auth.orgId,
    updated_at: now,
  };

  if (name) updates.name = name;

  const brandName = nullableText(settings.brand_name);
  const tagline = nullableText(settings.tagline);
  const primaryColor = optionalText(settings.primary_color);
  const locale = optionalText(settings.locale);
  const timezone = optionalText(settings.timezone);

  if (brandName !== undefined) settingsUpdates.brand_name = brandName;
  if (tagline !== undefined) settingsUpdates.tagline = tagline;
  if (primaryColor !== undefined) settingsUpdates.primary_color = primaryColor;
  if (locale !== undefined) settingsUpdates.locale = locale;
  if (timezone !== undefined) settingsUpdates.timezone = timezone;

  if (Object.keys(updates).length === 0 && Object.keys(settingsUpdates).length <= 2) {
    return NextResponse.json({ message: "No supported updates were provided." }, { status: 400 });
  }

  if (updates.name && String(updates.name).length < 2) {
    return NextResponse.json({ message: "Organization name is too short." }, { status: 400 });
  }

  if (primaryColor && !/^#[0-9a-f]{6}$/i.test(primaryColor)) {
    return NextResponse.json({ message: "Primary color must be a hex color like #0f766e." }, { status: 400 });
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = now;
    const organizationUpdate = await auth.admin
      .from("organizations")
      .update(updates as never)
      .eq("id", auth.orgId)
      .is("deleted_at", null);

    if (organizationUpdate.error) {
      return NextResponse.json({ message: organizationUpdate.error.message }, { status: 500 });
    }
  }

  if (Object.keys(settingsUpdates).length > 2) {
    const settingsUpdate = await db
      .from("organization_settings")
      .upsert(settingsUpdates, { onConflict: "org_id" });

    if (settingsUpdate.error) {
      return NextResponse.json({ message: settingsUpdate.error.message }, { status: 500 });
    }
  }

  await writeAuditLog(auth.admin, {
    org_id: auth.orgId,
    actor_user_id: auth.user.id,
    action: "organization.settings_updated",
    entity: "organizations",
    entity_id: auth.orgId,
    new_values: { organization: updates, settings: settingsUpdates },
  });

  try {
    const data = await loadOrganizationSettings(auth);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to load organization settings." },
      { status: 500 }
    );
  }
}
