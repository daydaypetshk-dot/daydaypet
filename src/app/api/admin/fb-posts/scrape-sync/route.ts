export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import fs from "node:fs";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ScrapeBody = {
  maxGroups?: number;
  maxPostsPerGroup?: number;
};

type MonitoredGroup = { id: string; group_name: string; group_url: string };
type ScrapeSummary = {
  ok: true;
  mode: "live" | "mock";
  groups: number;
  candidates: number;
  upserted: number;
  message?: string;
};

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
const USER_DATA_DIR = env("FB_USER_DATA_DIR", path.join(process.cwd(), ".secrets", "fb-chrome-profile"));
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

async function randomDelay() {
  const min = Math.min(MIN_DELAY_MS, MAX_DELAY_MS);
  const max = Math.max(MIN_DELAY_MS, MAX_DELAY_MS);
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
    .filter((row: MonitoredGroup) => row.id && row.group_url);
}

async function upsertPosts(admin: any, rows: any[]) {
  if (!rows.length) return { inserted: 0 };
  const { error } = await admin.from("fb_group_posts").upsert(rows, { onConflict: "source_group_id,fb_post_id" });
  if (error) throw new Error(error.message);
  return { inserted: rows.length };
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
  return {
    ok: true,
    mode: "mock",
    groups: targetGroups.length,
    candidates: rows.length,
    upserted: rows.length,
    message: "本地開發環境已使用 Mock 同步資料。",
  };
}

