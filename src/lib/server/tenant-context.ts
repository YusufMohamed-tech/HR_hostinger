import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/types/database";
import { consumeRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requestIdFromHeaders } from "@/lib/request-id";

export type TenantCapability =
  | "manage_people"
  | "manage_attendance"
  | "manage_leave"
  | "manage_recruitment"
  | "manage_payroll"
  | "manage_assets"
  | "manage_locations";

export type TenantCapabilities = Readonly<Record<TenantCapability, boolean>>;

export type TenantAuthContext = {
  user: User;
  orgId: string;
  role: OrgRole;
  employeeId: string;
  timezone: string;
  locale: string;
  planCode: string;
  requestId: string;
  capabilities: TenantCapabilities;
  admin: ReturnType<typeof createAdminClient>;
};

type TenantContextOptions = {
  roles?: readonly string[];
  capability?: TenantCapability;
  feature?: string;
  features?: readonly string[];
  requireEmployee?: boolean;
};

const ACTIVE_STATUSES = new Set(["active"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const ORG_ROLES = new Set<OrgRole>([
  "super_admin",
  "admin",
  "employee",
  "hr_admin",
  "hr_recruitment",
  "training_manager",
  "sales",
  "sales_manager",
  "onground_agent_manager",
  "inventory_receiver",
  "promoter",
  "field_agent",
  "merchant",
  "finance_manager",
  "accountant",
  "finance_viewer",
  "supervisor",
]);

const FEATURE_COLUMNS = {
  hr: "hr_enabled",
  sales: "sales_enabled",
  recruitment: "recruitment_enabled",
  accounting: "accounting_enabled",
  chat: "chat_enabled",
  assets: "assets_enabled",
  payroll: "payroll_enabled",
  personnel: "personnel_enabled",
  lms: "lms_enabled",
} as const;

function requestIdFor(request?: NextRequest) {
  return requestIdFromHeaders(request?.headers);
}

function jsonError(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { message, requestId },
    { status, headers: { "x-request-id": requestId } }
  );
}

function normalizedStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isOrgRole(value: unknown): value is OrgRole {
  return ORG_ROLES.has(value as OrgRole);
}

function moduleIsEnabled(features: Record<string, unknown>, feature: string) {
  const moduleName = feature.trim().toLowerCase() as keyof typeof FEATURE_COLUMNS;
  const column = FEATURE_COLUMNS[moduleName];
  if (!column || features[column] !== true) return false;

  const enabledModules = features.enabled_modules;
  return Array.isArray(enabledModules)
    && enabledModules.some((value) => String(value).trim().toLowerCase() === moduleName);
}

function planAllowsModule(planFeatures: unknown, feature: string) {
  if (!planFeatures || typeof planFeatures !== "object" || Array.isArray(planFeatures)) return false;
  return (planFeatures as Record<string, unknown>)[feature.trim().toLowerCase()] === true;
}

function capabilitiesFor(role: OrgRole): TenantCapabilities {
  const organizationAdmin = role === "admin" || role === "super_admin";
  const peopleManager = organizationAdmin || role === "hr_admin";

  return {
    manage_people: peopleManager,
    manage_attendance: peopleManager,
    manage_leave: peopleManager,
    manage_recruitment: peopleManager || role === "hr_recruitment",
    manage_payroll: peopleManager || role === "finance_manager",
    manage_assets: peopleManager,
    manage_locations: peopleManager || role === "training_manager" || role === "sales_manager",
  };
}

function subscriptionIsActive(subscription: {
  status: string;
  period_end: string | null;
  trial_end: string | null;
}) {
  const status = normalizedStatus(subscription.status);
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return false;

  const expiry = status === "trialing" ? subscription.trial_end : subscription.period_end;
  return !expiry || Date.parse(expiry) > Date.now();
}

export async function requireTenantContext(
  options: TenantContextOptions = {},
  request?: NextRequest
): Promise<TenantAuthContext | { error: NextResponse }> {
  const requestId = requestIdFor(request);
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: jsonError("Unauthorized", 401, requestId) };
  }

  const admin = createAdminClient();
  if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      const multipart = (request.headers.get("content-type") || "").includes("multipart/form-data");
      const sensitive = request.nextUrl.pathname.startsWith("/api/superadmin")
        || request.nextUrl.pathname.includes("/disburse") || request.nextUrl.pathname.includes("/post");
      const limit = multipart ? 20 : sensitive ? 30 : 120;
      const rate = await consumeRateLimit({ admin, scope: `tenant:${request.nextUrl.pathname}`,
        identifier: user.id, limit, windowSeconds: 60, blockSeconds: sensitive ? 300 : 60 });
      if (!rate.allowed) return { error: rateLimitResponse(rate, requestId) };
    } catch (error) {
      console.error("Tenant rate-limit dependency failed", { requestId, error });
      return { error: jsonError("Request protection is temporarily unavailable.", 503, requestId) };
    }
  }
  const membershipResult = await admin
    .from("org_members")
    .select("id, org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipResult.error) {
    return { error: jsonError("Unable to resolve a unique organization membership.", 500, requestId) };
  }

  const membership = membershipResult.data;
  if (!membership?.org_id || !isOrgRole(membership.role)) {
    return { error: jsonError("Organization membership is required.", 403, requestId) };
  }

  const orgId = membership.org_id;
  const role = membership.role;
  const capabilities = capabilitiesFor(role);

  if (options.roles?.length && !options.roles.includes(role)) {
    return { error: jsonError("Forbidden", 403, requestId) };
  }

  if (options.capability && !capabilities[options.capability]) {
    return { error: jsonError("Forbidden", 403, requestId) };
  }

  const [
    organizationResult,
    profileResult,
    employeeResult,
    settingsResult,
    featuresResult,
    subscriptionResult,
    plansResult,
  ] = await Promise.all([
    admin.from("organizations").select("status, deleted_at").eq("id", orgId).maybeSingle(),
    admin.from("profiles").select("account_status").eq("user_id", user.id).eq("org_id", orgId).maybeSingle(),
    admin
      .from("employees")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .eq("lifecycle_status", "active")
      .ilike("status", "active")
      .maybeSingle(),
    admin.from("organization_settings").select("timezone, locale").eq("org_id", orgId).maybeSingle(),
    admin.from("organization_features").select("*").eq("org_id", orgId).maybeSingle(),
    admin
      .from("organization_subscriptions")
      .select("plan_code, status, period_end, trial_end")
      .eq("org_id", orgId)
      .maybeSingle(),
    admin.from("plans").select("code, features, is_active").eq("is_active", true),
  ]);

  const dependencyError = [
    organizationResult.error,
    profileResult.error,
    employeeResult.error,
    settingsResult.error,
    featuresResult.error,
    subscriptionResult.error,
    plansResult.error,
  ].find(Boolean);

  if (dependencyError) {
    console.error("Tenant context dependency failed", { requestId, code: dependencyError.code });
    return { error: jsonError("Tenant authorization is temporarily unavailable.", 503, requestId) };
  }

  const organization = organizationResult.data;
  const profile = profileResult.data;
  const employee = employeeResult.data;
  const settings = settingsResult.data;
  const features = featuresResult.data;
  const subscription = subscriptionResult.data;
  const plan = plansResult.data?.find((candidate) => candidate.code === subscription?.plan_code);

  if (!organization || !profile) {
    return { error: jsonError("Tenant account provisioning is incomplete.", 403, requestId) };
  }

  if (
    organization.deleted_at
    || !ACTIVE_STATUSES.has(normalizedStatus(organization.status))
    || !ACTIVE_STATUSES.has(normalizedStatus(profile.account_status))
  ) {
    return { error: jsonError("Account or organization is suspended.", 403, requestId) };
  }

  if (!settings?.timezone || !settings.locale || !features || !subscription || !plan) {
    return { error: jsonError("Tenant configuration is incomplete.", 503, requestId) };
  }

  if (!subscriptionIsActive(subscription)) {
    return { error: jsonError("The organization subscription is not active.", 403, requestId) };
  }

  if (!features.plan_code || features.plan_code !== subscription.plan_code) {
    return { error: jsonError("Tenant plan configuration is inconsistent.", 503, requestId) };
  }

  const requiredFeatures = [...new Set([
    ...(options.feature ? [options.feature] : []),
    ...(options.features ?? []),
  ])];
  if (requiredFeatures.some(
    (feature) => !moduleIsEnabled(features, feature) || !planAllowsModule(plan.features, feature)
  )) {
    return { error: jsonError("This module is not enabled for the organization plan.", 403, requestId) };
  }

  const employeeId = employee?.id ?? "";
  if (options.requireEmployee && !employeeId) {
    return { error: jsonError("Employee profile is required.", 403, requestId) };
  }

  return {
    user,
    orgId,
    role,
    employeeId,
    timezone: settings.timezone,
    locale: settings.locale,
    planCode: subscription.plan_code,
    requestId,
    capabilities,
    admin,
  };
}

export function withTenantContext(
  handler: (request: NextRequest, auth: TenantAuthContext, routeContext?: unknown) => Response | Promise<Response>,
  options: TenantContextOptions = {}
) {
  return async function tenantRouteHandler(request: NextRequest, routeContext?: unknown) {
    const auth = await requireTenantContext(options, request);
    if ("error" in auth) return auth.error;

    const response = await handler(request, auth, routeContext);
    response.headers.set("x-request-id", auth.requestId);
    return response;
  };
}
