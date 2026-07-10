"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import {
  getCaseIdentityCategoryLabel,
  getContactIdentityLabel,
  needsSourceLink,
  normalizeContactIdentity,
} from "@/lib/pets/contact-identity";
import type { PetRow } from "@/lib/pets/db";
import { getDisplayAddress } from "@/lib/pets/display";
import type { SubscriptionDistrict } from "@/lib/push/district-selection";

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  createdAt: string;
  caseCount: number;
  sightingCount: number;
  subscriptionDistricts: SubscriptionDistrict[];
  subscriptionSummary: string;
  subscriptionCount: number;
  status: "active" | "banned";
  role: "user" | "admin";
};

type UserCaseHistory = {
  id: string;
  title: string;
  time: string;
  status: string;
  href: string;
};

type UserSightingHistory = {
  id: string;
  petId: string;
  petTitle: string;
  time: string;
  content: string;
  href: string;
};

function formatHongKongDateTime(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function formatPetStatus(status: string) {
  if (status === "approved") return "🟢 已審批";
  if (status === "pending") return "🟠 待審批";
  if (status === "resolved") return "🔵 已結案";
  return status || "未設定";
}

function getPetStatusClasses(status: string) {
  if (status === "approved") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "pending") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (status === "resolved") return "bg-sky-50 text-sky-700 ring-sky-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function formatCaseType(caseType: string) {
  if (caseType === "lost") return "走失";
  if (caseType === "spotted_unrescued") return "目擊未救起";
  if (caseType === "found_rescued") return "已救起待尋主";
  return caseType || "未分類";
}

function formatSubscriptionBadge(u: AdminUserRow) {
  if (!u.subscriptionDistricts?.length) return "未訂閱";
  return u.subscriptionSummary || "已訂閱";
}

