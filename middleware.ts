import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createSupabaseMiddlewareClient } from "@/lib/supabase/middleware";

const MAINTENANCE_COOKIE_NAME = "maintenance_access";
const MAINTENANCE_HEADER_NAME = "x-maintenance-password";
const MAINTENANCE_PAGE_PATH = "/maintenance";
const MAINTENANCE_AUTH_API_PATH = "/api/maintenance-auth";

function parseBasicAuthHeader(raw: string | null) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("basic ")) return null;
  const token = trimmed.slice(6).trim();
  if (!token) return null;
  try {
    const decoded = globalThis.atob(token);
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function isBasicAuthEnabled() {
  const user = String(process.env.BASIC_AUTH_USER ?? "").trim();
  const pass = String(process.env.BASIC_AUTH_PASSWORD ?? "").trim();
  return Boolean(user && pass);
}

function isMaintenanceModeEnabled() {
  const password = String(process.env.MAINTENANCE_MODE_PASSWORD ?? "").trim();
  if (!password) return false;
  const enabled = String(process.env.MAINTENANCE_MODE_ENABLED ?? "true").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(enabled);
}

function getExpectedMaintenancePassword() {
  return String(process.env.MAINTENANCE_MODE_PASSWORD ?? "").trim();
}

function hasValidMaintenanceAccess(req: NextRequest) {
  const expected = getExpectedMaintenancePassword();
  if (!expected) return true;
  const cookiePassword = req.cookies.get(MAINTENANCE_COOKIE_NAME)?.value?.trim() ?? "";
  if (cookiePassword && cookiePassword === expected) return true;
  const headerPassword = req.headers.get(MAINTENANCE_HEADER_NAME)?.trim() ?? "";
  if (headerPassword && headerPassword === expected) return true;
  return false;
}

function checkBasicAuth(req: NextRequest) {
  const expectedUser = String(process.env.BASIC_AUTH_USER ?? "").trim();
  const expectedPass = String(process.env.BASIC_AUTH_PASSWORD ?? "").trim();
  const parsed = parseBasicAuthHeader(req.headers.get("authorization"));
  if (!parsed) return false;
  return parsed.user === expectedUser && parsed.pass === expectedPass;
}

function unauthorizedBasicAuth() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Admin", charset="UTF-8"',
    },
  });
}

function parseAdminEmails(raw: string | undefined) {
  return (raw || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function isDeveloperAdminEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const list = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (list.includes(normalized)) return true;
  const single = (process.env.DEVELOPER_EMAIL || "").trim().toLowerCase();
  if (single && single === normalized) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const search = req.nextUrl.search || "";
  const isMaintenancePage = pathname === MAINTENANCE_PAGE_PATH;
  const isMaintenanceAuthApi = pathname === MAINTENANCE_AUTH_API_PATH;

  if (isMaintenanceModeEnabled()) {
    const hasMaintenanceAccess = hasValidMaintenanceAccess(req);
    if (!hasMaintenanceAccess && !isMaintenancePage && !isMaintenanceAuthApi) {
      const url = req.nextUrl.clone();
      url.pathname = MAINTENANCE_PAGE_PATH;
      url.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    if (hasMaintenanceAccess && isMaintenancePage) {
      const nextPath = req.nextUrl.searchParams.get("next");
      const redirectPath = nextPath && nextPath.startsWith("/") ? nextPath : "/";
      return NextResponse.redirect(new URL(redirectPath, req.url));
    }
    if (isMaintenancePage || isMaintenanceAuthApi) {
      return NextResponse.next();
    }
  }

  const isAdminPath = pathname.startsWith("/admin");
  const isAdminApiPath = pathname.startsWith("/api/admin");
  if (!isAdminPath && !isAdminApiPath) return NextResponse.next();

  const enabled = isBasicAuthEnabled();
  if (!enabled && process.env.NODE_ENV === "production") {
    return unauthorizedBasicAuth();
  }
  if (enabled && !checkBasicAuth(req)) {
    return unauthorizedBasicAuth();
  }
  if (isAdminApiPath) return NextResponse.next();

  const needsSupabaseAuth = isAdminPath && !pathname.startsWith("/admin/login");
  if (!needsSupabaseAuth) return NextResponse.next();

  const { supabase, res } = createSupabaseMiddlewareClient(req);
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const email = data.user.email || "";
  if (email && isDeveloperAdminEmail(email)) {
    return res;
  }

  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const role = roleRow?.role === "admin" ? "admin" : "user";
  if (roleError || role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)"],
};
