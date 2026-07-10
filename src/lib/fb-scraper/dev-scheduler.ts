type GlobalWithScheduler = typeof globalThis & { __fbScrapeInterval?: NodeJS.Timeout; __fbScrapeBootedAt?: number };

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

async function triggerOnce(baseUrl: string, secret: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/admin/fb-posts/scrape-sync`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-cron-secret": secret } : {}),
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    await res.text().catch(() => "");
  }
}

export function ensureDevFbScrapeScheduler() {
  if (process.env.NODE_ENV !== "development") return;
  if (env("FB_SCRAPER_DEV_AUTO", "0") !== "1") return;

  const g = globalThis as GlobalWithScheduler;
  if (g.__fbScrapeInterval) return;

  const secret = env("FB_SCRAPER_CRON_SECRET", "");
  const intervalMs = envNum("FB_SCRAPER_DEV_INTERVAL_MS", 30 * 60 * 1000);
  const host = env("FB_SCRAPER_DEV_BASE_URL", "http://127.0.0.1:3000");

  g.__fbScrapeBootedAt = Date.now();
  setTimeout(() => void triggerOnce(host, secret), 8_000);
  g.__fbScrapeInterval = setInterval(() => void triggerOnce(host, secret), intervalMs);
}
