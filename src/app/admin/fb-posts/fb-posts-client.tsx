"use client";

import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type AiStatus = "pending" | "processing" | "done" | "failed" | "skipped";

type FbPostRow = {
  id: string;
  post_url: string;
  post_created_at: string | null;
  content_text: string | null;
  ai_status: AiStatus;
  ai_result: unknown;
  ai_error: string | null;
  ai_processed_at: string | null;
  last_seen_at: string;
};

type ProcessResponse = {
  ok?: boolean;
  processed?: number;
  done?: number;
  skipped?: number;
  failed?: number;
  error?: string;
};

function formatHongKongDateTime(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
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

function clipText(value: string | null | undefined, maxLen: number) {
  const text = String(value || "").trim();
  if (!text) return "（無內文）";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown> | null, key: string) {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function formatStatus(status: AiStatus) {
  if (status === "pending") return { label: "待處理", cls: "bg-slate-100 text-slate-700 ring-slate-200" };
  if (status === "processing") return { label: "處理中", cls: "bg-amber-50 text-amber-800 ring-amber-200" };
  if (status === "done") return { label: "已完成", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" };
  if (status === "skipped") return { label: "略過", cls: "bg-slate-50 text-slate-500 ring-slate-200" };
  return { label: "失敗", cls: "bg-red-50 text-red-700 ring-red-200" };
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function FbPostsClient() {
  const [pendingPosts, setPendingPosts] = useState<FbPostRow[]>([]);
  const [resultPosts, setResultPosts] = useState<FbPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(10);

  const summary = useMemo(() => {
    const done = resultPosts.filter((p) => p.ai_status === "done").length;
    const skipped = resultPosts.filter((p) => p.ai_status === "skipped").length;
    const failed = resultPosts.filter((p) => p.ai_status === "failed").length;
    const processingCount = pendingPosts.filter((p) => p.ai_status === "processing").length;
    return { pending: pendingPosts.length, done, skipped, failed, processing: processingCount };
  }, [pendingPosts, resultPosts]);

  const loadPending = async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/fb-posts?status=pending&limit=50`, { cache: "no-store" });
      const data = await readJson<{ posts?: FbPostRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "讀取待處理 FB 貼文失敗");
      setPendingPosts(Array.isArray(data?.posts) ? data!.posts! : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取待處理 FB 貼文失敗");
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  const loadResultsByIds = async (ids: string[]) => {
    if (!ids.length) {
      setResultPosts([]);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/fb-posts?ids=${encodeURIComponent(ids.join(","))}&limit=100`, {
        cache: "no-store",
      });
      const data = await readJson<{ posts?: FbPostRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "讀取處理結果失敗");
      setResultPosts(Array.isArray(data?.posts) ? data!.posts! : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取處理結果失敗");
    }
  };

  const handleRefresh = async () => {
    await loadPending(true);
    if (resultPosts.length) {
      await loadResultsByIds(resultPosts.map((p) => p.id));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/fb-posts?status=pending&limit=50`, { cache: "no-store" });
        const data = await readJson<{ posts?: FbPostRow[]; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error || "讀取待處理 FB 貼文失敗");
        if (!cancelled) {
          setPendingPosts(Array.isArray(data?.posts) ? data!.posts! : []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "讀取待處理 FB 貼文失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(t);
  }, [notice]);

  const triggerMockAi = async () => {
    setProcessing(true);
    setError(null);
    try {
      const target = pendingPosts.slice(0, Math.min(Math.max(limit, 1), 20));
      const ids = target.map((p) => p.id);
      if (!ids.length) {
        setNotice("暫時沒有待處理貼文");
        return;
      }

      const res = await fetch("/api/admin/fb-posts/process-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await readJson<ProcessResponse>(res);
      if (!res.ok) throw new Error(data?.error || "Mock AI 處理失敗");

      await loadResultsByIds(ids);
      await loadPending(false);
      setNotice(`已完成處理：${data?.processed ?? ids.length} 筆`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mock AI 處理失敗");
    } finally {
      setProcessing(false);
    }
  };

  const renderCard = (row: FbPostRow, showResult: boolean) => {
    const meta = asRecord(row.ai_result);
    const petType = pickString(meta, "pet_type");
    const breed = pickString(meta, "breed");
    const location = pickString(meta, "location");
    const phone = pickString(meta, "contact_phone");
    const confidence = meta && typeof meta.confidence === "number" ? meta.confidence : null;
    const matched = meta && Array.isArray(meta.matched_keywords) ? meta.matched_keywords.map(String).slice(0, 6) : [];
    const badge = formatStatus(row.ai_status);

    return (
      <div key={row.id} className="bg-white px-5 py-4 transition hover:bg-slate-50/70">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={["inline-flex items-center rounded-full px-3 py-1 text-xs font-black ring-1", badge.cls].join(" ")}>
                {badge.label}
              </span>
              <div className="text-xs font-black text-slate-500">最後更新：{formatHongKongDateTime(row.last_seen_at)}</div>
              {row.ai_processed_at ? (
                <div className="text-xs font-black text-slate-500">AI：{formatHongKongDateTime(row.ai_processed_at)}</div>
              ) : null}
            </div>

            <div className="mt-3 text-sm font-black text-slate-900">{clipText(row.content_text, 220)}</div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-black text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200">
                貼文時間：{formatHongKongDateTime(row.post_created_at)}
              </span>
              {matched.length ? (
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700 ring-1 ring-indigo-200">
                  命中：{matched.join("、")}
                </span>
              ) : null}
              {confidence != null ? (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200">
                  信心：{Math.round(confidence * 100)}%
                </span>
              ) : null}
            </div>

            {row.ai_error ? (
              <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 ring-1 ring-red-200">
                {row.ai_error}
              </div>
            ) : null}

            {showResult ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Pet Type</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{petType || "—"}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Breed</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{breed || "—"}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Location</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{location || "—"}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Phone</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{phone || "—"}</div>
                </div>
              </div>
            ) : null}
          </div>

          <a
            href={row.post_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-200"
          >
            <ExternalLink className="h-4 w-4" />
            開啟 FB 貼文
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {notice ? (
        <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 ring-1 ring-emerald-200">
          {notice}
        </div>
      ) : null}

      <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-lg font-black text-slate-900">FB 貼文 AI 過濾中心（Mock AI）</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">
              直接把 ai_status=pending 的貼文丟入本地規則引擎，提取 pet_type / breed / location / phone，並回寫狀態。
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <div className="text-xs font-black text-slate-600">每次處理</div>
              <input
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value || "0"))}
                inputMode="numeric"
                className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-1 text-sm font-black text-slate-900 outline-none focus:border-slate-400"
              />
              <div className="text-xs font-black text-slate-500">筆（上限 20）</div>
            </div>

            <button
              type="button"
              onClick={() => void triggerMockAi()}
              disabled={processing || loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              觸發本地 Mock AI 處理
            </button>

            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={processing || loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
            >
              <RefreshCw className={["h-4 w-4", loading ? "animate-spin" : ""].join(" ")} />
              重新整理
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Pending</div>
            <div className="mt-1 text-2xl font-black text-slate-900">{summary.pending}</div>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Done</div>
            <div className="mt-1 text-2xl font-black text-emerald-700">{summary.done}</div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Skipped</div>
            <div className="mt-1 text-2xl font-black text-slate-700">{summary.skipped}</div>
          </div>
          <div className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
            <div className="text-xs font-black uppercase tracking-wide text-red-700">Failed</div>
            <div className="mt-1 text-2xl font-black text-red-700">{summary.failed}</div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl bg-white shadow-xl ring-1 ring-black/5">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="text-base font-black text-slate-900">待處理貼文（ai_status=pending）</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">點擊上方按鈕後，這些貼文會被標記為 done / skipped。</div>
          </div>

          <div className="overflow-hidden rounded-b-3xl">
            {loading ? (
              <div className="space-y-3 bg-slate-50 p-4">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-24 animate-pulse rounded-2xl bg-white" />
                ))}
              </div>
            ) : pendingPosts.length === 0 ? (
              <div className="bg-slate-50 px-6 py-12 text-center">
                <div className="mx-auto text-sm font-black text-slate-600">目前沒有待處理貼文 🎉</div>
                <div className="mt-2 text-xs font-black text-slate-500">先跑 fb:scrape 抓取更多貼文，再回來處理。</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {pendingPosts.map((row) => renderCard(row, false))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl bg-white shadow-xl ring-1 ring-black/5">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="text-base font-black text-slate-900">本次處理結果（即時回寫）</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">
              顯示剛剛被送入 Mock AI 的貼文，方便你立即核對提取欄位與狀態。
            </div>
          </div>

          <div className="overflow-hidden rounded-b-3xl">
            {resultPosts.length === 0 ? (
              <div className="bg-slate-50 px-6 py-12 text-center">
                <div className="mx-auto text-sm font-black text-slate-600">尚未開始處理</div>
                <div className="mt-2 text-xs font-black text-slate-500">點擊「觸發本地 Mock AI 處理」後會在此顯示結果。</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {resultPosts.map((row) => renderCard(row, true))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

