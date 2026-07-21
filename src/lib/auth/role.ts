import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type UserRole = "user" | "admin";
export type AdminSource = "user_roles" | "admin_users" | "env_whitelist" | "none";

function parseAdminEmails(raw: string | undefined) {
  return (raw || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function isDeveloperAdminEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const list = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (list.includes(normalized)) return true;
  const single = (process.env.DEVELOPER_EMAIL || "").trim().toLowerCase();
  if (single && single === normalized) return true;
  return false;
}

async function lookupAdminByAuthenticatedSession(userId: string): Promise<AdminSource> {
  const supabase = await createSupabaseServerAuthClient();
  if (!supabase) return "none";

  const { data: roleRow, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (roleError) {
    console.log("Admin role query via authenticated session failed:", roleError.message);
  }
  if (roleRow?.role === "admin") return "user_roles";

  const { data: adminUserRow, error: adminUserError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminUserError) {
    console.log("Admin admin_users query via authenticated session failed:", adminUserError.message);
  }
  if (adminUserRow?.user_id) return "admin_users";

  return "none";
}

async function lookupAdminByServiceRole(userId: string): Promise<AdminSource> {
  const admin = supabaseAdmin();

  const { data: roleRow, error: roleError } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (roleError) {
    console.log("Admin role query via service role failed:", roleError.message);
  }
  if (roleRow?.role === "admin") return "user_roles";

  const { data: adminUserRow, error: adminUserError } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminUserError) {
    console.log("Admin admin_users query via service role failed:", adminUserError.message);
  }
  if (adminUserRow?.user_id) return "admin_users";

  return "none";
}

async function createSupabaseServerAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            (cookieStore as unknown as { set: (name: string, value: string, options?: unknown) => void }).set(
              name,
              value,
              options,
            );
          } catch {}
        }
      },
    },
  });
}

export async function getSignedInUserServer() {
  const supabase = await createSupabaseServerAuthClient();
  if (!supabase) return null;

  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

export async function getAdminSourceServer(userId: string, email: string | null | undefined): Promise<AdminSource> {
  try {
    const sessionSource = await lookupAdminByAuthenticatedSession(userId);
    if (sessionSource !== "none") return sessionSource;
  } catch (error) {
    console.log(
      "Admin lookup via authenticated session threw:",
      error instanceof Error ? error.message : String(error || "unknown_error"),
    );
  }

  if (email && isDeveloperAdminEmail(email)) {
    try {
      const admin = supabaseAdmin();
      await admin.from("user_roles").upsert({ user_id: userId, role: "admin" });
    } catch {}
    return "env_whitelist";
  }

  try {
    const serviceRoleSource = await lookupAdminByServiceRole(userId);
    if (serviceRoleSource !== "none") return serviceRoleSource;
  } catch (error) {
    console.log(
      "Admin lookup via service role threw:",
      error instanceof Error ? error.message : String(error || "unknown_error"),
    );
  }

  return "none";
}

export async function getUserRoleServer(userId: string, email: string | null | undefined): Promise<UserRole> {
  const source = await getAdminSourceServer(userId, email);
  return source === "none" ? "user" : "admin";
}

export async function assertAdminServer() {
  const user = await getSignedInUserServer();
  if (!user) return { ok: false as const, status: 401 as const, error: "Not authenticated" };
  const source = await getAdminSourceServer(user.id, user.email);
  const role: UserRole = source === "none" ? "user" : "admin";
  if (role !== "admin") return { ok: false as const, status: 403 as const, error: "Not admin" };
  return { ok: true as const, user, role, source };
}
