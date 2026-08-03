import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  getDefaultPathForRole,
  isCandidatePath,
  isPublicPath,
  roleFromOrgRole,
} from "./lib/rbac";
import type { Role } from "./types";
import { requestIdFromHeaders } from "./lib/request-id";
import { isCrossSiteMutation } from "./lib/cross-site-mutation";

const PRIVILEGED_MFA_ROLES: ReadonlySet<Role> = new Set([]);

function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org",
    "media-src 'self' blob: https://*.supabase.co",
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function requiredFeaturesForPath(pathname: string) {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (normalized.startsWith("/sales/inventory") || normalized.startsWith("/api/sales/inventory")) {
    return ["sales", "accounting"];
  }
  if (normalized.startsWith("/promoter")) return ["sales"];
  if (normalized.startsWith("/agent")) return ["sales"];
  if (normalized.startsWith("/merchant")) return ["sales"];
  if (normalized.startsWith("/sales") || normalized.startsWith("/api/sales")) return ["sales"];
  if (normalized.startsWith("/recruitment") || normalized.startsWith("/api/recruitment")) return ["recruitment"];
  if (normalized.startsWith("/banking") || normalized.startsWith("/api/banking")) return ["accounting"];
  if (normalized.startsWith("/accounting") || normalized.startsWith("/api/accounting")) return ["accounting"];
  if (normalized.startsWith("/api/chatbot")) return [];
  if (normalized.startsWith("/chat") || normalized.startsWith("/api/chat")) return ["chat"];
  if (normalized.startsWith("/assets") || normalized.startsWith("/api/assets")) return ["assets"];
  if (normalized.startsWith("/payroll")) return ["payroll"];
  if (normalized.startsWith("/personnel")) return ["personnel"];
  if (normalized.startsWith("/lms") || normalized.startsWith("/api/lms")) return ["lms"];
  if (normalized.startsWith("/learn") || normalized.startsWith("/api/learn")) return ["lms"];
  return [];
}

function featureEnabled(featureRecord: Record<string, unknown> | null, feature: string) {
  if (!featureRecord || featureRecord[`${feature}_enabled`] !== true) return false;
  const enabledModules = featureRecord.enabled_modules;
  return Array.isArray(enabledModules) && enabledModules.map(String).includes(feature);
}

function planAllowsFeature(plan: { features?: unknown } | null, feature: string) {
  const features = plan?.features;
  return Boolean(
    features
    && typeof features === "object"
    && !Array.isArray(features)
    && (features as Record<string, unknown>)[feature] === true
  );
}

function subscriptionEnabled(subscription: { status?: string; period_end?: string | null; trial_end?: string | null } | null) {
  const status = String(subscription?.status || "").toLowerCase();
  if (status !== "active" && status !== "trialing") return false;
  const expiry = status === "trialing" ? subscription?.trial_end : subscription?.period_end;
  return !expiry || Date.parse(expiry) > Date.now();
}

