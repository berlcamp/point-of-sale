import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DB_SCHEMA } from "@/lib/config";
import type { Role } from "@/lib/types";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/not-authorized"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Landing route for each role.
function homeForRole(role: Role): string {
  if (role === "super_admin") return "/super-admin";
  if (role === "cashier") return "/";
  return "/admin";
}

// Whether a role may access a given path.
function canAccess(role: Role, pathname: string): boolean {
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isSuper = pathname === "/super-admin" || pathname.startsWith("/super-admin/");
  const isPos = pathname === "/";

  if (role === "super_admin") return isSuper;
  if (role === "cashier") return isPos;
  // admin & manager
  return isPos || isAdmin;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Not configured yet (first-time setup): let requests through so the app boots.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: DB_SCHEMA },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated: allow only public paths.
  if (!user) {
    if (isPublic(pathname)) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated: look up profile/role.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, company_id")
    .eq("id", user.id)
    .maybeSingle();

  // No active company means no store to work in. Revoking a user's LAST
  // membership leaves profiles.company_id null while is_active stays true and
  // role keeps its last value, so the is_active check alone does not catch it:
  // /not-authorized would bounce to homeForRole(role), and that page redirects
  // straight back here — ERR_TOO_MANY_REDIRECTS, with no way to reach /login
  // and sign out. The platform super admin legitimately has no company.
  const hasNoCompany = !profile?.company_id && profile?.role !== "super_admin";

  // Signed in with Google but never invited / provisioned, deactivated
  // account-wide, or left without any store.
  if (!profile || !profile.is_active || hasNoCompany) {
    if (pathname === "/not-authorized") return response;
    const url = request.nextUrl.clone();
    url.pathname = "/not-authorized";
    return NextResponse.redirect(url);
  }

  const role = profile.role as Role;

  // Bounce authenticated users away from login/not-authorized.
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/not-authorized"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  if (isPublic(pathname)) return response;

  // Enforce role-based access.
  if (!canAccess(role, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  return response;
}
