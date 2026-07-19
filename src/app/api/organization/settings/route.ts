import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

type OrganizationRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

function validUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002" || code === "23503") return 404;
  if (code === "23505" || code === "40001") return 409;
  if (["22023", "23514", "23502"].includes(code || "")) return 400;
  return 500;
}

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
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"] }, request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = optionalText((body as Record<string, unknown>).name);
  const settings = ((body as Record<string, unknown>).settings || {}) as Record<string, unknown>;
  const commandId = (body as Record<string, unknown>).command_id;

  if (!validUuid(commandId)) {
    return NextResponse.json({ message: "A valid command id is required." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};
  const settingsUpdates: Record<string, unknown> = {};

  if (name) payload.name = name;

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

  if (Object.keys(payload).length === 0 && Object.keys(settingsUpdates).length === 0) {
    return NextResponse.json({ message: "No supported updates were provided." }, { status: 400 });
  }

  if (payload.name && String(payload.name).length < 2) {
    return NextResponse.json({ message: "Organization name is too short." }, { status: 400 });
  }

  if (primaryColor && !/^#[0-9a-f]{6}$/i.test(primaryColor)) {
    return NextResponse.json({ message: "Primary color must be a hex color like #0f766e." }, { status: 400 });
  }

  if (Object.keys(settingsUpdates).length > 0) {
    payload.settings = settingsUpdates;
  }

  const [organizationResult, settingsResult] = await Promise.all([
    auth.admin.from("organizations").select("version").eq("id", auth.orgId).maybeSingle(),
    auth.admin.from("organization_settings").select("version").eq("org_id", auth.orgId).maybeSingle(),
  ]);
  const dependencyError = organizationResult.error || settingsResult.error;
  if (dependencyError) {
    return NextResponse.json({ message: dependencyError.message }, { status: 500 });
  }
  if (!organizationResult.data || !settingsResult.data) {
    return NextResponse.json({ message: "Organization settings are not fully provisioned." }, { status: 409 });
  }

  const command = await (auth.admin as unknown as OrganizationRpcClient).rpc("execute_organization_command", {
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: commandId,
    p_action: "tenant_settings_update",
    p_target_org_id: auth.orgId,
    p_expected_org_version: Number(organizationResult.data.version ?? 0),
    p_expected_settings_version: Number(settingsResult.data.version ?? 0),
    p_payload: payload,
  });
  if (command.error) {
    return NextResponse.json(
      { message: command.error.message },
      { status: rpcStatus(command.error.code) }
    );
  }

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
