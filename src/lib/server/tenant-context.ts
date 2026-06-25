import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type TenantAuthContext = {
  user: User;
  orgId: string;
  role: string;
  employeeId: string;
  admin: ReturnType<typeof createAdminClient>;
};

type TenantContextOptions = {
  roles?: string[];
  feature?: string;
  requireEmployee?: boolean;
};

const activeStatuses = new Set(["active", "Active"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

function normalizeFeatureColumn(feature: string) {
  return `${feature.trim().toLowerCase()}_enabled`;
}

function hasEnabledModule(features: Record<string, unknown> | null, feature: string) {
  if (!features) return true;

  const column = normalizeFeatureColumn(feature);
  if (features[column] === false) return false;

  const enabledModules = features.enabled_modules;
  if (Array.isArray(enabledModules)) {
    return enabledModules.map(String).includes(feature);
  }

  return true;
}

export async function requireTenantContext(options: TenantContextOptions = {}): Promise<TenantAuthContext | { error: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: jsonError("Unauthorized", 401) };
  }

  const admin = createAdminClient();
  const membershipResult = await admin
    .from("org_members")
    .select("id, org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipResult.error) {
    return { error: jsonError(membershipResult.error.message, 500) };
  }

  const membership = membershipResult.data as Record<string, unknown> | null;
  const orgId = String(membership?.org_id || "");
  const role = String(membership?.role || "");

  if (!orgId || !role) {
    return { error: jsonError("Organization membership is required.", 403) };
  }

  if (options.roles?.length && !options.roles.includes(role)) {
    return { error: jsonError("Forbidden", 403) };
  }

  const [{ data: organization, error: organizationError }, { data: profile, error: profileError }, { data: employee, error: employeeError }] =
    await Promise.all([
      admin.from("organizations").select("status, deleted_at").eq("id", orgId).maybeSingle(),
      admin.from("profiles").select("account_status").eq("user_id", user.id).eq("org_id", orgId).maybeSingle(),
      admin.from("employees").select("id").eq("org_id", orgId).eq("user_id", user.id).maybeSingle(),
    ]);

  if (organizationError) return { error: jsonError(organizationError.message, 500) };
  if (profileError) return { error: jsonError(profileError.message, 500) };
  if (employeeError) return { error: jsonError(employeeError.message, 500) };

  const organizationRecord = organization as Record<string, unknown> | null;
  const profileRecord = profile as Record<string, unknown> | null;
  const employeeRecord = employee as Record<string, unknown> | null;
  const organizationStatus = String(organizationRecord?.status || "Active");
  const accountStatus = String(profileRecord?.account_status || "active");
  const deletedAt = String(organizationRecord?.deleted_at || "");

  if (deletedAt || !activeStatuses.has(organizationStatus) || !activeStatuses.has(accountStatus)) {
    return { error: jsonError("Account or organization is suspended.", 403) };
  }

  if (options.feature) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const featuresResult = await (admin as any)
      .from("organization_features")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();

    if (featuresResult.error && featuresResult.error.code !== "42P01") {
      return { error: jsonError(featuresResult.error.message, 500) };
    }

    const featureRecord = featuresResult.data as Record<string, unknown> | null;
    if (!hasEnabledModule(featureRecord, options.feature)) {
      return { error: jsonError("This module is not enabled for the organization plan.", 403) };
    }
  }

  const employeeId = String(employeeRecord?.id || "");
  if (options.requireEmployee && !employeeId) {
    return { error: jsonError("Employee profile is required.", 403) };
  }

  return {
    user,
    orgId,
    role,
    employeeId,
    admin,
  };
}

export function withTenantContext(
  handler: (request: NextRequest, auth: TenantAuthContext, routeContext?: unknown) => Response | Promise<Response>,
  options: TenantContextOptions = {}
) {
  return async function tenantRouteHandler(request: NextRequest, routeContext?: unknown) {
    const auth = await requireTenantContext(options);
    if ("error" in auth) return auth.error;
    return handler(request, auth, routeContext);
  };
}
