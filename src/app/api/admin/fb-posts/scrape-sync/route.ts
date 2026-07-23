export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { after, NextResponse, type NextRequest } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import { assertAdminServer } from "@/lib/auth/role";
import { formatFbAiStatusCounts, getFbAiStatusCounts, type FbAiStatusCounts } from "@/lib/fb-scraper/ai-status-stats";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ScrapeBody = {
  maxGroups?: number;
  maxPostsPerGroup?: number;
  startIndex?: number;
};

type MonitoredGroup = { id: string; group_name: string; group_url: string };
type ScrapeSummary = {
  ok: true;
  mode: "live" | "mock";
  groups: number;
  candidates: number;
  upserted: number;
  ai_status_counts?: FbAiStatusCounts;
  duration_ms?: number;
  stopped_early?: boolean;
  remaining_groups?: number;
  message?: string;
};
type FbScrapeJobStatus = "queued" | "running" | "completed" | "failed";
type FbScrapeJobMode = "live" | "mock";
type FbScrapeJobRow = {
  id: string;
  requested_by_user_id: string | null;
  job_token: string;
  status: FbScrapeJobStatus;
  mode: FbScrapeJobMode;
  max_groups: number;
  max_posts_per_group: number;
  total_groups: number;
  next_group_index: number;
  processed_groups: number;
  candidates: number;
  upserted: number;
  group_errors: string[];
  ai_status_counts: FbAiStatusCounts | null;
  current_group_id: string | null;
  current_group_name: string | null;
  last_message: string | null;
  last_error: string | null;
  requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};
type GroupProcessResult = {
  candidates: number;
  upserted: number;
  error: string | null;
};
type UpdateHeartbeat = (phase: string, detail?: string) => Promise<void>;
type GroupExecutionContext = {
  jobId: string;
  groupIndex: number;
  totalGroups: number;
};
type WithFacebookPageOptions = {
  timeoutMs?: number;
  timeoutMessage?: string;
};

const WORKER_JOB_ID_HEADER = "x-fb-scrape-job-id";
const WORKER_JOB_TOKEN_HEADER = "x-fb-scrape-job-token";

function env(key: string, fallback = "") {
  const v = String(process.env[key] ?? "").trim();
  return v || fallback;
}

