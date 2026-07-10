import { createClient } from "@supabase/supabase-js";

let didLogSupabaseEnv = false;

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!didLogSupabaseEnv) {
    didLogSupabaseEnv = true;
    console.log("Supabase URL:", url || "(missing)");
    console.log("Supabase Service Role Key:", serviceRoleKey ? "已設定" : "未設定");
  }
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
