"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { supabaseBrowser } from "@/lib/supabase/browser";

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname.startsWith("/admin/login")) return null;

  const itemClass = (href: string) =>
    [
      "inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-black transition-colors",
      pathname.startsWith(href) ? "bg-red-600 text-white" : "bg-white text-slate-800 hover:bg-slate-100",
    ].join(" ");

  const signOut = async () => {
    try {
      const supabase = supabaseBrowser();
      await supabase.auth.signOut();
    } finally {
      router.replace("/admin/login");
      router.refresh();
    }
  };

  return (
    <div className="sticky top-0 z-[70] w-full bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-black text-white">日日寵 Admin</div>
          <div className="hidden items-center gap-2 sm:flex">
            <Link href="/admin/dashboard" className={itemClass("/admin/dashboard")}>
              📊 數據與審批看板
            </Link>
            <Link href="/admin/notifications" className={itemClass("/admin/notifications")}>
              🔔 通知紀錄中心
            </Link>
            <Link href="/admin/users" className={itemClass("/admin/users")}>
              👥 會員管理中心
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 sm:hidden">
            <Link href="/admin/dashboard" className={itemClass("/admin/dashboard")}>
              📊
            </Link>
            <Link href="/admin/notifications" className={itemClass("/admin/notifications")}>
              🔔
            </Link>
            <Link href="/admin/users" className={itemClass("/admin/users")}>
              👥
            </Link>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-200"
          >
            登出
          </button>
        </div>
      </div>
      <div className="h-px w-full bg-slate-200/70" />
    </div>
  );
}
