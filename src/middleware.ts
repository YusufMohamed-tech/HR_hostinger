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

function requiredFeatureForPath(pathname: string) {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (normalized.startsWith("/promoter")) return "sales";
  if (normalized.startsWith("/agent")) return "sales";
  if (normalized.startsWith("/sales") || normalized.startsWith("/api/sales")) return "sales";
  if (normalized.startsWith("/recruitment") || normalized.startsWith("/api/recruitment")) return "recruitment";
  if (normalized.startsWith("/accounting") || normalized.startsWith("/api/accounting")) return "accounting";
  if (normalized.startsWith("/chat") || normalized.startsWith("/api/chat")) return "chat";
  if (normalized.startsWith("/assets") || normalized.startsWith("/api/assets")) return "assets";
  if (normalized.startsWith("/payroll")) return "payroll";
  if (normalized.startsWith("/personnel")) return "personnel";
  if (normalized.startsWith("/lms") || normalized.startsWith("/api/lms")) return "lms";
  if (normalized.startsWith("/learn") || normalized.startsWith("/api/learn")) return "lms";
  return null;
}

function featureEnabled(featureRecord: Record<string, unknown> | null, feature: string) {
  if (!featureRecord) return true;
  if (featureRecord[`${feature}_enabled`] === false) return false;
  const enabledModules = featureRecord.enabled_modules;
  if (Array.isArray(enabledModules)) return enabledModules.map(String).includes(feature);
  return true;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const pathname = request.nextUrl.pathname;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
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
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
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
  const platformTableMissing = platformAdminError?.code === "42P01";
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
    role = !platformTableMissing && rawMembershipRole === "super_admin"
      ? null
      : roleFromOrgRole(rawMembershipRole);

    if (role && membershipRecord?.org_id) {
      const [{ data: profile }, { data: organization }] = await Promise.all([
        supabase
          .from("profiles")
          .select("account_status")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select("status")
          .eq("id", membershipRecord.org_id)
          .maybeSingle(),
      ]);

      const accountStatus = String((profile as { account_status?: string } | null)?.account_status || "active").toLowerCase();
      const organizationStatus = String((organization as { status?: string } | null)?.status || "active").toLowerCase();
      const blocked = accountStatus !== "active" || organizationStatus !== "active";

      if (blocked) {
        if (isApi) {
          return NextResponse.json({ message: "Account or organization is suspended." }, { status: 403 });
        }
        return NextResponse.redirect(new URL("/suspended", request.url));
      }

      const requiredFeature = requiredFeatureForPath(pathname);
      if (requiredFeature) {
        const { data: organizationFeatures, error: organizationFeaturesError } = await supabase
          .from("organization_features")
          .select("*")
          .eq("org_id", membershipRecord.org_id)
          .maybeSingle();

        if (!organizationFeaturesError && !featureEnabled(organizationFeatures as Record<string, unknown> | null, requiredFeature)) {
          if (isApi) {
            return NextResponse.json({ message: "This module is not enabled for the organization plan." }, { status: 403 });
          }
          return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
        }
      }
    }
  }

  if (!role) {
    if (isAuthPage) return response;
    // Allow authenticated candidates (no org role) to access candidate API routes
    if (isApi && pathname.startsWith("/api/candidate/")) return response;
    if (isApi) {
      return NextResponse.json({ message: "Organization membership is required." }, { status: 403 });
    }
    // Redirect to candidate portal (not the HR login)
    if (pathname.startsWith("/candidate/")) return response;
    return NextResponse.redirect(new URL("/candidate/applications", request.url));
  }

  if (isAuthPage) {
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  if (!canAccessPath(role, pathname)) {
    if (isApi) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