function envNum(key: string, fallback: number) {
  const raw = String(process.env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function randInt(min: number, max: number) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  if (a === b) return a;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const COOKIES_PATH = env("FB_COOKIES_PATH", path.join(process.cwd(), ".secrets", "fb-cookies.json"));
const CHROME_PATH = env("FB_CHROME_PATH", "");
const COOKIES_JSON = env("FB_COOKIES_JSON", "");
const CHROMIUM_CDN_PACK_URL = env(
  "CHROMIUM_CDN_PACK_URL",
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar",
);
const DEFAULT_PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
  "--disable-gpu",
];
const DEFAULT_MAX_POSTS_PER_GROUP = envNum("FB_SCRAPER_MAX_POSTS_PER_GROUP", 12);
const DEFAULT_MAX_GROUPS_PER_RUN = envNum("FB_SCRAPER_MAX_GROUPS_PER_RUN", 0);
const MIN_DELAY_MS = envNum("FB_SCRAPER_MIN_DELAY_MS", 1600);
const MAX_DELAY_MS = envNum("FB_SCRAPER_MAX_DELAY_MS", 4200);
const SCROLL_PASSES = envNum("FB_SCRAPER_SCROLL_PASSES", 6);
const NAV_TIMEOUT_MS = envNum("FB_SCRAPER_NAV_TIMEOUT_MS", 45_000);
const DB_BATCH_SIZE = clamp(envNum("FB_SCRAPER_DB_BATCH_SIZE", 10), 1, 50);
const POST_MIN_DELAY_MS = envNum("FB_SCRAPER_POST_MIN_DELAY_MS", 120);
const POST_MAX_DELAY_MS = envNum("FB_SCRAPER_POST_MAX_DELAY_MS", 360);
const SOFT_TIMEOUT_MS = envNum("FB_SCRAPER_SOFT_TIMEOUT_MS", 45_000);
const GROUP_TIMEOUT_MS = clamp(envNum("FB_SCRAPER_GROUP_TIMEOUT_MS", 45_000), 5_000, 90_000);
const HEARTBEAT_INTERVAL_MS = clamp(envNum("FB_SCRAPER_HEARTBEAT_INTERVAL_MS", 10_000), 5_000, 30_000);
const JOB_GROUP_BATCH_SIZE = clamp(envNum("FB_SCRAPER_JOB_GROUP_BATCH_SIZE", 2), 1, 3);
const STALE_JOB_MS = clamp(
  envNum("FB_SCRAPER_STALE_JOB_MS", Math.max(GROUP_TIMEOUT_MS + 60_000, HEARTBEAT_INTERVAL_MS * 4, 120_000)),
  Math.max(GROUP_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS * 2, 60_000),
  300_000,
);
const SKIP_GROUP_IDS = new Set(
  String(env("FB_SCRAPER_SKIP_GROUP_IDS", ""))
    .split(/[\r\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const SKIP_GROUP_NAMES = String(env("FB_SCRAPER_SKIP_GROUP_NAMES", ""))
  .split(/[\r\n,]+/)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const SKIP_GROUP_URL_PATTERNS = String(env("FB_SCRAPER_SKIP_GROUP_URLS", ""))
  .split(/[\r\n,]+/)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

function isDevMockEnabled() {
  return process.env.NODE_ENV !== "production" && env("FB_SCRAPER_ENABLE_DEV_MOCK", "1") === "1";
}

async function resolveChromeExecutablePath() {
  if (CHROME_PATH) return CHROME_PATH;
  if (process.env.NODE_ENV === "production") {
    try {
      return await chromium.executablePath(CHROMIUM_CDN_PACK_URL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "unknown_error");
      console.error("[FB Scraper] Remote Chromium pack failed:", CHROMIUM_CDN_PACK_URL, message);
      return chromium.executablePath();
    }
  }
  return chromium.executablePath();
}

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function resolveUserDataDir() {
  const configured = env("FB_USER_DATA_DIR", "");
  const localDefault = path.join(process.cwd(), ".secrets", "fb-chrome-profile");
  const cloudDefault = path.join(tmpdir(), "fb-chrome-profile");
  const isVercelRuntime = String(process.env.VERCEL ?? "").trim() === "1" || Boolean(String(process.env.VERCEL_ENV ?? "").trim());
  const shouldUseCloudTmp = isVercelRuntime || process.env.NODE_ENV === "production";

  if (!configured) {
    return shouldUseCloudTmp ? cloudDefault : localDefault;
  }

  if (shouldUseCloudTmp && configured.replace(/\\/g, "/").startsWith("/var/task/")) {
    return cloudDefault;
  }

  return configured;
}

function parseCookieArray(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadCookies() {
  if (COOKIES_JSON) {
    const direct = parseCookieArray(COOKIES_JSON);
    if (direct) return direct;

    try {
      const decoded = Buffer.from(COOKIES_JSON, "base64").toString("utf8");
      const decodedParsed = parseCookieArray(decoded);
      if (decodedParsed) return decodedParsed;
    } catch {}
  }

  if (fs.existsSync(COOKIES_PATH)) {
    try {
      const raw = fs.readFileSync(COOKIES_PATH, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeFacebookUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://www.facebook.com");
    if (!/^https?:$/.test(url.protocol)) return raw;
    url.hash = "";
    if (url.hostname === "m.facebook.com") url.hostname = "www.facebook.com";
    if (url.hostname === "lm.facebook.com") url.hostname = "www.facebook.com";
    if (url.hostname === "l.facebook.com") url.hostname = "www.facebook.com";
    if (url.pathname === "/l.php") return "";

    const keep = new URLSearchParams();
    const params = url.searchParams;
    const hasPostsId = /\/posts\/\d+/.test(url.pathname);
    const isPermalink = url.pathname.endsWith("/permalink.php");
    const hasStory = params.has("story_fbid");

    if (hasPostsId) {
    } else if (hasStory) {
      for (const k of ["story_fbid", "id"]) {
        const v = params.get(k);
        if (v) keep.set(k, v);
      }
    } else if (isPermalink) {
      for (const k of ["fbid", "id"]) {
        const v = params.get(k);
        if (v) keep.set(k, v);
      }
    }

    url.search = keep.toString() ? `?${keep.toString()}` : "";
    return url.toString();
  } catch {
    return raw;
  }
}

function parseFbPostId(postUrl: string) {
  const urlText = String(postUrl || "");
  const matchPosts = urlText.match(/\/posts\/(\d+)/);
  if (matchPosts) return matchPosts[1];
  const matchPermalinkPath = urlText.match(/\/permalink\/(\d+)/);
  if (matchPermalinkPath) return matchPermalinkPath[1];
  const matchStory = urlText.match(/[?&]story_fbid=(\d+)/);
  if (matchStory) return matchStory[1];
  const matchPermalink = urlText.match(/[?&]fbid=(\d+)/);
  if (matchPermalink) return matchPermalink[1];
  return "";
}

function isProbablyFacebookUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return false;
  if (raw.startsWith("/")) return true;
  try {
    const url = new URL(raw);
    return /(^|\.)facebook\.com$/i.test(url.hostname) || /(^|\.)fb\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function normalizeGroupUrl(input: string) {
  const url = normalizeFacebookUrl(input);
  if (!url) return "";
  if (!isProbablyFacebookUrl(url)) return "";
  return url;
}

function buildChronologicalGroupUrl(input: string) {
  const normalized = normalizeGroupUrl(input);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    return url.toString();
  } catch {
    return normalized;
  }
}

function getGroupDisplayName(group: MonitoredGroup) {
  return String(group.group_name || group.id || "unknown_group").trim() || "unknown_group";
}

function getGroupSkipReason(group: MonitoredGroup) {
  const id = String(group.id || "").trim().toLowerCase();
  const name = String(group.group_name || "").trim().toLowerCase();
  const url = String(group.group_url || "").trim().toLowerCase();
  if (id && SKIP_GROUP_IDS.has(id)) return `id=${group.id}`;
  if (name && SKIP_GROUP_NAMES.some((pattern) => name.includes(pattern))) return `name=${group.group_name}`;
  if (url && SKIP_GROUP_URL_PATTERNS.some((pattern) => url.includes(pattern))) return `url=${group.group_url}`;
  return null;
}

function getGroupLogPrefix(context: GroupExecutionContext, group: MonitoredGroup) {
  return `[FB Scrape Job ${context.jobId}] [Group ${context.groupIndex}/${context.totalGroups}] ${getGroupDisplayName(group)}`;
}

function logGroupInfo(context: GroupExecutionContext, group: MonitoredGroup, event: string, detail?: string) {
  const suffix = detail ? ` | ${detail}` : "";
  console.log(`${getGroupLogPrefix(context, group)} | ${event}${suffix}`);
}

function logGroupWarn(context: GroupExecutionContext, group: MonitoredGroup, event: string, detail?: string) {
  const suffix = detail ? ` | ${detail}` : "";
  console.warn(`${getGroupLogPrefix(context, group)} | ${event}${suffix}`);
}

function logGroupError(context: GroupExecutionContext, group: MonitoredGroup, event: string, detail?: string) {
  const suffix = detail ? ` | ${detail}` : "";
  console.error(`${getGroupLogPrefix(context, group)} | ${event}${suffix}`);
}

function createGroupTimeoutMessage(group: MonitoredGroup, timeoutMs: number) {
  return `FB_GROUP_TIMEOUT:${getGroupDisplayName(group)}:${timeoutMs}`;
}

function isGroupTimeoutMessage(message: string) {
  return message.startsWith("FB_GROUP_TIMEOUT:");
}

type GroupSkipReasonCode =
  | "group_timeout"
  | "watchdog_stale_worker"
  | "facebook_login_required"
  | "facebook_session_invalid"
  | "invalid_group_url"
  | "navigation_timeout"
  | "selector_or_dom_missing"
  | "unknown_error";

function classifyGroupSkipReason(message: string, source: "worker" | "watchdog") {
  const text = String(message || "").trim();
  if (source === "watchdog") {
    return {
      code: "watchdog_stale_worker" as const,
      detail: `watchdog 偵測 worker 逾時或被平台中斷（>${STALE_JOB_MS}ms）`,
    };
  }
  if (isGroupTimeoutMessage(text)) {
    return {
      code: "group_timeout" as const,
      detail: `群組處理逾時（>${GROUP_TIMEOUT_MS}ms）`,
    };
  }
  if (text === "FB_LOGIN_REQUIRED") {
    return {
      code: "facebook_login_required" as const,
      detail: "Facebook 要求重新登入，群組頁被登入頁或 checkpoint 擋住",
    };
  }
  if (text === "FB_SESSION_INVALID") {
    return {
      code: "facebook_session_invalid" as const,
      detail: "Facebook session 已失效，cookies 需要重新整理",
    };
  }
  if (/^群組網址無效[:：]/.test(text)) {
    return {
      code: "invalid_group_url" as const,
      detail: text,
    };
  }
  if (/Navigation timeout|net::ERR|ERR_|Timed out/i.test(text)) {
    return {
      code: "navigation_timeout" as const,
      detail: text,
    };
  }
  if (/selector|Cannot read|Cannot find|Failed to find|missing|not found|detached/i.test(text)) {
    return {
      code: "selector_or_dom_missing" as const,
      detail: text,
    };
  }
  return {
    code: "unknown_error" as const,
    detail: text || "unknown_error",
  };
}

function formatGroupSkipReason(reason: { code: GroupSkipReasonCode; detail: string }) {
  return `[${reason.code}] ${reason.detail}`;
}

function parseFacebookTimeToIso(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();

  const zh = text.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:[^\d]*(上午|下午)?\s*(\d{1,2})\s*:\s*(\d{2}))?/,
  );
  if (zh) {
    const y = Number(zh[1]);
    const mo = Number(zh[2]);
    const d = Number(zh[3]);
    const ampm = zh[4] || "";
    let hh = zh[5] ? Number(zh[5]) : 0;
    const mm = zh[6] ? Number(zh[6]) : 0;
    if (ampm === "下午" && hh < 12) hh += 12;
    if (ampm === "上午" && hh === 12) hh = 0;
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(
      2,
      "0",
    )}:${String(mm).padStart(2, "0")}:00+08:00`;
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return null;
}

async function randomDelay(minMs = MIN_DELAY_MS, maxMs = MAX_DELAY_MS) {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  const jitter = min + Math.floor(Math.random() * Math.max(1, max - min));
  await sleep(jitter);
}

async function randomHumanPause(minMs = 350, maxMs = 1100) {
  await sleep(randInt(minMs, maxMs));
}

async function humanMouseJitter(page: any) {
  try {
    const viewport = page.viewport();
    const w = viewport?.width ?? 1200;
    const h = viewport?.height ?? 800;
    const x = randInt(40, Math.max(40, w - 40));
    const y = randInt(40, Math.max(40, h - 40));
    await page.mouse.move(x, y, { steps: randInt(5, 18) });
  } catch {}
}

async function humanScroll(page: any, passes = SCROLL_PASSES) {
  const n = clamp(passes || 0, 0, 30);
  for (let i = 0; i < n; i++) {
    await humanMouseJitter(page);
    await randomHumanPause(200, 700);
    await page.evaluate((y: number) => window.scrollBy(0, y), randInt(450, 1100));
    await randomHumanPause(650, 1600);
    if (Math.random() < 0.18) {
      await page.evaluate((y: number) => window.scrollBy(0, y), -randInt(120, 360));
      await randomHumanPause(350, 900);
    }
  }
}

async function detectLoggedOut(page: any) {
  const url = String(page.url() || "");
  if (url.includes("/login")) return true;
  if (url.includes("checkpoint")) return true;
  const hasLoginInputs = await page
    .evaluate(() => {
      const email = document.querySelector('input[name="email"]');
      const pass = document.querySelector('input[name="pass"]');
      return Boolean(email || pass);
    })
    .catch(() => false);
  return Boolean(hasLoginInputs);
}

async function listActiveGroups(admin: any) {
  const { data, error } = await admin
    .from("fb_monitored_groups")
    .select("id,group_name,group_url,is_active,created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row: any) => ({
      id: String(row.id || "").trim(),
      group_name: String(row.group_name || "").trim(),
      group_url: String(row.group_url || "").trim(),
    }))
    .filter((row: MonitoredGroup) => row.id && row.group_url)
    .filter((row: MonitoredGroup) => {
      const reason = getGroupSkipReason(row);
      if (reason) {
        console.warn(`[FB Scraper] Skip blacklisted group: ${getGroupDisplayName(row)} | ${reason}`);
        return false;
      }
      return true;
    });
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

async function upsertPosts(admin: any, rows: any[]) {
  if (!rows.length) return { inserted: 0 };
  let inserted = 0;
  for (const chunk of chunkRows(rows, DB_BATCH_SIZE)) {
    const { error } = await admin.from("fb_group_posts").upsert(chunk, { onConflict: "source_group_id,fb_post_id" });
    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }
  return { inserted };
}

function shouldStopEarly(startedAt: number) {
  return Date.now() - startedAt >= SOFT_TIMEOUT_MS;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function normalizeJobStatus(value: unknown): FbScrapeJobStatus {
  switch (String(value || "").trim()) {
    case "running":
    case "completed":
    case "failed":
      return value as FbScrapeJobStatus;
    default:
      return "queued";
  }
}

function normalizeJobMode(value: unknown): FbScrapeJobMode {
  return String(value || "").trim() === "mock" ? "mock" : "live";
}

function normalizeFbAiStatusCounts(value: unknown): FbAiStatusCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    pending: Number(source.pending ?? 0) || 0,
    processing: Number(source.processing ?? 0) || 0,
    done: Number(source.done ?? 0) || 0,
    skipped: Number(source.skipped ?? 0) || 0,
    failed: Number(source.failed ?? 0) || 0,
  };
}

function mapScrapeJobRow(row: any): FbScrapeJobRow {
  return {
    id: String(row?.id || ""),
    requested_by_user_id: row?.requested_by_user_id ? String(row.requested_by_user_id) : null,
    job_token: String(row?.job_token || ""),
    status: normalizeJobStatus(row?.status),
    mode: normalizeJobMode(row?.mode),
    max_groups: Number(row?.max_groups ?? 0) || 0,
    max_posts_per_group: Number(row?.max_posts_per_group ?? DEFAULT_MAX_POSTS_PER_GROUP) || DEFAULT_MAX_POSTS_PER_GROUP,
    total_groups: Number(row?.total_groups ?? 0) || 0,
    next_group_index: Number(row?.next_group_index ?? 0) || 0,
    processed_groups: Number(row?.processed_groups ?? 0) || 0,
    candidates: Number(row?.candidates ?? 0) || 0,
    upserted: Number(row?.upserted ?? 0) || 0,
    group_errors: normalizeStringArray(row?.group_errors),
    ai_status_counts: normalizeFbAiStatusCounts(row?.ai_status_counts),
    current_group_id: row?.current_group_id ? String(row.current_group_id) : null,
    current_group_name: row?.current_group_name ? String(row.current_group_name) : null,
    last_message: row?.last_message ? String(row.last_message) : null,
    last_error: row?.last_error ? String(row.last_error) : null,
    requested_at: row?.requested_at ? String(row.requested_at) : null,
    started_at: row?.started_at ? String(row.started_at) : null,
    finished_at: row?.finished_at ? String(row.finished_at) : null,
    last_heartbeat_at: row?.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
    created_at: row?.created_at ? String(row.created_at) : null,
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

function serializeScrapeJob(job: FbScrapeJobRow) {
  const { job_token: _jobToken, ...rest } = job;
  return rest;
}

async function getScrapeJobById(admin: any, jobId: string) {
  const { data, error } = await admin.from("fb_scrape_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapScrapeJobRow(data) : null;
}

async function getLatestScrapeJob(admin: any, onlyActive = false) {
  let query = admin.from("fb_scrape_jobs").select("*").order("requested_at", { ascending: false }).limit(1);
  if (onlyActive) query = query.in("status", ["queued", "running"]);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapScrapeJobRow(data) : null;
}

async function patchScrapeJob(admin: any, jobId: string, patch: Record<string, unknown>) {
  const payload = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await admin.from("fb_scrape_jobs").update(payload).eq("id", jobId).select("*").single();
  if (error) throw new Error(error.message);
  return mapScrapeJobRow(data);
}

async function createScrapeJob(admin: any, payload: Record<string, unknown>) {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("fb_scrape_jobs")
    .insert({
      ...payload,
      requested_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapScrapeJobRow(data);
}

function buildJobToken(startIndex = 0) {
  return `start:${Math.max(0, Math.floor(startIndex))}:${crypto.randomUUID()}`;
}

function getJobGroupOffset(job: FbScrapeJobRow) {
  const match = String(job.job_token || "").match(/^start:(\d+):/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function getJobBatchBounds(totalGroups: number, startIndex: number) {
  const safeStart = clamp(startIndex, 0, Math.max(0, totalGroups));
  const endIndex = Math.min(totalGroups, safeStart + JOB_GROUP_BATCH_SIZE);
  return {
    startIndex: safeStart,
    endIndex,
    batchSize: Math.max(0, endIndex - safeStart),
  };
}

async function triggerScrapeJobWorker(origin: string, jobId: string, jobToken: string) {
  const url = `${origin.replace(/\/$/, "")}/api/admin/fb-posts/scrape-sync`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WORKER_JOB_ID_HEADER]: jobId,
        [WORKER_JOB_TOKEN_HEADER]: jobToken,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[FB Scrape Job] Worker trigger failed:", res.status, text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    console.error("[FB Scrape Job] Worker trigger error:", message);
  }
}

async function enqueueNextScrapeJobBatch(
  req: NextRequest,
  admin: any,
  currentJob: FbScrapeJobRow,
  allGroups: MonitoredGroup[],
  startIndex: number,
) {
  if (startIndex >= allGroups.length) return null;

  const bounds = getJobBatchBounds(allGroups.length, startIndex);
  const nextJob = await createScrapeJob(admin, {
    requested_by_user_id: currentJob.requested_by_user_id,
    job_token: buildJobToken(bounds.startIndex),
    status: bounds.batchSize ? "queued" : "completed",
    mode: currentJob.mode,
    max_groups: bounds.batchSize,
    max_posts_per_group: currentJob.max_posts_per_group,
    total_groups: bounds.batchSize,
    next_group_index: 0,
    processed_groups: 0,
    candidates: 0,
    upserted: 0,
    group_errors: [],
    ai_status_counts: currentJob.ai_status_counts,
    current_group_id: null,
    current_group_name: null,
    last_message: bounds.batchSize
      ? `Facebook 背景同步下一批已排入佇列，準備處理第 ${bounds.startIndex + 1}-${bounds.endIndex}/${allGroups.length} 個群組。`
      : "Facebook 背景同步沒有更多待處理群組。",
    last_error: null,
    finished_at: bounds.batchSize ? null : new Date().toISOString(),
    last_heartbeat_at: bounds.batchSize ? null : new Date().toISOString(),
  });

  if (bounds.batchSize) {
    await scheduleScrapeJobWorker(req, nextJob);
  }
  return nextJob;
}

async function runMockSync(admin: any, maxGroups: number): Promise<ScrapeSummary> {
  const groups = await listActiveGroups(admin);
  const targetGroups = maxGroups && maxGroups > 0 ? groups.slice(0, maxGroups) : groups.slice(0, 1);
  if (!targetGroups.length) {
    return {
      ok: true,
      mode: "mock",
      groups: 0,
      candidates: 0,
      upserted: 0,
      message: "目前沒有啟用中的 Facebook 監控群組，Mock 同步已略過。",
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const rows = targetGroups.map((group: MonitoredGroup, index: number) => {
    const mockId = `mock-${now.getTime()}-${index + 1}`;
    const district = ["將軍澳", "沙田", "元朗", "觀塘"][index % 4];
    return {
      source_group_id: group.id,
      fb_post_id: mockId,
      post_url: `https://www.facebook.com/groups/${group.id}/posts/${mockId}`,
      post_created_at: nowIso,
      content_text: `【本地 Mock 同步測試】轉貼 #${district} #小太陽，有街坊見到一隻疑似走失鸚鵡，請管理員進一步審批。`,
      image_urls: [],
      raw_payload: {
        mock: true,
        source: "scrape-sync",
        note: "本地開發環境缺少有效 Facebook session，已改用 Mock 同步。",
        scraped_at: nowIso,
      },
      last_seen_at: nowIso,
    };
  });

  await upsertPosts(admin, rows);
  const counts = await getFbAiStatusCounts(admin);
  return {
    ok: true,
    mode: "mock",
    groups: targetGroups.length,
    candidates: rows.length,
    upserted: rows.length,
    ai_status_counts: counts,
    message: `本地開發環境已使用 Mock 同步資料，貼文已寫入資料庫並維持 pending 待手動過濾。${formatFbAiStatusCounts(counts)}`,
  };
}

async function expandPostBody(page: any) {
  await page
    .evaluate(() => {
      const expandRe = /^(see more|see translation|查看更多|顯示更多|更多|展開)$/i;
      const blockRe = /(comment|comments|reply|replies|留言|回覆|評論|查看更多留言|更多留言)/i;
      const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], a[role="button"], button'));
      let clicked = 0;
      for (const button of buttons as any[]) {
        if (clicked >= 4) break;
        const text = String(button.innerText || button.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || !expandRe.test(text) || blockRe.test(text)) continue;
        const element = button as HTMLElement;
        if (element.getAttribute("aria-disabled") === "true") continue;
        element.click();
        clicked += 1;
      }
      return clicked;
    })
    .catch(() => 0);
}

type FeedCandidatePost = {
  fb_post_id: string;
  post_url: string;
  feed_index: number;
  post_created_at: string | null;
  post_created_at_raw: string | null;
  is_pinned: boolean;
  is_reshare: boolean;
};
type ExtractedPostDetails = {
  content_text: string;
  image_urls: string[];
  post_created_at: string | null;
  post_created_at_raw: string | null;
  content_kind: "text" | "image_only" | "empty";
};

async function extractCandidatePosts(page: any, maxPostsPerGroup: number) {
  const raw = await page.evaluate((limit: number) => {
    const norm = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
    const isPostHref = (href: string) =>
      href.includes("/posts/") || href.includes("story_fbid=") || href.includes("permalink.php") || href.includes("/permalink/");
    const pinnedRe = /(featured|pinned post|置頂|精選)/i;
    const reshareRe = /(shared a post|shared .* post|reposted|分享了貼文|轉發了貼文|分享帖子|轉發帖子)/i;

    const articles = Array.from(document.querySelectorAll('div[role="article"]')) as HTMLElement[];
    const rows: Array<{
      post_url: string;
      feed_index: number;
      post_created_at_raw: string | null;
      is_pinned: boolean;
      is_reshare: boolean;
    }> = [];

    for (let index = 0; index < articles.length; index++) {
      const article = articles[index];
      const rect = article.getBoundingClientRect();
      if (rect.bottom < -200) continue;
      if (rect.top > window.innerHeight * 6) break;

      const hrefs = Array.from(article.querySelectorAll("a[href]"))
        .map((anchor) => anchor.getAttribute("href") || "")
        .filter(Boolean);
      const hit = hrefs.find((href) => isPostHref(href));
      if (!hit) continue;

      const timeNode = article.querySelector("time[datetime], abbr[title]") as HTMLElement | null;
      const postCreatedAtRaw = timeNode
        ? norm(timeNode.getAttribute("datetime") || timeNode.getAttribute("title") || timeNode.textContent || "")
        : null;
      const articleText = norm(article.innerText || article.textContent || "");
      rows.push({
        post_url: hit,
        feed_index: index,
        post_created_at_raw: postCreatedAtRaw || null,
        is_pinned: pinnedRe.test(articleText),
        is_reshare: reshareRe.test(articleText),
      });
      if (rows.length >= limit * 6) break;
    }

    return rows;
  }, maxPostsPerGroup);

  const dedupe = new Map<string, FeedCandidatePost>();
  for (const item of raw as Array<{
    post_url: string;
    feed_index: number;
    post_created_at_raw: string | null;
    is_pinned: boolean;
    is_reshare: boolean;
  }>) {
    const normalized = normalizeFacebookUrl(item.post_url);
    if (!normalized) continue;
    if (!normalized.includes("facebook.com")) continue;
    const fbPostId = parseFbPostId(normalized);
    if (!fbPostId) continue;
    const existing = dedupe.get(fbPostId);
    const candidate: FeedCandidatePost = {
      fb_post_id: fbPostId,
      post_url: normalized,
      feed_index: item.feed_index,
      post_created_at_raw: item.post_created_at_raw,
      post_created_at: parseFacebookTimeToIso(item.post_created_at_raw || ""),
      is_pinned: item.is_pinned,
      is_reshare: item.is_reshare,
    };
    if (!existing || candidate.feed_index < existing.feed_index) {
      dedupe.set(fbPostId, candidate);
    }
  }

  const ranked = Array.from(dedupe.values()).sort((a, b) => {
    const aTime = a.post_created_at ? Date.parse(a.post_created_at) : Number.NaN;
    const bTime = b.post_created_at ? Date.parse(b.post_created_at) : Number.NaN;
    const aHasTime = Number.isFinite(aTime);
    const bHasTime = Number.isFinite(bTime);
    if (aHasTime && bHasTime && aTime !== bTime) return bTime - aTime;
    if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? 1 : -1;
    if (a.is_reshare !== b.is_reshare) return a.is_reshare ? 1 : -1;
    return a.feed_index - b.feed_index;
  });

  const withoutPinnedAndReshare = ranked.filter((item) => !item.is_pinned && !item.is_reshare);
  const withoutPinned = ranked.filter((item) => !item.is_pinned);
  const finalList =
    (withoutPinnedAndReshare.length ? withoutPinnedAndReshare : withoutPinned.length ? withoutPinned : ranked).slice(
      0,
      maxPostsPerGroup,
    );

  return finalList;
}

async function extractPostDetails(page: any, expectedFbPostId: string) {
  const details = await page.evaluate((targetId: string) => {
    const norm = (t: any) => String(t || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const postHrefRe = /\/posts\/|story_fbid=|permalink\.php|\/permalink\//i;
    const bodySelector = '[data-ad-preview="message"], [data-ad-comet-preview="message"]';
    const actionTextRe = /^(like|comment|share|send|reply|follow|more|most relevant|view more comments|write a comment|leave a comment|commenting as|讚好|留言|回覆|分享|發送|最相關|查看更多留言|寫留言|發表留言)$/i;
    const commentBoundaryRe = /(most relevant|all comments|view more comments|write a comment|leave a comment|commenting as|comments|replies|最相關|所有留言|查看更多留言|寫留言|發表留言|留言|回覆)/i;
    const imageAltRe = /(profile picture|avatar|emoji|sticker|icon|reaction|貼圖|頭像|個人檔案相片|表情)/i;
    const imageOnlyLabelRe = /(photo|photos|image|images|相片|照片|圖片)/i;

    const hasPostHref = (href: string) => postHrefRe.test(String(href || ""));
    const getPostLinks = (root: ParentNode) =>
      Array.from(root.querySelectorAll("a[href]"))
        .map((anchor: any) => anchor.getAttribute("href") || "")
        .filter((href: string) => hasPostHref(href));
    const isCommentArea = (node: Element | null) =>
      Boolean(node?.closest('[aria-label*="comment" i], [aria-label*="留言"], [role="textbox"], form, ul[aria-label*="comment" i]'));
    const collectImageCandidates = (rootNode: ParentNode, imgSet: Set<string>) => {
      const pushImage = (raw: string, width = 0, height = 0, alt = "") => {
        const src = String(raw || "").trim();
        if (!src) return;
        if (src.startsWith("data:") || src.startsWith("blob:")) return;
        if (!/(fbcdn|scontent)\./i.test(src)) return;
        if (alt && imageAltRe.test(alt)) return;
        if (width && height && width < 120 && height < 120) return;
        imgSet.add(src);
      };
      const imgs = Array.from(rootNode.querySelectorAll("img")) as any[];
      for (const img of imgs) {
        if (isCommentArea(img)) continue;
        const srcCandidates = [
          img.currentSrc,
          img.src,
          img.getAttribute("src"),
          img.getAttribute("data-src"),
          img.getAttribute("data-original"),
          img.getAttribute("data-imgsrc"),
          img.getAttribute("data-visualcompletion"),
        ]
          .map((item: string) => String(item || "").trim())
          .filter(Boolean);
        const srcSet = String(img.getAttribute("srcset") || "").trim();
        if (srcSet) {
          for (const part of srcSet.split(",")) {
            const candidate = part.trim().split(/\s+/)[0];
            if (candidate) srcCandidates.push(candidate);
          }
        }
        const w = Number(img.naturalWidth || img.width || 0);
        const h = Number(img.naturalHeight || img.height || 0);
        const alt = String(img.getAttribute("alt") || "").trim();
        for (const candidate of srcCandidates) {
          pushImage(candidate, w, h, alt);
        }
        if (imgSet.size >= 12) break;
      }
      if (imgSet.size < 12) {
        const styled = Array.from(rootNode.querySelectorAll('[style*="background-image"]')) as HTMLElement[];
        for (const node of styled) {
          if (isCommentArea(node)) continue;
          const style = String(node.getAttribute("style") || "");
          const match = style.match(/background-image\s*:\s*url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i);
          if (match?.[2]) pushImage(match[2]);
          if (imgSet.size >= 12) break;
        }
      }
    };

    const scoreArticle = (el: any) => {
      const txtLen = (el.innerText || "").trim().length;
      const anchors = getPostLinks(el);
      const hit = targetId ? anchors.some((href: string) => href.includes(String(targetId))) : anchors.length > 0;
      const hasBody = el.querySelector(bodySelector);
      const hasTime = el.querySelector("abbr[title], time[datetime]");
      const hasHeader = el.querySelector("h2 a, h3 a, h4 a, strong a");
      const rectTop = Math.abs(Number(el.getBoundingClientRect?.().top ?? 0));
      return (hit ? 1_000_000 : 0) + (hasBody ? 20_000 : 0) + (hasTime ? 10_000 : 0) + (hasHeader ? 5_000 : 0) + txtLen - rectTop;
    };

    const pickArticle = () => {
      const candidates = Array.from(document.querySelectorAll('[role="article"]')) as any[];
      if (candidates.length) {
        let best = candidates[0];
        let bestScore = scoreArticle(best);
        for (let i = 1; i < candidates.length; i++) {
          const s = scoreArticle(candidates[i]);
          if (s > bestScore) {
            best = candidates[i];
            bestScore = s;
          }
        }
        return best;
      }

      const main = document.querySelector('[role="main"]') as any;
      if (!main) return null;
      const inside = Array.from(main.querySelectorAll("article, div")) as any[];
      if (!inside.length) return null;
      let best = inside[0];
      let bestScore = scoreArticle(best);
      for (let i = 1; i < inside.length; i++) {
        const s = scoreArticle(inside[i]);
        if (s > bestScore) {
          best = inside[i];
          bestScore = s;
        }
      }
      return best;
    };

    const article = pickArticle() as any;
    const root = article || document;
    const lightbox =
      (Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[])
        .filter((dialog) => !isCommentArea(dialog))
        .sort((a, b) => {
          const aArea = Math.max(0, a.clientWidth || 0) * Math.max(0, a.clientHeight || 0);
          const bArea = Math.max(0, b.clientWidth || 0) * Math.max(0, b.clientHeight || 0);
          return bArea - aArea;
        })[0] || null;

    const textFromNode = (node: Element | null) => norm((node as any)?.innerText || (node as any)?.textContent || "");
    const collectBodyNodes = () =>
      (Array.from(root.querySelectorAll(bodySelector)) as Element[])
        .filter((node) => !isCommentArea(node))
        .map((node) => textFromNode(node))
        .filter((text) => text && text.length >= 2);

    const collectFallbackBlocks = () => {
      const blocks: string[] = [];
      const nodes = Array.from(root.querySelectorAll('div[dir="auto"], span[dir="auto"], p')) as Element[];
      let hitBoundary = false;
      for (const node of nodes) {
        const text = textFromNode(node);
        if (!text) continue;
        if (commentBoundaryRe.test(text)) {
          hitBoundary = true;
          continue;
        }
        if (hitBoundary) continue;
        if (isCommentArea(node)) continue;
        if (actionTextRe.test(text)) continue;
        if (text.length < 8 || text.length > 2000) continue;
        if (blocks.includes(text)) continue;
        blocks.push(text);
        if (blocks.length >= 6) break;
      }
      return blocks;
    };

    let contentText = collectBodyNodes().join("\n\n");
    if (!contentText) {
      const fallbackBlocks = collectFallbackBlocks();
      contentText = fallbackBlocks.length ? norm(fallbackBlocks.join("\n")) : "";
    }

    const imgSet = new Set<string>();
    collectImageCandidates(root, imgSet);
    if (lightbox && imgSet.size < 12) {
      collectImageCandidates(lightbox, imgSet);
    }

    const pickTimeRaw = () => {
      const abbr = root.querySelector("abbr[title]") as any;
      if (abbr) return abbr.getAttribute("title") || abbr.textContent || "";
      const time = root.querySelector("time[datetime]") as any;
      if (time) return time.getAttribute("datetime") || time.textContent || "";
      const lightboxTime = lightbox?.querySelector("abbr[title], time[datetime]") as any;
      if (lightboxTime) {
        return (
          lightboxTime.getAttribute?.("datetime") ||
          lightboxTime.getAttribute?.("title") ||
          lightboxTime.textContent ||
          ""
        );
      }
      return "";
    };

    const postCreatedAtRaw = norm(pickTimeRaw());
    const hasImageSignal =
      imgSet.size > 0 ||
      imageOnlyLabelRe.test(textFromNode(root.querySelector('[aria-label*="photo" i], [aria-label*="圖片"], [aria-label*="相片"]')));
    const contentKind = contentText
      ? "text"
      : hasImageSignal
        ? "image_only"
        : "empty";
    const normalizedContentText = contentText || (contentKind === "image_only" ? "[圖片貼文]" : "");

    return {
      content_text: norm(normalizedContentText),
      image_urls: Array.from(imgSet),
      post_created_at_raw: postCreatedAtRaw,
      content_kind: contentKind,
    };
  }, expectedFbPostId);

  const contentText = String((details as any)?.content_text || "").trim();
  const imageUrls = Array.isArray((details as any)?.image_urls) ? (details as any).image_urls.map(String).filter(Boolean) : [];
  const rawTime = String((details as any)?.post_created_at_raw || "").trim();
  const postCreatedAt = parseFacebookTimeToIso(rawTime);
  const contentKind = String((details as any)?.content_kind || "").trim();

  return {
    content_text: contentText || (contentKind === "image_only" ? "[圖片貼文]" : ""),
    image_urls: imageUrls,
    post_created_at: postCreatedAt,
    post_created_at_raw: rawTime || null,
    content_kind: contentKind === "image_only" ? "image_only" : contentText ? "text" : "empty",
  } as ExtractedPostDetails;
}

async function scrapeSingleGroup(
  page: any,
  admin: any,
  group: MonitoredGroup,
  maxPostsPerGroup: number,
  context: GroupExecutionContext,
  updateHeartbeat?: UpdateHeartbeat,
): Promise<GroupProcessResult> {
  const url = buildChronologicalGroupUrl(group.group_url);
  if (!url) {
    throw new Error(`群組網址無效：${getGroupDisplayName(group)}`);
  }

  logGroupInfo(context, group, "OPEN_GROUP", `url=${url}`);
  await updateHeartbeat?.("open_group", `url=${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  if (await detectLoggedOut(page)) {
    throw new Error("FB_LOGIN_REQUIRED");
  }

  await randomDelay();
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await updateHeartbeat?.("before_group_scroll");
  await humanScroll(page, Math.min(1, Math.max(1, SCROLL_PASSES)));
  await updateHeartbeat?.("after_group_scroll");

  const candidates = await extractCandidatePosts(page, maxPostsPerGroup);
  logGroupInfo(context, group, "CANDIDATES_EXTRACTED", `count=${candidates.length}`);
  await updateHeartbeat?.("candidates_extracted", `count=${candidates.length}`);
  const pendingRows: any[] = [];

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const p = candidates[candidateIndex];
    const nowIso = new Date().toISOString();
    const postUrl = normalizeFacebookUrl(p.post_url);
    if (!postUrl) continue;

    await updateHeartbeat?.("before_post_open", `${candidateIndex + 1}/${candidates.length}`);
    await randomDelay(POST_MIN_DELAY_MS, POST_MAX_DELAY_MS);
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await randomHumanPause(180, 420);
    await updateHeartbeat?.("after_post_open", `${candidateIndex + 1}/${candidates.length}`);
    await humanScroll(page, 1);
    await updateHeartbeat?.("after_post_scroll", `${candidateIndex + 1}/${candidates.length}`);
    await expandPostBody(page);
    await updateHeartbeat?.("after_expand_post", `${candidateIndex + 1}/${candidates.length}`);

    const details = await extractPostDetails(page, p.fb_post_id);
    const row: any = {
      source_group_id: group.id,
      fb_post_id: p.fb_post_id,
      post_url: postUrl,
      last_seen_at: nowIso,
      raw_payload: {
        post_url: postUrl,
        scraped_at: nowIso,
        post_created_at_raw: details.post_created_at_raw,
      },
    };

    if (details.post_created_at) row.post_created_at = details.post_created_at;
    row.content_text = details.content_text;
    if (details.image_urls.length) row.image_urls = details.image_urls;
    pendingRows.push(row);
    await updateHeartbeat?.("post_parsed", `${candidateIndex + 1}/${candidates.length}`);
  }

  const { inserted } = await upsertPosts(admin, pendingRows);
  await updateHeartbeat?.("upsert_done", `inserted=${inserted}`);
  logGroupInfo(context, group, "UPSERT_DONE", `candidates=${candidates.length} inserted=${inserted}`);
  return { candidates: candidates.length, upserted: inserted, error: null };
}

async function withFacebookPage<T>(cookies: any[], handler: (page: any) => Promise<T>, options?: WithFacebookPageOptions) {
  const userDataDir = resolveUserDataDir();
  ensureDir(userDataDir);

  const executablePath = await resolveChromeExecutablePath();
  const browser = await puppeteer.launch({
    args: CHROME_PATH ? DEFAULT_PUPPETEER_ARGS : [...chromium.args, ...DEFAULT_PUPPETEER_ARGS],
    executablePath,
    headless: (chromium as unknown as { headless?: boolean }).headless ?? true,
    defaultViewport: (chromium as unknown as { defaultViewport?: { width: number; height: number; deviceScaleFactor?: number } }).defaultViewport,
    userDataDir,
  });
  const timeoutMs = Number(options?.timeoutMs ?? 0) || 0;
  const timeoutMessage = String(options?.timeoutMessage || `FB_PAGE_TIMEOUT:${timeoutMs}`);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  try {
    const run = async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
      await page.setCookie(...cookies);
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
      if (await detectLoggedOut(page)) {
        throw new Error("FB_SESSION_INVALID");
      }
      return await handler(page);
    };

    if (timeoutMs <= 0) {
      return await run();
    }

    return await new Promise<T>((resolve, reject) => {
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        callback();
      };

      timeoutId = setTimeout(() => {
        void browser.close().catch(() => {}).finally(() => {
          settle(() => reject(new Error(timeoutMessage)));
        });
      }, timeoutMs);

      void run()
        .then((result) => {
          settle(() => resolve(result));
        })
        .catch((error) => {
          settle(() => reject(error));
        });
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await browser.close().catch(() => {});
  }
}

async function allowAdminOrCron(req: NextRequest) {
  const guard = await assertAdminServer();
  if (guard.ok) return { ok: true as const, userId: guard.user.id };

  const secret = env("FB_SCRAPER_CRON_SECRET", "");
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  if (secret && headerSecret && headerSecret === secret) return { ok: true as const, userId: null };

  return { ok: false as const, status: guard.status, error: guard.error };
}

async function finalizeScrapeJob(admin: any, job: FbScrapeJobRow, status: Extract<FbScrapeJobStatus, "completed" | "failed">, patch: Record<string, unknown>) {
  const counts = await getFbAiStatusCounts(admin);
  return patchScrapeJob(admin, job.id, {
    status,
    ai_status_counts: counts,
    current_group_id: null,
    current_group_name: null,
    finished_at: new Date().toISOString(),
    ...patch,
  });
}

function getJobReferenceTime(job: FbScrapeJobRow) {
  return job.last_heartbeat_at || job.started_at || job.requested_at || job.updated_at || null;
}

function getTimestampAgeMs(iso: string | null) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Date.now() - parsed;
}

function isJobStale(job: FbScrapeJobRow) {
  if (job.status !== "queued" && job.status !== "running") return false;
  if (job.status === "running" && job.current_group_id) {
    return getTimestampAgeMs(getJobReferenceTime(job)) >= Math.max(STALE_JOB_MS, GROUP_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS * 2);
  }
  return getTimestampAgeMs(getJobReferenceTime(job)) >= STALE_JOB_MS;
}

async function startGroupHeartbeat(
  admin: any,
  job: FbScrapeJobRow,
  group: MonitoredGroup,
  context: GroupExecutionContext,
  totalGroups: number,
) {
  let stopped = false;
  let inFlight = false;
  const tick = async (phase = "interval", detail?: string) => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await patchScrapeJob(admin, job.id, {
        last_heartbeat_at: new Date().toISOString(),
        last_message: `背景同步進行中：正在處理第 ${context.groupIndex}/${totalGroups} 個群組「${getGroupDisplayName(group)}」${
          detail ? ` (${detail})` : ""
        }`,
      });
      logGroupInfo(context, group, "HEARTBEAT", `phase=${phase}${detail ? ` detail=${detail}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "unknown_error");
      logGroupWarn(context, group, "HEARTBEAT_FAILED", message);
    } finally {
      inFlight = false;
    }
  };
  const intervalId = setInterval(() => {
    void tick("interval", `interval=${HEARTBEAT_INTERVAL_MS}ms`);
  }, HEARTBEAT_INTERVAL_MS);

  return {
    updateHeartbeat: async (phase: string, detail?: string) => {
      await tick(phase, detail);
    },
    stopHeartbeat: async () => {
    stopped = true;
    clearInterval(intervalId);
    if (!inFlight) return;
    await sleep(50);
    },
  };
}

function didJobMovePastGroup(job: FbScrapeJobRow | null, groupIndex: number, groupId: string) {
  if (!job) return true;
  if (job.status === "completed" || job.status === "failed") return true;
  if (job.next_group_index !== groupIndex) return true;
  if (job.current_group_id && String(job.current_group_id) !== String(groupId)) return true;
  return false;
}

async function scheduleScrapeJobWorker(req: NextRequest, job: FbScrapeJobRow) {
  after(async () => {
    await triggerScrapeJobWorker(req.nextUrl.origin, job.id, job.job_token);
  });
}

async function recoverStaleScrapeJob(req: NextRequest, admin: any, job: FbScrapeJobRow, targetGroups: MonitoredGroup[]) {
  if (!isJobStale(job)) return job;

  const staleMs = getTimestampAgeMs(getJobReferenceTime(job));
  if (job.status === "queued") {
    console.warn(`[FB Scrape Job ${job.id}] Watchdog detected stale queued job | age=${staleMs}ms`);
    const restarted = await patchScrapeJob(admin, job.id, {
      last_message: `背景同步 watchdog 偵測到 worker 未啟動（>${STALE_JOB_MS}ms），正在重新觸發。`,
      last_error: `queued worker stale for ${staleMs}ms`,
      current_group_id: null,
      current_group_name: null,
      last_heartbeat_at: new Date().toISOString(),
    });
    await scheduleScrapeJobWorker(req, restarted);
    return restarted;
  }

  const currentGroup = targetGroups[job.next_group_index] ?? null;
  const currentGroupName = currentGroup?.group_name || job.current_group_name || currentGroup?.id || job.current_group_id || `index_${job.next_group_index + 1}`;
  console.warn(`[FB Scrape Job ${job.id}] Watchdog skipping stale group | group=${currentGroupName} age=${staleMs}ms`);
  const counts = await getFbAiStatusCounts(admin);
  const nextGroupIndex = Math.min(job.next_group_index + 1, targetGroups.length);
  const processedGroups = Math.min(job.processed_groups + 1, targetGroups.length);
  const hasMore = nextGroupIndex < targetGroups.length;
  const nextGroup = hasMore ? targetGroups[nextGroupIndex] : null;
  const reason = classifyGroupSkipReason("", "watchdog");
  const skipMessage = formatGroupSkipReason(reason);
  console.warn(
    `[FB Scrape Job ${job.id}] Watchdog skip reason | group=${currentGroupName} code=${reason.code} detail=${reason.detail} age=${staleMs}ms`,
  );
  const updated = await patchScrapeJob(admin, job.id, {
    status: hasMore ? "running" : "completed",
    processed_groups: processedGroups,
    next_group_index: nextGroupIndex,
    group_errors: [...job.group_errors, `${currentGroupName}：${skipMessage}`].slice(-50),
    ai_status_counts: counts,
    current_group_id: nextGroup?.id ?? null,
    current_group_name: nextGroup?.group_name ?? null,
    last_error: `${currentGroupName}：${skipMessage}`,
    last_heartbeat_at: new Date().toISOString(),
    finished_at: hasMore ? null : new Date().toISOString(),
    last_message: hasMore
      ? `背景同步 watchdog 已略過群組「${currentGroupName}」（${reason.code}），並繼續處理第 ${nextGroupIndex + 1}/${targetGroups.length} 個群組。`
      : `背景同步完成，但 watchdog 已略過最後一個卡住的群組（${reason.code}）。${formatFbAiStatusCounts(counts)}`,
  });
  if (hasMore) {
    await scheduleScrapeJobWorker(req, updated);
  }
  return updated;
}

async function handleScrapeJobWorker(req: NextRequest, jobId: string, jobToken: string) {
  const admin = supabaseAdmin();
  const existingJob = await getScrapeJobById(admin, jobId);
  if (!existingJob) return NextResponse.json({ error: "找不到 Facebook 同步工作。" }, { status: 404 });
  if (existingJob.job_token !== jobToken) {
    return NextResponse.json({ error: "Facebook 同步工作驗證失敗。" }, { status: 401 });
  }
  if (existingJob.status === "completed" || existingJob.status === "failed") {
    return NextResponse.json({ ok: true, job: serializeScrapeJob(existingJob) });
  }

  const groups = await listActiveGroups(admin);
  const jobOffset = getJobGroupOffset(existingJob);
  const batchGroups = existingJob.max_groups > 0 ? groups.slice(jobOffset, jobOffset + existingJob.max_groups) : groups.slice(jobOffset);
  const targetGroups = batchGroups;
  let job = await recoverStaleScrapeJob(req, admin, existingJob, targetGroups);
  if (job.total_groups !== targetGroups.length) {
    job = await patchScrapeJob(admin, job.id, { total_groups: targetGroups.length });
  }

  if (!targetGroups.length) {
    const completed = await finalizeScrapeJob(admin, job, "completed", {
      mode: "live",
      last_message: "目前沒有啟用中的 Facebook 監控群組。",
    });
    return NextResponse.json({ ok: true, job: serializeScrapeJob(completed) });
  }

  if (job.next_group_index >= targetGroups.length) {
    const completed = await finalizeScrapeJob(admin, job, "completed", {
      last_message: `背景同步已完成。${formatFbAiStatusCounts(job.ai_status_counts || (await getFbAiStatusCounts(admin)))}`,
    });
    return NextResponse.json({ ok: true, job: serializeScrapeJob(completed) });
  }

  const cookies = loadCookies();
  if (!cookies) {
    if (isDevMockEnabled()) {
      const summary = await runMockSync(admin, job.max_groups);
      const completed = await finalizeScrapeJob(admin, job, "completed", {
        mode: "mock",
        total_groups: summary.groups,
        processed_groups: summary.groups,
        next_group_index: summary.groups,
        candidates: summary.candidates,
        upserted: summary.upserted,
        last_message: summary.message,
      });
      return NextResponse.json({ ok: true, job: serializeScrapeJob(completed) });
    }
    const failed = await finalizeScrapeJob(admin, job, "failed", {
      last_error: `缺少 Facebook session。請優先設定 FB_COOKIES_JSON；本機開發亦可使用 cookies 檔案：${COOKIES_PATH}（請先跑一次：npm run fb:init-session）`,
      last_message: "背景同步失敗：未設定有效 Facebook session。",
    });
    return NextResponse.json({ ok: true, job: serializeScrapeJob(failed) });
  }

  const group = targetGroups[job.next_group_index];
  const groupContext: GroupExecutionContext = {
    jobId: job.id,
    groupIndex: job.next_group_index + 1,
    totalGroups: targetGroups.length,
  };
  const maxPostsPerGroup = clamp(job.max_posts_per_group, 1, 30);
  const groupStartedAt = Date.now();
  const nowIso = new Date().toISOString();
  job = await patchScrapeJob(admin, job.id, {
    status: "running",
    mode: "live",
    started_at: job.started_at || nowIso,
    last_heartbeat_at: nowIso,
    current_group_id: group.id,
    current_group_name: group.group_name,
    last_message: `背景同步進行中：正在處理第 ${job.next_group_index + 1}/${targetGroups.length} 個群組「${group.group_name}」`,
  });
  logGroupInfo(groupContext, group, "START", `timeout=${GROUP_TIMEOUT_MS}ms maxPosts=${maxPostsPerGroup}`);
  const { updateHeartbeat, stopHeartbeat } = await startGroupHeartbeat(admin, job, group, groupContext, targetGroups.length);

  try {
    const result = await withFacebookPage(cookies, async (page) =>
      scrapeSingleGroup(page, admin, group, maxPostsPerGroup, groupContext, updateHeartbeat),
      {
        timeoutMs: GROUP_TIMEOUT_MS,
        timeoutMessage: createGroupTimeoutMessage(group, GROUP_TIMEOUT_MS),
      },
    );
    logGroupInfo(
      groupContext,
      group,
      "SUCCESS",
      `duration=${Date.now() - groupStartedAt}ms candidates=${result.candidates} upserted=${result.upserted}`,
    );
    const writableJob = await getScrapeJobById(admin, job.id);
    if (didJobMovePastGroup(writableJob, job.next_group_index, group.id)) {
      logGroupWarn(groupContext, group, "STALE_RESULT_IGNORED", "watchdog 已接手或工作已前進，略過舊 worker 寫回");
      return NextResponse.json({ ok: true, job: writableJob ? serializeScrapeJob(writableJob) : null });
    }
    if (!writableJob) {
      return NextResponse.json({ ok: true, job: null });
    }
    const counts = await getFbAiStatusCounts(admin);
    const nextGroupIndex = job.next_group_index + 1;
    const processedGroups = job.processed_groups + 1;
    const hasMore = nextGroupIndex < targetGroups.length;
    const nextGroup = hasMore ? targetGroups[nextGroupIndex] : null;
    const updated = await patchScrapeJob(admin, writableJob.id, {
      status: hasMore ? "running" : "completed",
      processed_groups: processedGroups,
      next_group_index: nextGroupIndex,
      candidates: writableJob.candidates + result.candidates,
      upserted: writableJob.upserted + result.upserted,
      ai_status_counts: counts,
      current_group_id: nextGroup?.id ?? null,
      current_group_name: nextGroup?.group_name ?? null,
      last_error: null,
      last_heartbeat_at: new Date().toISOString(),
      finished_at: hasMore ? null : new Date().toISOString(),
      last_message: hasMore
        ? `背景同步進行中：已完成 ${processedGroups}/${targetGroups.length} 個群組，累計寫入 ${writableJob.upserted + result.upserted} 筆貼文`
        : `背景同步完成：共完成 ${processedGroups} 個群組，寫入 ${writableJob.upserted + result.upserted} 筆貼文。${formatFbAiStatusCounts(counts)}`,
    });

    if (hasMore) {
      await scheduleScrapeJobWorker(req, updated);
    } else if (jobOffset + targetGroups.length < groups.length) {
      const nextBatch = await enqueueNextScrapeJobBatch(req, admin, updated, groups, jobOffset + targetGroups.length);
      if (nextBatch) {
        await patchScrapeJob(admin, updated.id, {
          last_message: `背景同步完成本批 ${targetGroups.length} 個群組，下一批已排入佇列（第 ${jobOffset + targetGroups.length + 1}/${groups.length} 個群組開始）。`,
        });
      }
    }

    return NextResponse.json({ ok: true, job: serializeScrapeJob(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    const isGroupTimeout = isGroupTimeoutMessage(message);
    const reason = classifyGroupSkipReason(message, "worker");
    if (isGroupTimeout) {
      logGroupWarn(groupContext, group, "TIMEOUT", `duration=${Date.now() - groupStartedAt}ms timeout=${GROUP_TIMEOUT_MS}ms`);
    } else {
      logGroupError(groupContext, group, "FAILED", `duration=${Date.now() - groupStartedAt}ms error=${message}`);
    }
    logGroupWarn(
      groupContext,
      group,
      "SKIP_REASON",
      `code=${reason.code} detail=${reason.detail} duration=${Date.now() - groupStartedAt}ms`,
    );
    if ((message === "FB_SESSION_INVALID" || message === "FB_LOGIN_REQUIRED") && isDevMockEnabled()) {
      const summary = await runMockSync(admin, job.max_groups);
      const completed = await finalizeScrapeJob(admin, job, "completed", {
        mode: "mock",
        total_groups: summary.groups,
        processed_groups: summary.groups,
        next_group_index: summary.groups,
        candidates: summary.candidates,
        upserted: summary.upserted,
        last_message: "Facebook cookies 已失效，本地開發環境已自動改用 Mock 同步。",
      });
      return NextResponse.json({ ok: true, job: serializeScrapeJob(completed) });
    }

    if (message === "FB_SESSION_INVALID" || message === "FB_LOGIN_REQUIRED") {
      const failed = await finalizeScrapeJob(admin, job, "failed", {
        last_error: "Facebook cookies 似乎已失效或需要重新驗證（請重新跑：npm run fb:init-session）",
        last_message: "背景同步失敗：Facebook session 已失效。",
      });
      return NextResponse.json({ ok: true, job: serializeScrapeJob(failed) });
    }

    const writableJob = await getScrapeJobById(admin, job.id);
    if (didJobMovePastGroup(writableJob, job.next_group_index, group.id)) {
      logGroupWarn(groupContext, group, "STALE_ERROR_IGNORED", "watchdog 已接手或工作已前進，略過舊 worker 失敗寫回");
      return NextResponse.json({ ok: true, job: writableJob ? serializeScrapeJob(writableJob) : null });
    }
    if (!writableJob) {
      return NextResponse.json({ ok: true, job: null });
    }
    const counts = await getFbAiStatusCounts(admin);
    const skipMessage = formatGroupSkipReason(reason);
    const groupErrors = [...writableJob.group_errors, `${group.group_name || group.id}：${skipMessage}`].slice(-50);
    const nextGroupIndex = writableJob.next_group_index + 1;
    const processedGroups = writableJob.processed_groups + 1;
    const hasMore = nextGroupIndex < targetGroups.length;
    const nextGroup = hasMore ? targetGroups[nextGroupIndex] : null;
    const updated = await patchScrapeJob(admin, writableJob.id, {
      status: hasMore ? "running" : "completed",
      processed_groups: processedGroups,
      next_group_index: nextGroupIndex,
      group_errors: groupErrors,
      ai_status_counts: counts,
      current_group_id: nextGroup?.id ?? null,
      current_group_name: nextGroup?.group_name ?? null,
      last_error: skipMessage,
      last_heartbeat_at: new Date().toISOString(),
      finished_at: hasMore ? null : new Date().toISOString(),
      last_message: hasMore
        ? `背景同步略過群組「${getGroupDisplayName(group)}」（${reason.code}）後繼續：已完成 ${processedGroups}/${targetGroups.length} 個群組`
        : `背景同步完成，但有 ${groupErrors.length} 個群組失敗。最後一個 skip 原因：${reason.code}。${formatFbAiStatusCounts(counts)}`,
    });
    if (hasMore) {
      await scheduleScrapeJobWorker(req, updated);
    } else if (jobOffset + targetGroups.length < groups.length) {
      const nextBatch = await enqueueNextScrapeJobBatch(req, admin, updated, groups, jobOffset + targetGroups.length);
      if (nextBatch) {
        await patchScrapeJob(admin, updated.id, {
          last_message: `背景同步本批已結束，下一批已排入佇列（第 ${jobOffset + targetGroups.length + 1}/${groups.length} 個群組開始）。`,
        });
      }
    }
    return NextResponse.json({ ok: true, job: serializeScrapeJob(updated) });
  } finally {
    await stopHeartbeat();
  }
}

export async function GET(req: NextRequest) {
  try {
    const allowed = await allowAdminOrCron(req);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    const admin = supabaseAdmin();
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const rawJob = jobId
      ? await getScrapeJobById(admin, jobId)
      : (await getLatestScrapeJob(admin, true)) || (await getLatestScrapeJob(admin, false));
    if (!rawJob) {
      return NextResponse.json({ ok: true, job: null });
    }
    const groups = await listActiveGroups(admin);
    const targetGroups = rawJob.max_groups > 0 ? groups.slice(0, rawJob.max_groups) : groups;
    const job = await recoverStaleScrapeJob(req, admin, rawJob, targetGroups);

    return NextResponse.json({ ok: true, job: job ? serializeScrapeJob(job) : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const workerJobId = String(req.headers.get(WORKER_JOB_ID_HEADER) || "").trim();
    const workerJobToken = String(req.headers.get(WORKER_JOB_TOKEN_HEADER) || "").trim();
    if (workerJobId && workerJobToken) {
      return await handleScrapeJobWorker(req, workerJobId, workerJobToken);
    }

    const allowed = await allowAdminOrCron(req);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    let body: ScrapeBody = {};
    try {
      body = (await req.json()) as ScrapeBody;
    } catch {}

    const maxPostsPerGroup = clamp(
      Number.isFinite(Number(body.maxPostsPerGroup)) ? Number(body.maxPostsPerGroup) : DEFAULT_MAX_POSTS_PER_GROUP,
      1,
      30,
    );
    const maxGroups = clamp(Number.isFinite(Number(body.maxGroups)) ? Number(body.maxGroups) : DEFAULT_MAX_GROUPS_PER_RUN, 0, 50);

    const admin = supabaseAdmin();
    const activeJob = await getLatestScrapeJob(admin, true);
    if (activeJob) {
      const groups = await listActiveGroups(admin);
      const jobOffset = getJobGroupOffset(activeJob);
      const targetGroups = activeJob.max_groups > 0 ? groups.slice(jobOffset, jobOffset + activeJob.max_groups) : groups.slice(jobOffset);
      const recoveredJob = await recoverStaleScrapeJob(req, admin, activeJob, targetGroups);
      return NextResponse.json({
        ok: true,
        accepted: true,
        job: serializeScrapeJob(recoveredJob),
        message: recoveredJob.last_message || "已有 Facebook 背景同步工作正在執行。",
      });
    }

    const cookies = loadCookies();
    if (!cookies && !isDevMockEnabled()) {
      return NextResponse.json(
        {
          error: `缺少 Facebook session。請優先設定 FB_COOKIES_JSON；本機開發亦可使用 cookies 檔案：${COOKIES_PATH}（請先跑一次：npm run fb:init-session）`,
          detail: "本地若想先避開真實 FB session，可在 development 使用 FB_SCRAPER_ENABLE_DEV_MOCK=1。",
          code: "MISSING_FB_COOKIES",
        },
        { status: 400 },
      );
    }

    const groups = await listActiveGroups(admin);
    const requestedMaxGroups = maxGroups > 0 ? maxGroups : groups.length;
    const boundedMaxGroups = clamp(requestedMaxGroups, 1, Math.max(1, JOB_GROUP_BATCH_SIZE));
    const targetGroups = groups.slice(0, boundedMaxGroups);
    const counts = await getFbAiStatusCounts(admin);
    const nowIso = new Date().toISOString();
    const job = await createScrapeJob(admin, {
      requested_by_user_id: allowed.userId,
      job_token: buildJobToken(Number.isFinite(Number(body.startIndex)) ? Number(body.startIndex) : 0),
      status: targetGroups.length ? "queued" : "completed",
      mode: isDevMockEnabled() && !cookies ? "mock" : "live",
      max_groups: targetGroups.length,
      max_posts_per_group: maxPostsPerGroup,
      total_groups: targetGroups.length,
      next_group_index: 0,
      processed_groups: 0,
      candidates: 0,
      upserted: 0,
      group_errors: [],
      ai_status_counts: counts,
      current_group_id: null,
      current_group_name: null,
      last_message: targetGroups.length
        ? `Facebook 背景同步已啟動，準備處理本批 ${targetGroups.length} 個群組（每批最多 ${JOB_GROUP_BATCH_SIZE} 個）。`
        : "目前沒有啟用中的 Facebook 監控群組。",
      last_error: null,
      finished_at: targetGroups.length ? null : nowIso,
      last_heartbeat_at: targetGroups.length ? null : nowIso,
    });

    if (targetGroups.length) {
      await scheduleScrapeJobWorker(req, job);
    }

    return NextResponse.json({
      ok: true,
      accepted: true,
      job: serializeScrapeJob(job),
      message: job.last_message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
