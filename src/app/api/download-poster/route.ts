export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const CHROMIUM_CDN_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.tar";

type PosterPayload = {
  id: string;
  title: string;
  photoUrl: string;
  locationName: string;
  timeText: string;
  feature: string;
  phone: string;
};

async function toDataUrl(url: string) {
  const res = await fetch(url, {
    headers: { "user-agent": "daydaypet-poster-bot/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

function buildSosCaseUrl(caseId: string) {
  return `https://daydaypet.hk/sos/${encodeURIComponent(caseId)}`;
}

function formatLostTime(timeStr: string) {
  if (!timeStr) return "";
  try {
    const date = new Date(timeStr);
    if (!Number.isFinite(date.getTime())) return String(timeStr);

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    const yyyy = pick("year");
    const mm = pick("month");
    const dd = pick("day");
    const hh = pick("hour");
    const min = pick("minute");
    if (!yyyy || !mm || !dd || !hh || !min) return String(timeStr);
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return String(timeStr);
  }
}

function speciesLabelFromTitle(title: string) {
  if (title.includes("貓")) return "🐱 貓貓";
  if (title.includes("犬") || title.includes("狗")) return "🐶 狗狗";
  if (title.includes("鸚鵡") || title.includes("雀") || title.includes("鳥")) return "🦜 雀鳥";
  return "🐹 其他";
}

function highlightFeature(input: string) {
  const escaped = escapeHtml(input);
  const keywords = ["紅色頸圈", "紅色", "頸圈"];
  let out = escaped;
  for (const k of keywords) {
    out = out.replaceAll(k, `<span class="hl">${k}</span>`);
  }
  return out;
}

function renderPosterHtml(input: PosterPayload, photoDataUrl: string, qrDataUrl: string) {
  const title = escapeHtml(input.title);
  const locationName = escapeHtml(input.locationName);
  const timeText = escapeHtml(formatLostTime(input.timeText));
  const featureHtml = highlightFeature(input.feature);
  const phone = escapeHtml(input.phone);
  const caseUrl = escapeHtml(buildSosCaseUrl(input.id));
  const speciesLabel = escapeHtml(speciesLabelFromTitle(input.title));

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 794px;
        height: 1123px;
        background: #ffffff;
        color: #0b0f19;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
      }
      * { box-sizing: border-box; }
      .page {
        width: 794px;
        height: 1123px;
        padding: 56px;
        display: flex;
        flex-direction: column;
        gap: 22px;
      }
      .title {
        text-align: center;
        font-weight: 900;
        font-size: 56px;
        letter-spacing: 0.35em;
        color: #dc2626;
        margin-top: 6px;
      }
      .divider {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        background: #dc2626;
        margin: 18px 0 6px;
      }
      .photoWrap {
        display: flex;
        justify-content: center;
      }
      .photoFrame {
        width: 80%;
        padding: 10px;
        border: 1px solid #f3f4f6;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 14px 40px rgba(0,0,0,0.10);
      }
      .photo {
        width: 100%;
        height: 450px;
        border-radius: 14px;
        object-fit: cover;
        background: #f3f4f6;
        display: block;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: 14px;
        font-weight: 900;
        color: #0b0f19;
      }
      .name {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        font-size: 54px;
        line-height: 1.05;
        letter-spacing: -0.02em;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 14px;
        border-radius: 999px;
        background: #ffedd5;
        color: #9a3412;
        font-size: 18px;
        font-weight: 900;
        letter-spacing: 0.02em;
      }
      .kv {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        font-size: 36px;
        line-height: 1.35;
      }
      .icon {
        width: 40px;
        text-align: center;
        font-size: 26px;
        line-height: 1.2;
      }
      .kvText {
        flex: 1;
      }
      .hl {
        color: #dc2626;
        font-weight: 900;
      }
      .line {
        font-size: 34px;
        line-height: 1.35;
      }
      .bottom {
        margin-top: auto;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 18px 55px rgba(0,0,0,0.14);
      }
      .left {
        width: 50%;
        background: #18181b;
        color: #ffffff;
        padding: 26px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 12px;
      }
      .leftTop {
        font-weight: 900;
        font-size: 18px;
        line-height: 1.1;
        color: #facc15;
        letter-spacing: 0.02em;
      }
      .leftPhone {
        font-weight: 900;
        font-size: 44px;
        line-height: 1.05;
        letter-spacing: 0.10em;
      }
      .right {
        width: 50%;
        background: #ffffff;
        padding: 18px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        border-left: 2px solid #e5e7eb;
      }
      .qrLabel {
        text-align: center;
        font-weight: 900;
        font-size: 16px;
        color: #6b7280;
        letter-spacing: 0.01em;
      }
      .qr {
        width: 120px;
        height: 120px;
        display: block;
      }
      .hint {
        text-align: center;
        font-weight: 700;
        font-size: 18px;
        color: #374151;
        margin-top: 2px;
      }
      .meta {
        text-align: center;
        font-weight: 700;
        font-size: 12px;
        color: #6b7280;
        margin-top: -6px;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div>
        <div class="title">🚨 尋 寵 啟 事</div>
        <div class="divider"></div>
        <div class="hint">請各位街坊幫幫忙！</div>
      </div>

      <div class="photoWrap">
        <div class="photoFrame">
          <img class="photo" src="${photoDataUrl}" alt="pet" />
        </div>
      </div>

      <div class="details">
        <div class="name">
          <span class="badge">${speciesLabel}</span>
          <span>${title}</span>
        </div>
        <div class="kv"><div class="icon">📍</div><div class="kvText">走失地點：${locationName}</div></div>
        <div class="kv"><div class="icon">⏰</div><div class="kvText">走失時間：${timeText}</div></div>
        <div class="kv"><div class="icon">✨</div><div class="kvText">毛孩特徵：${featureHtml}</div></div>
      </div>

      <div class="bottom">
        <div class="left">
          <div class="leftTop">☎️ 發現蹤影？立刻致電</div>
          <div class="leftPhone">${phone}</div>
        </div>
        <div class="right">
          <img class="qr" src="${qrDataUrl}" alt="qr" />
          <div class="qrLabel">🔍 掃描追蹤最新目擊位置</div>
          <div class="meta">${caseUrl}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as PosterPayload;
    if (
      !input ||
      !input.id ||
      !input.title ||
      !input.photoUrl ||
      !input.locationName ||
      !input.timeText ||
      !input.feature ||
      !input.phone
    ) {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    const [photoDataUrl, qrDataUrl] = await Promise.all([
      toDataUrl(input.photoUrl),
      toDataUrl(
        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
          buildSosCaseUrl(input.id),
        )}`,
      ),
    ]);

    const html = renderPosterHtml(input, photoDataUrl, qrDataUrl);
    const executablePath =
      process.env.NODE_ENV === "production"
        ? await chromium.executablePath(CHROMIUM_CDN_PACK_URL)
        : await chromium.executablePath();

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: (chromium as unknown as { defaultViewport?: { width: number; height: number; deviceScaleFactor?: number } })
        .defaultViewport,
      executablePath,
      headless: (chromium as unknown as { headless?: boolean }).headless ?? true,
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: "load" });

      const pdf = await page.pdf({
        printBackground: true,
        width: "794px",
        height: "1123px",
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        pageRanges: "1",
      });

      const fileName = `尋寵街招_${sanitizeFileName(input.title)}.pdf`;
      return new Response(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser.close();
    }
  } catch {
    return Response.json({ error: "Failed to generate poster" }, { status: 500 });
  }
}
