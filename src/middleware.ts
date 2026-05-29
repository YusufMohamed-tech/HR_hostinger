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
    }
  }

  if (!role) {
    if (isAuthPage) return response;
    if (isApi) {
      return NextResponse.json({ message: "Organization membership is required." }, { status: 403 });
    }
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