function AppToast({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone: "success" | "error";
  onClose: () => void;
}) {
  return (
    <div className="fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2">
      <div
        className={[
          "rounded-2xl px-4 py-3 text-sm font-black shadow-xl ring-1",
          tone === "success"
            ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
            : "bg-red-50 text-red-900 ring-red-200",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 truncate">{message}</div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl bg-white/70 px-3 py-2 text-xs font-black ring-1 ring-black/5 hover:bg-white"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

async function readJson(res: Response) {
  try {
    return (await res.json()) as any;
  } catch {
    return null;
  }
}

export default function UsersClient() {
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [viewerUserId, setViewerUserId] = useState<string>("");
  const [detailUser, setDetailUser] = useState<AdminUserRow | null>(null);
  const [detailTab, setDetailTab] = useState<"cases" | "sightings">("cases");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCases, setDetailCases] = useState<UserCaseHistory[]>([]);
  const [detailSightings, setDetailSightings] = useState<UserSightingHistory[]>([]);
  const [previewPet, setPreviewPet] = useState<PetRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("error");

  const showToast = (message: string, tone: "success" | "error" = "error") => {
    setToastMessage(message);
    setToastTone(tone);
    window.clearTimeout((showToast as typeof showToast & { timer?: number }).timer);
    (showToast as typeof showToast & { timer?: number }).timer = window.setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  };

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => {
      const name = (u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [keyword, rows]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/users", { method: "GET" });
        const data = await readJson(res);
        if (!res.ok) {
          const msg = String(data?.error || "載入會員清單失敗");
          throw new Error(msg);
        }
        const users = Array.isArray(data?.users) ? (data.users as AdminUserRow[]) : [];
        if (!cancelled) {
          setRows(users);
          setViewerUserId(String(data?.viewerUserId || ""));
        }
      } catch (err) {
        const msg = err instanceof Error && err.message ? err.message : "載入會員清單失敗";
        if (!cancelled) showToast(msg, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleBan = async (u: AdminUserRow) => {
    const action = u.status === "banned" ? ("unban" as const) : ("ban" as const);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id, action }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String(data?.error || "更新狀態失敗");
        throw new Error(msg);
      }
      const next = data?.status === "banned" ? ("banned" as const) : ("active" as const);
      setRows((prev) => prev.map((row) => (row.id === u.id ? { ...row, status: next } : row)));
      showToast(next === "banned" ? "已成功封鎖該用戶" : "已成功解除封鎖", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新狀態失敗";
      showToast(msg, "error");
    }
  };

  const setRole = async (u: AdminUserRow, nextRole: "user" | "admin") => {
    if (u.id === viewerUserId && nextRole !== "admin") {
      showToast("不能移除自己的管理員權限", "error");
      return;
    }
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id, action: "set_role", role: nextRole }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String(data?.error || "更新權限失敗");
        throw new Error(msg);
      }
      const role = data?.role === "admin" ? ("admin" as const) : ("user" as const);
      setRows((prev) => prev.map((row) => (row.id === u.id ? { ...row, role } : row)));
      showToast(role === "admin" ? "已升格為管理員" : "已降級為一般會員", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新權限失敗";
      showToast(msg, "error");
    }
  };

  const openDetail = async (u: AdminUserRow) => {
    setDetailUser(u);
    setDetailTab("cases");
    setDetailLoading(true);
    setDetailCases([]);
    setDetailSightings([]);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}/history`, { method: "GET" });
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String(data?.error || "載入會員詳情失敗");
        throw new Error(msg);
      }
      setDetailCases(Array.isArray(data?.cases) ? (data.cases as UserCaseHistory[]) : []);
      setDetailSightings(Array.isArray(data?.sightings) ? (data.sightings as UserSightingHistory[]) : []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "載入會員詳情失敗";
      showToast(msg, "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const openCasePreview = async (petId: string) => {
    const normalizedId = petId.trim();
    if (!normalizedId) return;
    setPreviewLoading(true);
    setPreviewPet(null);
    try {
      const res = await fetch(`/api/admin/pets/${encodeURIComponent(normalizedId)}`, { method: "GET" });
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String(data?.error || "載入案件預覽失敗");
        throw new Error(msg);
      }
      setPreviewPet((data?.pet || null) as PetRow | null);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "載入案件預覽失敗";
      showToast(msg, "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailUser(null);
    setPreviewPet(null);
    setPreviewLoading(false);
  };

  const closePreview = () => {
    setPreviewPet(null);
    setPreviewLoading(false);
  };

  return (
    <div className="min-h-[100svh] bg-gradient-to-b from-slate-50 to-white px-4 py-10">
      {toastMessage ? (
        <AppToast message={toastMessage} tone={toastTone} onClose={() => setToastMessage(null)} />
      ) : null}

      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-2xl font-black text-slate-900">會員管理</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">只限管理員查看與封鎖/解封會員</div>
          </div>

          <label className="w-full sm:w-[320px]">
            <div className="text-sm font-black text-slate-700">搜尋（用戶名稱 / Email）</div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none focus:border-slate-400"
              placeholder="例如：chan / gmail.com"
            />
          </label>
        </div>

        <div className="mt-6 overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-black/5">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr className="text-xs font-black uppercase tracking-wide text-slate-600">
                  <th className="px-5 py-4">用戶</th>
                  <th className="px-5 py-4">註冊時間</th>
                  <th className="px-5 py-4">活動數據</th>
                  <th className="px-5 py-4">通知訂閱</th>
                  <th className="px-5 py-4">權限</th>
                  <th className="px-5 py-4">狀態</th>
                  <th className="px-5 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-5 py-8 text-sm font-semibold text-slate-500" colSpan={7}>
                      載入中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-sm font-semibold text-slate-500" colSpan={7}>
                      找不到符合條件的用戶
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-full bg-slate-200 ring-1 ring-black/5">
                            {u.avatarUrl ? (
                              <Image
                                src={u.avatarUrl}
                                alt=""
                                width={40}
                                height={40}
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900">
                              {u.name || u.email || "(無名稱)"}
                            </div>
                            <div className="truncate text-xs font-semibold text-slate-500">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                        {u.createdAt ? formatHongKongDateTime(u.createdAt) : ""}
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-1 text-sm">
                          <div className="font-black text-slate-900">案件：{u.caseCount} 筆</div>
                          <div className="font-semibold text-slate-500">情報：{u.sightingCount} 筆</div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-1 text-sm">
                          <div className="font-black text-slate-900">{formatSubscriptionBadge(u)}</div>
                          <div className="font-semibold text-slate-500">
                            {u.subscriptionCount > 0 ? `已綁定 ${u.subscriptionCount} 台裝置` : "未啟用推播"}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={u.role}
                          onChange={(e) => void setRole(u, e.target.value === "admin" ? "admin" : "user")}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-slate-400"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-3 py-1 text-xs font-black",
                            u.status === "banned"
                              ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
                          ].join(" ")}
                        >
                          {u.status === "banned" ? "🔴 已封鎖" : "🟢 正常"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void openDetail(u)}
                            className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-800 shadow-sm ring-1 ring-slate-200 hover:bg-slate-200"
                          >
                            👁️ 詳情
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleBan(u)}
                            className={[
                              "rounded-2xl px-4 py-3 text-sm font-black shadow-sm ring-1",
                              u.status === "banned"
                                ? "bg-emerald-600 text-white ring-emerald-700/20 hover:bg-emerald-700"
                                : "bg-red-600 text-white ring-red-700/20 hover:bg-red-700",
                            ].join(" ")}
                          >
                            {u.status === "banned" ? "✅ 解除封鎖" : "🚫 封鎖用戶"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detailUser ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="relative max-h-[90svh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <button
              type="button"
              onClick={closeDetail}
              className="absolute right-4 top-4 z-10 rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              aria-label="關閉詳情"
            >
              ✕
            </button>

            <div className="border-b border-slate-100 px-6 py-5">
              <div className="text-2xl font-black text-slate-900">{detailUser.name || detailUser.email || "會員詳情"}</div>
              <div className="mt-1 text-sm font-semibold text-slate-500">{detailUser.email}</div>
              <div className="mt-4 grid gap-3 rounded-3xl bg-slate-50 p-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">通知訂閱地區</div>
                  <div className="mt-2 text-sm font-black text-slate-900">{formatSubscriptionBadge(detailUser)}</div>
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">推播裝置</div>
                  <div className="mt-2 text-sm font-black text-slate-900">
                    {detailUser.subscriptionCount > 0 ? `${detailUser.subscriptionCount} 台已綁定` : "未綁定裝置"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDetailTab("cases")}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-black",
                    detailTab === "cases" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  ].join(" ")}
                >
                  發佈案件
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab("sightings")}
                  className={[
                    "rounded-2xl px-4 py-2 text-sm font-black",
                    detailTab === "sightings" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  ].join(" ")}
                >
                  提供情報
                </button>
              </div>
            </div>

            <div className="max-h-[65svh] overflow-y-auto px-6 py-5">
              {detailLoading ? (
                <div className="text-sm font-semibold text-slate-500">載入中…</div>
              ) : detailTab === "cases" ? (
                detailCases.length === 0 ? (
                  <div className="text-sm font-semibold text-slate-500">暫未找到該會員發佈的案件</div>
                ) : (
                  <div className="space-y-3">
                    {detailCases.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-base font-black text-slate-900">{item.title}</div>
                            <div className="mt-1 text-sm font-semibold text-slate-500">
                              {formatHongKongDateTime(item.time)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                              {item.status}
                            </span>
                            <button
                              type="button"
                              onClick={() => void openCasePreview(item.id)}
                              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700"
                            >
                              👁️ 查看案件
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : detailSightings.length === 0 ? (
                <div className="text-sm font-semibold text-slate-500">暫未找到該會員提交的情報</div>
              ) : (
                <div className="space-y-3">
                  {detailSightings.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-black text-slate-900">{item.petTitle}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-500">
                            {formatHongKongDateTime(item.time)}
                          </div>
                          <div className="mt-3 rounded-2xl bg-white p-3 text-sm font-medium leading-relaxed text-slate-700 ring-1 ring-slate-200">
                            {item.content}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openCasePreview(item.petId)}
                          className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700"
                        >
                          👁️ 查看案件
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {detailUser && (previewLoading || previewPet) ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-6">
          <div className="relative max-h-[92svh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <button
              type="button"
              onClick={closePreview}
              className="absolute right-4 top-4 z-10 rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              aria-label="關閉案件預覽"
            >
              ✕
            </button>

            {previewLoading ? (
              <div className="px-6 py-10 text-sm font-semibold text-slate-500">載入案件預覽中…</div>
            ) : previewPet ? (
              (() => {
                const identity = normalizeContactIdentity(previewPet.source_type, previewPet.case_type);
                return (
              <div className="max-h-[92svh] overflow-y-auto">
                <div className="border-b border-slate-100 px-6 py-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="pr-12">
                      <div className="text-2xl font-black text-slate-900">
                        {previewPet.pet_name || "(未命名案件)"}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-500">
                        建立時間：{formatHongKongDateTime(previewPet.created_at) || "未提供"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                        {formatCaseType(previewPet.case_type)}
                      </span>
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-200">
                        {getCaseIdentityCategoryLabel(identity)}
                      </span>
                      <span
                        className={[
                          "rounded-full px-3 py-1 text-xs font-black ring-1",
                          getPetStatusClasses(previewPet.status),
                        ].join(" ")}
                      >
                        {formatPetStatus(previewPet.status)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-black text-slate-900">詳情描述</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-700">
                        {previewPet.features?.trim() || "未提供案件描述"}
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-black text-slate-900">案件資訊</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <div>
                            <span className="font-black text-slate-900">寵物類型：</span>
                            {previewPet.pet_type || "未提供"}
                          </div>
                          <div>
                            <span className="font-black text-slate-900">案件時間：</span>
                            {formatHongKongDateTime(previewPet.lost_time) || "未提供"}
                          </div>
                          <div>
                            <span className="font-black text-slate-900">地點：</span>
                            {getDisplayAddress(previewPet.location || "", previewPet.manual_address || null) || "未提供"}
                          </div>
                          <div>
                            <span className="font-black text-slate-900">分區：</span>
                            {previewPet.district || "未設定"}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-black text-slate-900">聯絡與來源</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <div>
                            <span className="font-black text-slate-900">聯絡電話：</span>
                            {previewPet.phone || "未提供"}
                          </div>
                          <div>
                            <span className="font-black text-slate-900">聯絡人身份：</span>
                            {getContactIdentityLabel(identity)}
                          </div>
                          {needsSourceLink(identity) && (previewPet.source_link || previewPet.source_url) ? (
                            <div className="break-all">
                              <span className="font-black text-slate-900">原帖連結：</span>
                              <a
                                href={previewPet.source_link || previewPet.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1 text-sky-700 underline decoration-sky-200 underline-offset-2"
                              >
                                查看原始來源
                              </a>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {previewPet.timeline && previewPet.timeline.length > 0 ? (
                      <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-black text-slate-900">目擊 / 更新紀錄</div>
                        <div className="mt-3 space-y-3">
                          {previewPet.timeline.map((item, index) => (
                            <div key={`${item.time}-${index}`} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                              <div className="text-sm font-black text-slate-900">
                                {formatHongKongDateTime(item.time) || item.time || "未提供時間"}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-700">
                                {item.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                      {previewPet.image_url ? (
                        <img
                          src={previewPet.image_url}
                          alt={previewPet.pet_name || "案件相片"}
                          className="h-auto max-h-[52svh] w-full object-contain bg-white"
                        />
                      ) : (
                        <div className="flex h-[260px] items-center justify-center text-sm font-semibold text-slate-400">
                          暫無案件相片
                        </div>
                      )}
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-black text-slate-900">座標</div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div>
                          <span className="font-black text-slate-900">Latitude：</span>
                          {previewPet.latitude ?? "未提供"}
                        </div>
                        <div>
                          <span className="font-black text-slate-900">Longitude：</span>
                          {previewPet.longitude ?? "未提供"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                );
              })()
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
