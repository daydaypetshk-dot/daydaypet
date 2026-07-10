"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/admin/dashboard", [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const supabase = supabaseBrowser();
      const normalizedEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      router.replace(nextPath);
    } catch (err) {
      const raw = err instanceof Error && err.message ? err.message : "登入失敗，請檢查帳號密碼。";
      const msg =
        raw === "Invalid login credentials"
          ? "Supabase 回覆：Invalid login credentials。此專案內該帳號已存在且已驗證，請先用右側顯示密碼按鈕確認實際輸入內容，特別留意 email 前後空白與瀏覽器自動填充。"
          : raw;
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      suppressHydrationWarning
      className="min-h-[100svh] bg-gradient-to-b from-slate-50 to-white px-4 py-10"
    >
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-3xl bg-white p-7 shadow-xl ring-1 ring-black/5">
          <div className="text-center">
            <div className="text-2xl font-black text-slate-900">日日寵 Admin</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">管理員登入</div>
          </div>

          <form suppressHydrationWarning onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <div className="text-sm font-bold text-slate-700">電子郵件</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none ring-0 focus:border-slate-400"
                placeholder="admin@example.com"
              />
            </label>

            <label className="block">
              <div className="text-sm font-bold text-slate-700">密碼</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none ring-0 focus:border-slate-400"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="shrink-0 rounded-2xl bg-slate-100 px-3 py-3 text-sm font-bold text-slate-800"
                >
                  {showPassword ? "隱藏" : "顯示"}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className={[
                "w-full rounded-2xl bg-red-600 px-4 py-3 text-base font-black text-white shadow-lg",
                submitting ? "opacity-70" : "",
              ].join(" ")}
            >
              {submitting ? "登入中…" : "登入"}
            </button>
          </form>

          <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs font-semibold text-slate-600">
            未登入將無法進入 /admin/dashboard
          </div>
        </div>
      </div>
    </div>
  );
}
