"use client";

import { createBrowserClient } from "@supabase/ssr";

let didLogSupabaseBrowserEnv = false;

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!didLogSupabaseBrowserEnv) {
    didLogSupabaseBrowserEnv = true;
    console.log("Supabase URL:", url || "(missing)");
    console.log("Supabase Key:", anonKey ? "已設定" : "未設定");
  }
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createBrowserClient(url, anonKey);
}
