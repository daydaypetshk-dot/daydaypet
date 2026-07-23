import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import chromium from "@sparticuz/chromium";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";

const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}

const env = (key, fallback = "") => {
  const v = String(process.env[key] ?? "").trim();
  return v || fallback;
};

const envNum = (key, fallback) => {
  const raw = String(process.env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const COOKIES_PATH = env(
  "FB_COOKIES_PATH",
  path.join(process.cwd(), ".secrets", "fb-cookies.json"),
);
const COOKIES_JSON = env("FB_COOKIES_JSON", "");
const USER_DATA_DIR = env(
  "FB_USER_DATA_DIR",
  path.join(process.cwd(), ".secrets", "fb-chrome-profile"),
);
const CHROME_PATH = env("FB_CHROME_PATH", "");

const MAX_POSTS_PER_GROUP = envNum("FB_SCRAPER_MAX_POSTS_PER_GROUP", 12);
const MAX_GROUPS_PER_RUN = envNum("FB_SCRAPER_MAX_GROUPS_PER_RUN", 0);
const MIN_DELAY_MS = envNum("FB_SCRAPER_MIN_DELAY_MS", 1600);
const MAX_DELAY_MS = envNum("FB_SCRAPER_MAX_DELAY_MS", 4200);
const LOOP_INTERVAL_MS = envNum("FB_SCRAPER_LOOP_INTERVAL_MS", 10 * 60 * 1000);
const SCROLL_PASSES = envNum("FB_SCRAPER_SCROLL_PASSES", 6);
const NAV_TIMEOUT_MS = envNum("FB_SCRAPER_NAV_TIMEOUT_MS", 45_000);

const DEFAULT_PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
];

const buildChromeArgs = (extra = []) =>
  process.env.VERCEL ? [...chromium.args, "--disable-extensions", ...extra] : [...DEFAULT_PUPPETEER_ARGS, ...extra];

const resolveChromeExecutablePath = async () => CHROME_PATH || (await chromium.executablePath());

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

const randInt = (min, max) => {
  const a = Math.floor(min);
  const b = Math.floor(max);
  if (a === b) return a;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
};

const randomHumanPause = async (minMs = 350, maxMs = 1100) => {
  const ms = randInt(minMs, maxMs);
  await sleep(ms);
};

const randomDelay = async () => {
  const min = Math.min(MIN_DELAY_MS, MAX_DELAY_MS);
  const max = Math.max(MIN_DELAY_MS, MAX_DELAY_MS);
  const jitter = min + Math.floor(Math.random() * Math.max(1, max - min));
  await sleep(jitter);
};

async function humanMouseJitter(page) {
  try {
    const viewport = page.viewport();
    const w = viewport?.width ?? 1200;
    const h = viewport?.height ?? 800;
    const x = randInt(40, Math.max(40, w - 40));
    const y = randInt(40, Math.max(40, h - 40));
    await page.mouse.move(x, y, { steps: randInt(5, 18) });
  } catch {}
}

async function humanScroll(page, passes = SCROLL_PASSES) {
  const n = clamp(passes || 0, 0, 30);
  for (let i = 0; i < n; i++) {
    await humanMouseJitter(page);
    await randomHumanPause(200, 700);
    await page.evaluate((y) => window.scrollBy(0, y), randInt(450, 1100));
    await randomHumanPause(650, 1600);
    if (Math.random() < 0.18) {
      await page.evaluate((y) => window.scrollBy(0, y), -randInt(120, 360));
      await randomHumanPause(350, 900);
    }
  }
}

const waitForEnter = async (prompt) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
};

const parseCookieArray = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const loadCookies = () => {
  if (COOKIES_JSON) {
    const direct = parseCookieArray(COOKIES_JSON);
    if (direct) return direct;

    try {
      const decoded = Buffer.from(COOKIES_JSON, "base64").toString("utf8");
      const decodedParsed = parseCookieArray(decoded);
      if (decodedParsed) return decodedParsed;
    } catch {}
  }

  const target = COOKIES_PATH;
  if (!fs.existsSync(target)) return null;
  try {
    const raw = fs.readFileSync(target, "utf8");
    return parseCookieArray(raw);
  } catch {
    return null;
  }
};

const saveCookies = (cookies) => {
  ensureDir(path.dirname(COOKIES_PATH));
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2), "utf8");
};

const isValidUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );

const normalizeFacebookUrl = (input) => {
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
};

const parseFbPostId = (postUrl) => {
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
};

