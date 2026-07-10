"use client";

import { useEffect, useMemo, useState } from "react";

type NotificationLogRow = {
  id: string;
  petId: string;
  petName: string;
  receiverUserId: string | null;
  receiverName: string;
  receiverEmail: string;
  receiverContact: string;
  channel:
    | "whatsapp_owner_sighting"
    | "in_app_owner_sighting"
    | "whatsapp_admin_pending_report"
    | "whatsapp_reporter_approved";
  status: "sent" | "skipped_rate_limited" | "failed";
  createdAt: string;
};

type ChannelFilter =
  | "all"
  | "whatsapp_owner_sighting"
  | "in_app_owner_sighting"
  | "whatsapp_admin_pending_report"
  | "whatsapp_reporter_approved";
type StatusFilter = "all" | "sent" | "skipped_rate_limited" | "failed";

function formatDateTime(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function getChannelLabel(channel: NotificationLogRow["channel"]) {
  if (channel === "whatsapp_owner_sighting") return "WhatsApp（目擊通知主人）";
  if (channel === "whatsapp_admin_pending_report") return "WhatsApp（管理員待審批）";
  if (channel === "whatsapp_reporter_approved") return "WhatsApp（報料市民已批准）";
  return "站內小鈴鐺";
}

function getStatusBadge(status: NotificationLogRow["status"]) {
  if (status === "skipped_rate_limited") {
    return {
      label: "🟡 觸發冷卻",
      className: "bg-amber-50 text-amber-700 ring-amber-200",
    };
  }
  if (status === "failed") {
    return {
      label: "🔴 發送失敗",
      className: "bg-red-50 text-red-700 ring-red-200",
    };
  }
  return {
    label: "🟢 成功發送",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
}

export default function AdminNotificationsClient() {
  const [logs, setLogs] = useState<NotificationLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/notifications", { method: "GET", cache: "no-store" });
        const data = (await res.json()) as { logs?: NotificationLogRow[]; error?: string };
        if (!res.ok) {
          throw new Error(data.error || "讀取通知紀錄失敗");
        }
        if (active) {
          setLogs(Array.isArray(data.logs) ? data.logs : []);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "讀取通知紀錄失敗");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const sent = logs.filter((item) => item.status === "sent").length;
    const skipped = logs.filter((item) => item.status === "skipped_rate_limited").length;
    const failed = logs.filter((item) => item.status === "failed").length;
    return { sent, skipped, failed };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      const matchesChannel = channelFilter === "all" || item.channel === channelFilter;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesChannel && matchesStatus;
    });
  }, [channelFilter, logs, statusFilter]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (channelFilter !== "all") count += 1;
    if (statusFilter !== "all") count += 1;
    return count;
  }, [channelFilter, statusFilter]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-lg font-black text-slate-900">通知發送歷史紀錄</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">
              顯示最近 50 筆主人通知事件，方便查看 WhatsApp 與站內通知是否成功送達，或是否因冷卻機制被跳過。
            </div>
          </div>
          <div className="flex gap-2">
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 ring-1 ring-emerald-200">
              成功發送：{summary.sent}
            </div>
            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-700 ring-1 ring-amber-200">
              觸發冷卻：{summary.skipped}
            </div>
            <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 ring-1 ring-red-200">
              發送失敗：{summary.failed}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  按通知管道
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "all" as const, label: "全部" },
                    { value: "whatsapp_owner_sighting" as const, label: "只看主人 WhatsApp" },
                    { value: "whatsapp_admin_pending_report" as const, label: "只看管理員 WhatsApp" },
                    { value: "whatsapp_reporter_approved" as const, label: "只看市民批准通知" },
                    { value: "in_app_owner_sighting" as const, label: "只看站內通知" },
                  ].map((option) => {
                    const active = channelFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setChannelFilter(option.value)}
                        className={[
                          "rounded-full px-4 py-2 text-sm font-black ring-1 transition",
                          active
                            ? "bg-slate-900 text-white ring-slate-900"
                            : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  按發送狀態
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "all" as const, label: "全部" },
                    { value: "sent" as const, label: "🟢 成功發送" },
                    { value: "skipped_rate_limited" as const, label: "🟡 觸發冷卻跳過" },
                    { value: "failed" as const, label: "🔴 發送失敗" },
                  ].map((option) => {
                    const active = statusFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatusFilter(option.value)}
                        className={[
                          "rounded-full px-4 py-2 text-sm font-black ring-1 transition",
                          active
                            ? "bg-slate-900 text-white ring-slate-900"
                            : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200">
                目前顯示：{filteredLogs.length} 筆
              </div>
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setChannelFilter("all");
                    setStatusFilter("all");
                  }}
                  className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  清除篩選
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
            正在讀取通知紀錄...
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl bg-red-50 px-4 py-4 text-sm font-semibold text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
            目前尚無通知發送紀錄
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
            目前沒有符合篩選條件的通知紀錄
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">毛孩案件</th>
                  <th className="px-4 py-3">接收對象</th>
                  <th className="px-4 py-3">發送類型</th>
                  <th className="px-4 py-3">發送狀態</th>
                  <th className="px-4 py-3">觸發時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((item) => {
                  const statusBadge = getStatusBadge(item.status);
                  return (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-4">
                        <div className="text-sm font-black text-slate-900">{item.petName || item.petId}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">Pet ID: {item.petId}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-black text-slate-900">
                          {item.receiverName || "未命名接收者"}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {item.receiverContact || item.receiverEmail || item.receiverUserId || "未能讀取接收者資料"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm font-bold text-slate-700">
                        {getChannelLabel(item.channel)}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${statusBadge.className}`}
                        >
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                        {formatDateTime(item.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
