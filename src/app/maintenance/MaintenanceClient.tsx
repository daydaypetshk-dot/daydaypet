"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

export default function MaintenanceClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const raw = searchParams.get("next") || "/";
    return raw.startsWith("/") ? raw : "/";
  }, [searchParams]);

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (!password.trim()) {
      setError("請先輸入維護模式密碼。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/maintenance-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
          next: nextPath,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; redirectTo?: string; error?: string }
        | null;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "驗證失敗，請再試一次。");
      }

      router.replace(json.redirectTo && json.redirectTo.startsWith("/") ? json.redirectTo : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "驗證失敗，請再試一次。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      suppressHydrationWarning
      className="min-h-[100svh] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-10 text-white"
    >
      <div className="mx-auto flex min-h-[calc(100svh-5rem)] w-full max-w-lg items-center">
        <div className="w-full rounded-3xl border border-white/10 bg-white/10 p-7 shadow-2xl backdrop-blur">
          <div className="text-center">
            <div className="text-sm font-black uppercase tracking-[0.3em] text-amber-300">Maintenance Mode</div>
            <h1 className="mt-3 text-3xl font-black text-white">網站維護中</h1>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-200">
              目前全站已加上維護模式保護。請輸入密碼後再進入前台或後台。
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <label className="block">
              <div className="text-sm font-bold text-slate-100">維護模式密碼</div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none focus:border-amber-400"
                placeholder="請輸入密碼"
              />
            </label>

            {error ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className={[
                "w-full rounded-2xl bg-amber-500 px-4 py-3 text-base font-black text-slate-950 shadow-lg",
                submitting ? "opacity-70" : "hover:bg-amber-400",
              ].join(" ")}
            >
              {submitting ? "驗證中…" : "進入網站"}
            </button>
          </form>

          <div className="mt-5 rounded-2xl bg-black/20 px-4 py-3 text-xs font-semibold leading-6 text-slate-300">
            成功後會返回原本要前往的頁面：<span className="font-black text-white">{nextPath}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
