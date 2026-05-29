import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  getDefaultPathForRole,
  isCandidatePath,
  isPublicPath,
  roleFromOrgRole,
} from "./lib/rbac";

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

  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = roleFromOrgRole(String((membership as { role?: string } | null)?.role || ""));

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
