"use client";

import { ExternalLink, Globe2, Loader2, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type FbMonitoredGroupRow = {
  id: string;
  group_name: string;
  group_url: string;
  is_active: boolean;
  created_at: string;
};

function formatHongKongDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

async function readJson(res: Response) {
  try {
    return (await res.json()) as {
      groups?: FbMonitoredGroupRow[];
      group?: FbMonitoredGroupRow;
      success?: boolean;
      error?: string;
    };
  } catch {
    return {};
  }
}

function StatusToggle({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative inline-flex h-7 w-14 shrink-0 items-center rounded-full transition-all duration-200",
        checked ? "bg-emerald-500" : "bg-slate-300",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:brightness-95",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200",
          checked ? "translate-x-7" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export default function FbGroupsClient() {
  const [groups, setGroups] = useState<FbMonitoredGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ group_name: "", group_url: "" });

  const summary = useMemo(() => {
    const active = groups.filter((item) => item.is_active).length;
    return { total: groups.length, active, inactive: groups.length - active };
  }, [groups]);

  const loadGroups = async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/fb-groups", { method: "GET", cache: "no-store" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "載入 Facebook 監控群組失敗");
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入 Facebook 監控群組失敗");
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const initialLoad = async () => {
      try {
        const res = await fetch("/api/admin/fb-groups", { method: "GET", cache: "no-store" });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "載入 Facebook 監控群組失敗");
        if (!cancelled) {
          setGroups(Array.isArray(data.groups) ? data.groups : []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "載入 Facebook 監控群組失敗");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void initialLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/fb-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "新增 Facebook 監控群組失敗");
      if (data.group) setGroups((prev) => [data.group!, ...prev]);
      setForm({ group_name: "", group_url: "" });
      setNotice("已成功新增 Facebook 監控群組");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增 Facebook 監控群組失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (row: FbMonitoredGroupRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/fb-groups/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "切換群組狀態失敗");
      if (data.group) {
        setGroups((prev) => prev.map((item) => (item.id === row.id ? data.group! : item)));
      }
      setNotice(!row.is_active ? "已啟用該 Facebook 群組監控" : "已停用該 Facebook 群組監控");
    } catch (err) {
      setError(err instanceof Error ? err.message : "切換群組狀態失敗");
    } finally {
      setBusyId("");
    }
  };

  const handleDelete = async (row: FbMonitoredGroupRow) => {
    const ok = window.confirm(`確定要刪除監控群組「${row.group_name}」嗎？`);
    if (!ok) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/fb-groups/${row.id}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "刪除 Facebook 監控群組失敗");
      setGroups((prev) => prev.filter((item) => item.id !== row.id));
      setNotice("已刪除 Facebook 監控群組");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除 Facebook 監控群組失敗");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {notice ? (
        <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 ring-1 ring-emerald-200">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-slate-900 p-3 text-white">
              <Globe2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-900">Facebook 監控群組基地</div>
              <div className="mt-1 text-sm font-semibold text-slate-500">
                由管理員集中維護要監控的尋寵群組清單，為後續自動抓取與 AI 識別打底。
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">總群組</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{summary.total}</div>
            </div>
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
              <div className="text-xs font-black uppercase tracking-wide text-emerald-700">已啟用</div>
              <div className="mt-1 text-2xl font-black text-emerald-700">{summary.active}</div>
            </div>
            <div className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <div className="text-xs font-black uppercase tracking-wide text-amber-700">已停用</div>
              <div className="mt-1 text-2xl font-black text-amber-700">{summary.inactive}</div>
            </div>
          </div>

          <form onSubmit={handleCreate} className="mt-6 space-y-4">
            <div>
              <label htmlFor="group_name" className="mb-2 block text-sm font-black text-slate-700">
                群組名稱
              </label>
              <input
                id="group_name"
                value={form.group_name}
                onChange={(event) => setForm((prev) => ({ ...prev, group_name: event.target.value }))}
                placeholder="例如：香港貓狗走失關注組"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </div>

            <div>
              <label htmlFor="group_url" className="mb-2 block text-sm font-black text-slate-700">
                FB 群組網址
              </label>
              <input
                id="group_url"
                type="url"
                value={form.group_url}
                onChange={(event) => setForm((prev) => ({ ...prev, group_url: event.target.value }))}
                placeholder="https://www.facebook.com/groups/xxxxx"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              ➕ 新增監控群組
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-lg font-black text-slate-900">目前監控中的 Facebook 群組</div>
              <div className="mt-1 text-sm font-semibold text-slate-500">
                可即時切換監控狀態，或移除已不再需要抓取的群組來源。
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadGroups()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
            >
              <RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />
              重新整理
            </button>
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl ring-1 ring-slate-200">
            {loading ? (
              <div className="space-y-3 bg-slate-50 p-4">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-20 animate-pulse rounded-2xl bg-white" />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="bg-slate-50 px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <div className="mt-4 text-base font-black text-slate-900">暫時未有監控群組</div>
                <div className="mt-2 text-sm font-semibold text-slate-500">
                  先在左側表單輸入群組名稱與 Facebook 群組網址，即可建立第一個監控來源。
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {groups.map((row) => {
                  const disabled = busyId === row.id;
                  return (
                    <div key={row.id} className="bg-white px-5 py-4 transition hover:bg-slate-50/70">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-black text-slate-900">{row.group_name}</div>
                            <span
                              className={[
                                "inline-flex items-center rounded-full px-3 py-1 text-xs font-black ring-1",
                                row.is_active
                                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                  : "bg-slate-100 text-slate-600 ring-slate-200",
                              ].join(" ")}
                            >
                              {row.is_active ? (
                                <>
                                  <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                                  監控中
                                </>
                              ) : (
                                "已停用"
                              )}
                            </span>
                          </div>

                          <a
                            href={row.group_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex max-w-full items-center gap-2 text-sm font-semibold text-sky-700 hover:text-sky-800"
                          >
                            <span className="truncate">{row.group_url}</span>
                            <ExternalLink className="h-4 w-4 shrink-0" />
                          </a>

                          <div className="mt-2 text-xs font-semibold text-slate-500">
                            建立時間：{formatHongKongDateTime(row.created_at)}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                            <span className="text-xs font-black text-slate-600">
                              {row.is_active ? "啟用" : "停用"}
                            </span>
                            <StatusToggle
                              checked={row.is_active}
                              disabled={disabled}
                              onClick={() => void handleToggle(row)}
                            />
                          </div>

                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => void handleDelete(row)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-60"
                          >
                            {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            🗑️ 刪除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
