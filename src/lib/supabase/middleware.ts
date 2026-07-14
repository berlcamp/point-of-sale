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
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  // Signed in with Google but never invited / provisioned.
  if (!profile || !profile.is_active) {
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
