import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type UserRole = "user" | "admin";

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

export async function getSignedInUserServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });

  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

export async function getUserRoleServer(userId: string, email: string | null | undefined): Promise<UserRole> {
  if (email && isDeveloperAdminEmail(email)) {
    try {
      const admin = supabaseAdmin();
      await admin.from("user_roles").upsert({ user_id: userId, role: "admin" });
    } catch {}
    return "admin";
  }

  try {
    const admin = supabaseAdmin();
    const { data } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    const role = data?.role === "admin" ? "admin" : "user";
    return role;
  } catch {
    return "user";
  }
}

export async function assertAdminServer() {
  const user = await getSignedInUserServer();
  if (!user) return { ok: false as const, status: 401 as const, error: "Not authenticated" };
  const role = await getUserRoleServer(user.id, user.email);
  if (role !== "admin") return { ok: false as const, status: 403 as const, error: "Not admin" };
  return { ok: true as const, user, role };
}