async function extractCandidatePosts(page: any, maxPostsPerGroup: number) {
  const raw = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a"))
      .map((a) => a.getAttribute("href") || "")
      .filter(Boolean);
    return anchors.slice(0, 2000);
  });

  const urls = new Set<string>();
  for (const href of raw as string[]) {
    if (!href) continue;
    if (!href.includes("/posts/") && !href.includes("story_fbid=") && !href.includes("permalink.php") && !href.includes("/permalink/")) {
      continue;
    }
    const normalized = normalizeFacebookUrl(href);
    if (!normalized) continue;
    if (!normalized.includes("facebook.com")) continue;
    urls.add(normalized);
    if (urls.size >= maxPostsPerGroup * 3) break;
  }

  const list = Array.from(urls)
    .map((post_url) => ({
      fb_post_id: parseFbPostId(post_url),
      post_url,
    }))
    .filter((p) => p.fb_post_id && p.post_url);

  const seen = new Set<string>();
  const deduped: Array<{ fb_post_id: string; post_url: string }> = [];
  for (const item of list) {
    const key = `${item.fb_post_id}:${item.post_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= maxPostsPerGroup) break;
  }

  return deduped;
}

async function extractPostDetails(page: any, expectedFbPostId: string) {
  const details = await page.evaluate((targetId: string) => {
    const norm = (t: any) => String(t || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    const scoreArticle = (el: any) => {
      const txtLen = (el.innerText || "").trim().length;
      if (!targetId) return txtLen;
      const anchors = Array.from(el.querySelectorAll("a[href]")).map((a: any) => a.getAttribute("href") || "");
      const hit = anchors.some((href: string) => href.includes(String(targetId)));
      return (hit ? 1_000_000 : 0) + txtLen;
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

    const textBlocks: string[] = [];
    const msgSelectors = ['[data-ad-preview="message"]', '[data-ad-comet-preview="message"]'];
    for (const sel of msgSelectors) {
      const nodes = Array.from((article || document).querySelectorAll(sel)) as any[];
      for (const n of nodes) {
        const t = norm(n.innerText || n.textContent || "");
        if (t && t.length >= 2) textBlocks.push(t);
      }
      if (textBlocks.length) break;
    }

    let contentText = textBlocks.join("\n\n");
    if (!contentText) {
      const pool = Array.from((article || document).querySelectorAll('div[dir="auto"], span[dir="auto"]'))
        .map((n: any) => norm(n.innerText || n.textContent || ""))
        .filter((t: string) => t && t.length >= 8 && t.length <= 2000);
      const merged = pool.slice(0, 8).join("\n");
      contentText = norm(merged);
    }

    const imgSet = new Set<string>();
    const imgs = Array.from((article || document).querySelectorAll("img")) as any[];
    for (const img of imgs) {
      const src =
        img.currentSrc ||
        img.src ||
        img.getAttribute("src") ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-original") ||
        "";
      if (!src) continue;
      if (src.startsWith("data:") || src.startsWith("blob:")) continue;
      if (!/(fbcdn|scontent)\./i.test(src)) continue;
      const w = Number(img.naturalWidth || 0);
      const h = Number(img.naturalHeight || 0);
      if (w && h && w < 200 && h < 200) continue;
      imgSet.add(src);
      if (imgSet.size >= 12) break;
    }

    const pickTimeRaw = () => {
      const root = article || document;
      const abbr = root.querySelector("abbr[title]") as any;
      if (abbr) return abbr.getAttribute("title") || abbr.textContent || "";
      const time = root.querySelector("time[datetime]") as any;
      if (time) return time.getAttribute("datetime") || time.textContent || "";
      return "";
    };

    const postCreatedAtRaw = norm(pickTimeRaw());

    return {
      content_text: norm(contentText),
      image_urls: Array.from(imgSet),
      post_created_at_raw: postCreatedAtRaw,
    };
  }, expectedFbPostId);

  const contentText = String((details as any)?.content_text || "").trim();
  const imageUrls = Array.isArray((details as any)?.image_urls) ? (details as any).image_urls.map(String).filter(Boolean) : [];
  const rawTime = String((details as any)?.post_created_at_raw || "").trim();
  const postCreatedAt = parseFacebookTimeToIso(rawTime);

  return {
    content_text: contentText || null,
    image_urls: imageUrls,
    post_created_at: postCreatedAt,
    post_created_at_raw: rawTime || null,
  };
}

async function allowAdminOrCron(req: NextRequest) {
  const guard = await assertAdminServer();
  if (guard.ok) return { ok: true as const };

  const secret = env("FB_SCRAPER_CRON_SECRET", "");
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  if (secret && headerSecret && headerSecret === secret) return { ok: true as const };

  return { ok: false as const, status: guard.status, error: guard.error };
}

export async function POST(req: NextRequest) {
  try {
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
    const maxGroups = clamp(
      Number.isFinite(Number(body.maxGroups)) ? Number(body.maxGroups) : DEFAULT_MAX_GROUPS_PER_RUN,
      0,
      50,
    );

    const admin = supabaseAdmin();
    const cookies = loadCookies();
    if (!cookies) {
      if (isDevMockEnabled()) {
        const mock = await runMockSync(admin, maxGroups);
        return NextResponse.json(mock);
      }
      return NextResponse.json(
        {
          error: `缺少 Facebook session。請優先設定 FB_COOKIES_JSON；本機開發亦可使用 cookies 檔案：${COOKIES_PATH}（請先跑一次：npm run fb:init-session）`,
          detail: "本地若想先避開真實 FB session，可在 development 使用 FB_SCRAPER_ENABLE_DEV_MOCK=1。",
          code: "MISSING_FB_COOKIES",
        },
        { status: 400 },
      );
    }

    ensureDir(USER_DATA_DIR);

    const groups = await listActiveGroups(admin);
    const targetGroups = maxGroups && maxGroups > 0 ? groups.slice(0, maxGroups) : groups;
    if (!targetGroups.length) {
      return NextResponse.json({
        ok: true,
        mode: "live",
        groups: 0,
        candidates: 0,
        upserted: 0,
        message: "目前沒有啟用中的 Facebook 監控群組。",
      } satisfies ScrapeSummary);
    }

    const executablePath = await resolveChromeExecutablePath();
    const browser = await puppeteer.launch({
      args: CHROME_PATH
        ? DEFAULT_PUPPETEER_ARGS
        : [...chromium.args, ...DEFAULT_PUPPETEER_ARGS],
      executablePath,
      headless: (chromium as unknown as { headless?: boolean }).headless ?? true,
      defaultViewport: (chromium as unknown as { defaultViewport?: { width: number; height: number; deviceScaleFactor?: number } })
        .defaultViewport,
      userDataDir: USER_DATA_DIR,
    });

    let totalGroups = 0;
    let totalCandidates = 0;
    let totalUpserted = 0;
    const groupErrors: string[] = [];

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
      await page.setCookie(...cookies);
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
      if (await detectLoggedOut(page)) {
        if (isDevMockEnabled()) {
          await browser.close().catch(() => {});
          const mock = await runMockSync(admin, maxGroups);
          return NextResponse.json({
            ...mock,
            message: "Facebook cookies 已失效，本地開發環境已自動改用 Mock 同步。",
          });
        }
        return NextResponse.json(
          {
            error: "Facebook cookies 似乎已失效或需要重新驗證（請重新跑：npm run fb:init-session）",
            code: "FB_SESSION_INVALID",
          },
          { status: 400 },
        );
      }

      for (const group of targetGroups) {
        totalGroups += 1;
        const url = normalizeGroupUrl(group.group_url);
        if (!url) {
          groupErrors.push(`群組網址無效：${group.group_name || group.id}`);
          continue;
        }

        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          if (await detectLoggedOut(page)) {
            if (isDevMockEnabled()) {
              const mock = await runMockSync(admin, maxGroups);
              return NextResponse.json({
                ...mock,
                message: "同步途中偵測到登入失效，本地開發環境已自動切換為 Mock 同步。",
              });
            }
            return NextResponse.json(
              {
                error: "偵測到未登入狀態（cookies 可能失效 / FB 要求 checkpoint）",
                code: "FB_LOGIN_REQUIRED",
              },
              { status: 400 },
            );
          }

          await randomDelay();
          await humanScroll(page);

          const candidates = await extractCandidatePosts(page, maxPostsPerGroup);
          totalCandidates += candidates.length;

          for (const p of candidates) {
            const nowIso = new Date().toISOString();
            const postUrl = normalizeFacebookUrl(p.post_url);
            if (!postUrl) continue;

            await randomDelay();
            await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
            await randomHumanPause(600, 1400);
            await humanScroll(page, randInt(2, 5));

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
            if (details.content_text && details.content_text.length >= 2) row.content_text = details.content_text;
            if (details.image_urls.length) row.image_urls = details.image_urls;

            await upsertPosts(admin, [row]);
            totalUpserted += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "unknown_error");
          groupErrors.push(`${group.group_name || group.id}：${message}`);
          await sleep(Math.max(5000, MAX_DELAY_MS * 2));
        }

        await randomDelay();
      }
    } finally {
      await browser.close().catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      mode: "live",
      groups: totalGroups,
      candidates: totalCandidates,
      upserted: totalUpserted,
      message: groupErrors.length ? `部分群組同步失敗：${groupErrors.join(" | ")}` : "同步成功",
    } satisfies ScrapeSummary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