const isProbablyFacebookUrl = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return false;
  if (raw.startsWith("/")) return true;
  try {
    const url = new URL(raw);
    return /(^|\.)facebook\.com$/i.test(url.hostname) || /(^|\.)fb\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
};

const normalizeGroupUrl = (input) => {
  const url = normalizeFacebookUrl(input);
  if (!url) return "";
  if (!isProbablyFacebookUrl(url)) return "";
  return url;
};

const buildChronologicalGroupUrl = (input) => {
  const normalized = normalizeGroupUrl(input);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    return url.toString();
  } catch {
    return normalized;
  }
};

function parseFacebookTimeToIso(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();

  const zh = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:[^\d]*(上午|下午)?\s*(\d{1,2})\s*:\s*(\d{2}))?/);
  if (zh) {
    const y = Number(zh[1]);
    const mo = Number(zh[2]);
    const d = Number(zh[3]);
    const ampm = zh[4] || "";
    let hh = zh[5] ? Number(zh[5]) : 0;
    const mm = zh[6] ? Number(zh[6]) : 0;
    if (ampm === "下午" && hh < 12) hh += 12;
    if (ampm === "上午" && hh === 12) hh = 0;
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`;
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return null;
}

async function detectLoggedOut(page) {
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

async function initSession() {
  ensureDir(path.dirname(COOKIES_PATH));
  ensureDir(USER_DATA_DIR);

  if (!CHROME_PATH) {
    throw new Error("init-session 需要本機 Chrome。請設定 FB_CHROME_PATH 後再執行。");
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: await resolveChromeExecutablePath(),
    userDataDir: USER_DATA_DIR,
    args: buildChromeArgs(),
  });

  try {
    const page = await browser.newPage();
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
    await waitForEnter("請在瀏覽器完成 Facebook 登入後回到此終端，按 Enter 以儲存 cookies：");
    const cookies = await page.cookies();
    saveCookies(cookies);
    console.log(`已儲存 cookies：${COOKIES_PATH}`);
  } finally {
    await browser.close();
  }
}

async function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listActiveGroups(admin) {
  const { data, error } = await admin
    .from("fb_monitored_groups")
    .select("id,group_name,group_url,is_active,created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => ({
      id: String(row.id || "").trim(),
      group_name: String(row.group_name || "").trim(),
      group_url: String(row.group_url || "").trim(),
    }))
    .filter((row) => isValidUuid(row.id) && row.group_url);
}

async function upsertPosts(admin, rows) {
  if (!rows.length) return { inserted: 0 };
  const { error } = await admin
    .from("fb_group_posts")
    .upsert(rows, { onConflict: "source_group_id,fb_post_id" });
  if (error) throw new Error(error.message);
  return { inserted: rows.length };
}

async function expandPostBody(page) {
  await page
    .evaluate(() => {
      const expandRe = /^(see more|see translation|查看更多|顯示更多|更多|展開)$/i;
      const blockRe = /(comment|comments|reply|replies|留言|回覆|評論|查看更多留言|更多留言)/i;
      const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], a[role="button"], button'));
      let clicked = 0;
      for (const button of buttons) {
        if (clicked >= 4) break;
        const text = String(button.innerText || button.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || !expandRe.test(text) || blockRe.test(text)) continue;
        if (button.getAttribute("aria-disabled") === "true") continue;
        button.click();
        clicked += 1;
      }
      return clicked;
    })
    .catch(() => 0);
}

async function extractCandidatePosts(page) {
  const raw = await page.evaluate((limit) => {
    const isPostHref = (href) =>
      href.includes("/posts/") || href.includes("story_fbid=") || href.includes("permalink.php") || href.includes("/permalink/");

    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    const rows = [];

    for (let index = 0; index < articles.length; index++) {
      const article = articles[index];
      const hrefs = Array.from(article.querySelectorAll("a[href]"))
        .map((anchor) => anchor.getAttribute("href") || "")
        .filter(Boolean);
      const hit = hrefs.find((href) => isPostHref(href));
      if (!hit) continue;
      rows.push({ post_url: hit, feed_index: index });
      if (rows.length >= limit * 3) break;
    }

    return rows;
  }, MAX_POSTS_PER_GROUP);

  const urls = new Set();
  const ranked = raw.sort((a, b) => a.feed_index - b.feed_index);
  for (const item of ranked) {
    const normalized = normalizeFacebookUrl(item.post_url);
    if (!normalized) continue;
    if (!normalized.includes("facebook.com")) continue;
    urls.add(normalized);
    if (urls.size >= MAX_POSTS_PER_GROUP * 3) break;
  }

  const list = Array.from(urls)
    .map((post_url) => ({
      fb_post_id: parseFbPostId(post_url),
      post_url,
    }))
    .filter((p) => p.fb_post_id && p.post_url);

  const seen = new Set();
  const deduped = [];
  for (const item of list) {
    const key = `${item.fb_post_id}:${item.post_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= MAX_POSTS_PER_GROUP) break;
  }

  return deduped;
}

