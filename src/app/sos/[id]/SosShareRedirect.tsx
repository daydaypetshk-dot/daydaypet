"use client";

import { useEffect } from "react";

export default function SosShareRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);

  return (
    <div className="min-h-[100svh] bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-xl rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        <div className="text-lg font-black text-slate-900">正在開啟個案詳情…</div>
        <div className="mt-2 text-sm font-semibold text-slate-600">如未自動跳轉，請點擊下方按鈕。</div>
        <div className="mt-4">
          <a
            href={to}
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800"
          >
            立即查看
          </a>
        </div>
      </div>
    </div>
  );
}