export async function middleware(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const secure = <T extends NextResponse>(result: T): T => {
    result.headers.set("Content-Security-Policy", policy);
    result.headers.set("x-request-id", requestId);
    return result;
  };
  let response = secure(NextResponse.next({ request: { headers: requestHeaders } }));
  const pathname = request.nextUrl.pathname;

  if (isCrossSiteMutation(request)) {
    return secure(NextResponse.json(
      { message: "Cross-site mutation was rejected.", requestId },
      { status: 403 },
    ));
  }

  // Health probes must remain independent from authentication availability.
  if (
    pathname === "/api/health"
    || pathname === "/api/ready"
    || pathname === "/api/internal/outbox"
    || pathname === "/api/internal/compliance"
    || pathname === "/api/internal/file-retention"
    || pathname === "/api/internal/storage-verify"
    || pathname.startsWith("/api/cron/")
    || pathname.startsWith("/api/auth/")
    || pathname.startsWith("/ocr/tesseract/")
    || pathname === "/forgot-password"
    || pathname === "/reset-password"
  ) return response;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [
      !supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !supabaseAnonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
    ].filter(Boolean);
    console.error("Middleware configuration is incomplete", { requestId, missing });
    return secure(isApiRequest(pathname)
      ? NextResponse.json(
          { message: "Service configuration is unavailable.", requestId },
          { status: 503 },
        )
      : new NextResponse("Service configuration is unavailable.", {
          status: 503,
          headers: { "x-request-id": requestId },
        }));
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          requestHeaders.set("cookie", request.cookies.toString());
          const updatedResponse = secure(NextResponse.next({ request: { headers: requestHeaders } }));
          for (const cookie of response.cookies.getAll()) updatedResponse.cookies.set(cookie);
          response = updatedResponse;
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          requestHeaders.set("cookie", request.cookies.toString());
          const updatedResponse = secure(NextResponse.next({ request: { headers: requestHeaders } }));
          for (const cookie of response.cookies.getAll()) updatedResponse.cookies.set(cookie);
          response = updatedResponse;
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const isAuthPage = pathname === "/login";
  const isSuspendedPage = pathname === "/suspended";
  const isCallback = pathname.startsWith("/auth/");
  const isApi = pathname.startsWith("/api/");

  if (!user) {
    if (isPublicPath(pathname)) return response;
    if (isApi) {
      return secure(NextResponse.json({ message: "Unauthorized" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return secure(NextResponse.redirect(loginUrl));
  }

  if (isCallback || isCandidatePath(pathname)) {
    return response;
  }

  if (isSuspendedPage) {
    return response;
  }

  const { data: platformAdmin, error: platformAdminError } = await supabase
    .from("platform_admins")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const platformAdminRecord = platformAdmin as { role?: string; status?: string } | null;
  if (platformAdminError) {
    console.error("Platform admin lookup failed", { requestId, code: platformAdminError.code });
  }
  let role: Role | null = platformAdminRecord?.role === "superadmin" && platformAdminRecord.status === "active"
    ? "Superadmin" as const
    : null;

  if (!role && platformAdminRecord?.status !== "suspended") {
    const { data: membership } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    const membershipRecord = membership as { org_id?: string; role?: string } | null;
    const rawMembershipRole = String(membershipRecord?.role || "");
    role = rawMembershipRole === "super_admin"
      ? null
      : roleFromOrgRole(rawMembershipRole);

    if (role && membershipRecord?.org_id) {
      const [profileResult, organizationResult, settingsResult, featuresResult, subscriptionResult, plansResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("account_status")
          .eq("user_id", user.id)
          .eq("org_id", membershipRecord.org_id)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select("status, deleted_at")
          .eq("id", membershipRecord.org_id)
          .maybeSingle(),
        supabase
          .from("organization_settings")
          .select("timezone, locale")
          .eq("org_id", membershipRecord.org_id)
          .maybeSingle(),
        supabase
          .from("organization_features")
          .select("*")
          .eq("org_id", membershipRecord.org_id)
          .maybeSingle(),
        supabase
          .from("organization_subscriptions")
          .select("plan_code, status, period_end, trial_end")
          .eq("org_id", membershipRecord.org_id)
          .maybeSingle(),
        supabase
          .from("plans")
          .select("code, features")
          .eq("is_active", true),
      ]);

      const tenantDependencyError = [
        profileResult.error,
        organizationResult.error,
        settingsResult.error,
        featuresResult.error,
        subscriptionResult.error,
        plansResult.error,
      ].find(Boolean);
      if (tenantDependencyError) {
        console.error("Middleware tenant authorization failed", { requestId, code: tenantDependencyError.code });
        return secure(isApi
          ? NextResponse.json({ message: "Tenant authorization is temporarily unavailable." }, { status: 503 })
          : new NextResponse("Service unavailable", { status: 503 }));
      }

      const profile = profileResult.data as { account_status?: string } | null;
      const organization = organizationResult.data as { status?: string; deleted_at?: string | null } | null;
      const settings = settingsResult.data as { timezone?: string; locale?: string } | null;
      const organizationFeatures = featuresResult.data as (Record<string, unknown> & { plan_code?: string | null }) | null;
      const subscription = subscriptionResult.data as {
        plan_code?: string;
        status?: string;
        period_end?: string | null;
        trial_end?: string | null;
      } | null;
      const plan = (plansResult.data as Array<{ code?: string; features?: unknown }> | null)
        ?.find((candidate) => candidate.code === subscription?.plan_code) ?? null;

      if (!profile || !organization) {
        return secure(isApi
          ? NextResponse.json({ message: "Tenant account provisioning is incomplete." }, { status: 403 })
          : NextResponse.redirect(new URL("/suspended", request.url)));
      }

      const accountStatus = String(profile.account_status || "").toLowerCase();
      const organizationStatus = String(organization.status || "").toLowerCase();
      const blocked = Boolean(organization.deleted_at) || accountStatus !== "active" || organizationStatus !== "active";

      if (blocked) {
        if (isApi) {
          return secure(NextResponse.json({ message: "Account or organization is suspended." }, { status: 403 }));
        }
        return secure(NextResponse.redirect(new URL("/suspended", request.url)));
      }

      const tenantConfigurationReady = Boolean(
        settings?.timezone
        && settings.locale
        && organizationFeatures?.plan_code
        && subscription?.plan_code
        && organizationFeatures.plan_code === subscription.plan_code
        && plan
        && subscriptionEnabled(subscription)
      );
      if (!tenantConfigurationReady) {
        return secure(isApi
          ? NextResponse.json({ message: "Tenant configuration or subscription is inactive." }, { status: 403 })
          : NextResponse.redirect(new URL("/suspended", request.url)));
      }

      const requiredFeatures = requiredFeaturesForPath(pathname);
      if (requiredFeatures.length > 0) {
        if (!requiredFeatures.some(
          (feature) => featureEnabled(organizationFeatures, feature) && planAllowsFeature(plan, feature)
        )) {
          if (isApi) {
            return secure(NextResponse.json({ message: "This module is not enabled for the organization plan." }, { status: 403 }));
          }
          return secure(NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url)));
        }
      }
    }
  }

  if (!role) {
    if (isAuthPage) return response;
    // Allow authenticated candidates (no org role) to access candidate API routes
    if (isApi && pathname.startsWith("/api/candidate/")) return response;
    if (isApi) {
      return secure(NextResponse.json({ message: "Organization membership is required." }, { status: 403 }));
    }
    // Redirect to candidate portal (not the HR login)
    if (pathname.startsWith("/candidate/")) return response;
    return secure(NextResponse.redirect(new URL("/candidate/applications", request.url)));
  }

  if (isAuthPage) {
    return secure(NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url)));
  }

  if (!canAccessPath(role, pathname)) {
    if (isApi) {
      return secure(NextResponse.json({ message: "Forbidden" }, { status: 403 }));
    }
    return secure(NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url)));
  }

  const isMfaSetupPage = pathname === "/settings/security";
  if (PRIVILEGED_MFA_ROLES.has(role) && !isMfaSetupPage) {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || !assurance.data) {
      console.error("MFA assurance lookup failed", { requestId, message: assurance.error?.message });
      return secure(isApi
        ? NextResponse.json({ message: "Authentication assurance is temporarily unavailable." }, { status: 503 })
        : new NextResponse("Service unavailable", { status: 503 }));
    }
    if (assurance.data.currentLevel !== "aal2") {
      if (isApi) {
        return secure(NextResponse.json(
          { message: "Multi-factor authentication is required.", code: "mfa_required" },
          { status: 403 }
        ));
      }
      const securityUrl = new URL("/settings/security", request.url);
      securityUrl.searchParams.set("mfa", "required");
      securityUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return secure(NextResponse.redirect(securityUrl));
    }
  }

  return response;
}

function isApiRequest(pathname: string) {
  return pathname.startsWith("/api/");
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