async function extractPostDetails(page, expectedFbPostId) {
  const details = await page.evaluate((targetId) => {
    const norm = (t) => String(t || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const postHrefRe = /\/posts\/|story_fbid=|permalink\.php|\/permalink\//i;
    const bodySelector = '[data-ad-preview="message"], [data-ad-comet-preview="message"]';
    const actionTextRe = /^(like|comment|share|send|reply|follow|more|most relevant|view more comments|write a comment|leave a comment|commenting as|讚好|留言|回覆|分享|發送|最相關|查看更多留言|寫留言|發表留言)$/i;
    const commentBoundaryRe = /(most relevant|all comments|view more comments|write a comment|leave a comment|commenting as|comments|replies|最相關|所有留言|查看更多留言|寫留言|發表留言|留言|回覆)/i;
    const imageAltRe = /(profile picture|avatar|emoji|sticker|icon|reaction|貼圖|頭像|個人檔案相片|表情)/i;

    const hasPostHref = (href) => postHrefRe.test(String(href || ""));
    const getPostLinks = (root) =>
      Array.from(root.querySelectorAll("a[href]"))
        .map((anchor) => anchor.getAttribute("href") || "")
        .filter((href) => hasPostHref(href));

    const scoreArticle = (el) => {
      const txtLen = (el.innerText || "").trim().length;
      const anchors = getPostLinks(el);
      const hit = targetId ? anchors.some((href) => href.includes(String(targetId))) : anchors.length > 0;
      const hasBody = el.querySelector(bodySelector);
      const hasTime = el.querySelector("abbr[title], time[datetime]");
      const hasHeader = el.querySelector("h2 a, h3 a, h4 a, strong a");
      const rectTop = Math.abs(Number(el.getBoundingClientRect?.().top ?? 0));
      return (hit ? 1_000_000 : 0) + (hasBody ? 20_000 : 0) + (hasTime ? 10_000 : 0) + (hasHeader ? 5_000 : 0) + txtLen - rectTop;
    };

    const pickArticle = () => {
      const candidates = Array.from(document.querySelectorAll('[role="article"]'));
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

      const main = document.querySelector('[role="main"]');
      if (!main) return null;
      const inside = Array.from(main.querySelectorAll("article, div"));
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

    const article = pickArticle();
    const root = article || document;
    const textFromNode = (node) => norm(node?.innerText || node?.textContent || "");
    const collectBodyNodes = () =>
      Array.from(root.querySelectorAll(bodySelector))
        .filter((node) => !node.closest('[aria-label*="comment" i], [aria-label*="留言"], [role="textbox"], form'))
        .map((node) => textFromNode(node))
        .filter((text) => text && text.length >= 2);
    const collectFallbackBlocks = () => {
      const blocks = [];
      const nodes = Array.from(root.querySelectorAll('div[dir="auto"], span[dir="auto"], p'));
      let hitBoundary = false;
      for (const node of nodes) {
        const text = textFromNode(node);
        if (!text) continue;
        if (commentBoundaryRe.test(text)) {
          hitBoundary = true;
          continue;
        }
        if (hitBoundary) continue;
        if (node.closest('[aria-label*="comment" i], [aria-label*="留言"], [role="textbox"], form')) continue;
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
      contentText = norm(collectFallbackBlocks().join("\n"));
    }

    const imgSet = new Set();
    const pushImage = (raw, width = 0, height = 0, alt = "") => {
      const src = String(raw || "").trim();
      if (!src) return;
      if (src.startsWith("data:") || src.startsWith("blob:")) return;
      if (!/(fbcdn|scontent)\./i.test(src)) return;
      if (alt && imageAltRe.test(alt)) return;
      if (width && height && width < 160 && height < 160) return;
      imgSet.add(src);
    };
    const imgs = Array.from(root.querySelectorAll("img"));
    for (const img of imgs) {
      const srcCandidates = [
        img.currentSrc,
        img.src,
        img.getAttribute("src"),
        img.getAttribute("data-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-imgsrc"),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      const srcSet = String(img.getAttribute("srcset") || "").trim();
      if (srcSet) {
        for (const part of srcSet.split(",")) {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) srcCandidates.push(candidate);
        }
      }
      const w = Number(img.naturalWidth || 0);
      const h = Number(img.naturalHeight || 0);
      const alt = String(img.getAttribute("alt") || "").trim();
      for (const candidate of srcCandidates) {
        pushImage(candidate, w, h, alt);
      }
      if (imgSet.size >= 12) break;
    }
    if (imgSet.size < 12) {
      const styled = Array.from(root.querySelectorAll('[style*="background-image"]'));
      for (const node of styled) {
        const style = String(node.getAttribute("style") || "");
        const match = style.match(/background-image\s*:\s*url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i);
        if (match?.[2]) pushImage(match[2]);
        if (imgSet.size >= 12) break;
      }
    }

    const pickTimeRaw = () => {
      const abbr = root.querySelector("abbr[title]");
      if (abbr) return abbr.getAttribute("title") || abbr.textContent || "";
      const time = root.querySelector("time[datetime]");
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

  const contentText = String(details?.content_text || "").trim();
  const imageUrls = Array.isArray(details?.image_urls) ? details.image_urls.map(String).filter(Boolean) : [];
  const rawTime = String(details?.post_created_at_raw || "").trim();
  const postCreatedAt = parseFacebookTimeToIso(rawTime);

  return {
    content_text: contentText || null,
    image_urls: imageUrls,
    post_created_at: postCreatedAt,
    post_created_at_raw: rawTime || null,
  };
}

async function scrapeOnce() {
  const cookies = loadCookies();
  if (!cookies) {
    throw new Error(
      `缺少 Facebook session。請優先設定 FB_COOKIES_JSON；本機亦可使用 cookies 檔案：${COOKIES_PATH}（請先執行：node fb-scraper-service.mjs init-session）`,
    );
  }

  ensureDir(USER_DATA_DIR);

  const admin = await getSupabaseAdmin();
  const groups = await listActiveGroups(admin);
  const targetGroups =
    MAX_GROUPS_PER_RUN && MAX_GROUPS_PER_RUN > 0 ? groups.slice(0, MAX_GROUPS_PER_RUN) : groups;

  if (!targetGroups.length) {
    console.log("目前沒有啟用中的 Facebook 監控群組");
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: await resolveChromeExecutablePath(),
    userDataDir: USER_DATA_DIR,
    args: buildChromeArgs(),
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
    await page.setCookie(...cookies);
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
    if (await detectLoggedOut(page)) {
      throw new Error("Facebook cookies 似乎已失效或需要重新驗證（請重新執行：node fb-scraper-service.mjs init-session）");
    }

    for (const group of targetGroups) {
      const url = buildChronologicalGroupUrl(group.group_url);
      if (!url) {
        console.error(`[FB-Scraper] 無效的群組網址，已跳過：${group.group_name || group.id}`);
        continue;
      }
      console.log(`[FB-Scraper] 讀取群組：${group.group_name || group.id}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        if (await detectLoggedOut(page)) {
          throw new Error("偵測到未登入狀態（cookies 可能失效 / FB 要求 checkpoint）");
        }
        await randomDelay();
        await humanScroll(page);

        const candidates = await extractCandidatePosts(page);
        console.log(`[FB-Scraper] 候選貼文：${candidates.length} 筆`);

        let wrote = 0;
        for (const p of candidates) {
          const nowIso = new Date().toISOString();
          const postUrl = normalizeFacebookUrl(p.post_url);
          if (!postUrl) continue;

          await randomDelay();
          await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          await randomHumanPause(600, 1400);
          await humanScroll(page, randInt(2, 5));
          await expandPostBody(page);

          const details = await extractPostDetails(page, p.fb_post_id);

          const row = {
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
          wrote += 1;
        }

        console.log(`[FB-Scraper] 寫入/更新貼文：${wrote} 筆`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "unknown_error");
        console.error(`[FB-Scraper] 群組抓取失敗：${message}`);
        await sleep(Math.max(5000, MAX_DELAY_MS * 2));
      }

      await randomDelay();
    }
  } finally {
    await browser.close();
  }
}

async function loop() {
  for (;;) {
    await scrapeOnce();
    await sleep(LOOP_INTERVAL_MS);
  }
}

async function main() {
  const cmd = String(process.argv[2] || "").trim();
  if (cmd === "init-session") {
    await initSession();
    return;
  }
  if (cmd === "loop") {
    await loop();
    return;
  }
  if (cmd === "scrape" || !cmd) {
    await scrapeOnce();
    return;
  }

  throw new Error(`Unknown command: ${cmd || "(empty)"}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  console.error("[FB-Scraper] failed:", message);
  process.exitCode = 1;
});

