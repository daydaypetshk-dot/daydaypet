import { supabaseAdmin } from "@/lib/supabase/admin";

export type FbMonitoredGroupRow = {
  id: string;
  group_name: string;
  group_url: string;
  is_active: boolean;
  created_at: string;
};

export class FbGroupInputError extends Error {}
export class FbGroupConflictError extends Error {}

function normalizeGroupName(value: unknown) {
  const name = String(value ?? "").trim();
  if (!name) throw new FbGroupInputError("請輸入群組名稱");
  return name;
}

export function normalizeFbGroupUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new FbGroupInputError("請輸入 Facebook 群組網址");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FbGroupInputError("Facebook 群組網址格式不正確");
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new FbGroupInputError("Facebook 群組網址格式不正確");
  }

  const hostname = url.hostname.toLowerCase();
  const normalizedHost = hostname === "www.facebook.com" ? "facebook.com" : hostname;
  if (normalizedHost !== "facebook.com" && normalizedHost !== "fb.com") {
    throw new FbGroupInputError("請輸入有效的 Facebook 群組網址");
  }

  const pathParts = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (pathParts[0]?.toLowerCase() !== "groups" || !pathParts[1]) {
    throw new FbGroupInputError("Facebook 群組網址必須包含 /groups/ 路徑");
  }

  const pathname = `/${pathParts.join("/")}`;
  return `https://${normalizedHost}${pathname}`;
}

function handleMutationError(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === "23505") {
    throw new FbGroupConflictError("這個 Facebook 群組已經在監控清單內");
  }
  if (error.code === "23514") {
    throw new FbGroupInputError("Facebook 群組資料格式不正確");
  }
  throw new Error(error.message);
}

export async function listFbMonitoredGroups() {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("fb_monitored_groups")
    .select("id,group_name,group_url,is_active,created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as FbMonitoredGroupRow[];
}

export async function createFbMonitoredGroup(input: {
  group_name: unknown;
  group_url: unknown;
}) {
  const admin = supabaseAdmin();
  const payload = {
    group_name: normalizeGroupName(input.group_name),
    group_url: normalizeFbGroupUrl(input.group_url),
  };

  const { data, error } = await admin
    .from("fb_monitored_groups")
    .insert(payload)
    .select("id,group_name,group_url,is_active,created_at")
    .single();

  handleMutationError(error);
  return data as FbMonitoredGroupRow;
}

export async function updateFbMonitoredGroup(
  id: string,
  input: {
    is_active?: unknown;
  },
) {
  const groupId = String(id || "").trim();
  if (!groupId) throw new FbGroupInputError("缺少群組 id");
  if (typeof input.is_active !== "boolean") {
    throw new FbGroupInputError("請提供有效的啟用狀態");
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("fb_monitored_groups")
    .update({ is_active: input.is_active })
    .eq("id", groupId)
    .select("id,group_name,group_url,is_active,created_at")
    .maybeSingle();

  handleMutationError(error);
  if (!data) throw new FbGroupInputError("找不到指定的 Facebook 群組");
  return data as FbMonitoredGroupRow;
}

export async function deleteFbMonitoredGroup(id: string) {
  const groupId = String(id || "").trim();
  if (!groupId) throw new FbGroupInputError("缺少群組 id");

  const admin = supabaseAdmin();
  const { error, count } = await admin
    .from("fb_monitored_groups")
    .delete({ count: "exact" })
    .eq("id", groupId);

  handleMutationError(error);
  if (!count) throw new FbGroupInputError("找不到指定的 Facebook 群組");
}
