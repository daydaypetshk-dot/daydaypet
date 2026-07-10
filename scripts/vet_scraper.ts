import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { createClient } from "@supabase/supabase-js";

const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}

const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const GOOGLE_PLACES_API_KEY = String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
const CHROME_PATH = String(process.env.PUPPETEER_EXECUTABLE_PATH ?? "").trim();
const HEADLESS = String(process.env.VET_SCRAPER_HEADLESS ?? "true").trim() !== "false";
const OUTPUT_REPORT = path.join(process.cwd(), "tmp-vet-scrape-report.json");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type CliArgs = {
  district: string;
  keyword: string;
  limit: number;
};

type SearchCandidate = {
  title: string;
  href: string;
};

type VetMetadata = {
  google_place_id: string;
  google_maps_url: string;
  rating: number | null;
  review_count: number | null;
  phone: string;
  website: string;
  raw_query: string;
  is_24h_emergency: boolean;
  specialist_services: string[];
  booking_url: string;
  pet_types_supported: string[];
  language_status?: "ok" | "language_missing";
  language_note?: string;
  editorial_summary?: string;
};

type VetPlace = {
  name: string;
  district: string;
  address: string;
  opening_hours: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  has_grass: boolean;
  has_wash_station: boolean;
  has_fencing: boolean;
  has_parking: boolean;
  metadata: VetMetadata;
  category_id: string;
  subcategory_id: string;
  source: "scraper_google_maps";
  status: "pending";
};

type Taxonomy = {
  categoryId: string;
  subcategoryIds: Record<string, string>;
};

const DISTRICT_QUERY_MAP: Record<string, { query: string; stored: string; matchTerms: string[] }> = {
  "中西區": {
    query: "Central and Western District",
    stored: "中西區",
    matchTerms: [
      "中西區",
      "中環",
      "上環",
      "西營盤",
      "堅尼地城",
      "金鐘",
      "半山",
      "山頂",
      "central",
      "sheung wan",
      "sai ying pun",
      "kennedy town",
      "admiralty",
      "mid-levels",
      "the peak",
    ],
  },
  "灣仔區": {
    query: "Wan Chai",
    stored: "灣仔區",
    matchTerms: ["灣仔區", "灣仔", "銅鑼灣", "跑馬地", "wan chai", "wanchai", "causeway bay", "happy valley"],
  },
  "東區": { query: "Eastern District", stored: "東區", matchTerms: ["東區", "北角", "鰂魚涌", "西灣河", "筲箕灣", "柴灣", "eastern", "north point", "quarry bay", "sai wan ho", "shau kei wan", "chai wan"] },
  "南區": { query: "Southern District", stored: "南區", matchTerms: ["南區", "香港仔", "鴨脷洲", "黃竹坑", "淺水灣", "赤柱", "southern", "aberdeen", "ap lei chau", "wong chuk hang", "repulse bay", "stanley"] },
  "油尖旺區": { query: "Yau Tsim Mong District", stored: "油尖旺區", matchTerms: ["油尖旺區", "尖沙咀", "佐敦", "油麻地", "旺角", "yau tsim mong", "tsim sha tsui", "jordan", "yau ma tei", "mong kok"] },
  "深水埗區": { query: "Sham Shui Po District", stored: "深水埗區", matchTerms: ["深水埗區", "深水埗", "長沙灣", "石硤尾", "sham shui po", "cheung sha wan", "shek kip mei"] },
  "九龍城區": { query: "Kowloon City District", stored: "九龍城區", matchTerms: ["九龍城區", "九龍城", "土瓜灣", "何文田", "紅磡", "kowloon city", "to kwa wan", "ho man tin", "hung hom"] },
  "黃大仙區": { query: "Wong Tai Sin District", stored: "黃大仙區", matchTerms: ["黃大仙區", "黃大仙", "鑽石山", "新蒲崗", "wong tai sin", "diamond hill", "san po kong"] },
  "觀塘區": { query: "Kwun Tong District", stored: "觀塘區", matchTerms: ["觀塘區", "觀塘", "牛頭角", "九龍灣", "藍田", "kwun tong", "ngau tau kok", "kowloon bay", "lam tin"] },
  "荃灣區": { query: "Tsuen Wan District", stored: "荃灣區", matchTerms: ["荃灣區", "荃灣", "tsuen wan"] },
  "葵青區": { query: "Kwai Tsing District", stored: "葵青區", matchTerms: ["葵青區", "葵涌", "青衣", "kwai tsing", "kwai chung", "tsing yi"] },
  "沙田區": { query: "Sha Tin District", stored: "沙田區", matchTerms: ["沙田區", "沙田", "馬鞍山", "sha tin", "ma on shan"] },
  "西貢區": { query: "Sai Kung District", stored: "西貢區", matchTerms: ["西貢區", "西貢", "將軍澳", "sai kung", "tseung kwan o"] },
  "大埔區": { query: "Tai Po District", stored: "大埔區", matchTerms: ["大埔區", "大埔", "tai po"] },
  "北區": { query: "North District Hong Kong", stored: "北區", matchTerms: ["北區", "上水", "粉嶺", "north district", "sheung shui", "fanling"] },
  "元朗區": { query: "Yuen Long District", stored: "元朗區", matchTerms: ["元朗區", "元朗", "天水圍", "yuen long", "tin shui wai"] },
  "屯門區": { query: "Tuen Mun District", stored: "屯門區", matchTerms: ["屯門區", "屯門", "tuen mun"] },
  "離島區": { query: "Islands District Hong Kong", stored: "離島區", matchTerms: ["離島區", "大嶼山", "東涌", "長洲", "南丫島", "islands district", "lantau", "tung chung", "cheung chau", "lamma"] },

  wanchai: {
    query: "Wan Chai",
    stored: "灣仔區",
    matchTerms: ["灣仔區", "灣仔", "銅鑼灣", "跑馬地", "wan chai", "wanchai", "causeway bay", "happy valley"],
  },
  "wan chai": {
    query: "Wan Chai",
    stored: "灣仔區",
    matchTerms: ["灣仔區", "灣仔", "銅鑼灣", "跑馬地", "wan chai", "wanchai", "causeway bay", "happy valley"],
  },
  灣仔: {
    query: "Wan Chai",
    stored: "灣仔區",
    matchTerms: ["灣仔區", "灣仔", "銅鑼灣", "跑馬地", "wan chai", "wanchai", "causeway bay", "happy valley"],
  },
};

const DEFAULT_STORED_DISTRICT = "全港";

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const pick = (flag: string) => {
    const idx = argv.findIndex((item) => item === flag);
    if (idx === -1) return "";
    return String(argv[idx + 1] ?? "").trim();
  };

  const district = pick("--district") || pick("-d") || "Wanchai";
  const keyword = pick("--keyword") || pick("-k") || "veterinary clinic";
  const limitRaw = Number(pick("--limit") || pick("-l") || 8);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw))) : 8;
  return { district, keyword, limit };
}

function normalizeDistrict(input: string) {
  const raw = input.trim();
  const hit = DISTRICT_QUERY_MAP[raw.toLowerCase()] ?? DISTRICT_QUERY_MAP[raw];
  if (hit) return hit;
  return { query: raw || "Hong Kong", stored: raw || DEFAULT_STORED_DISTRICT, matchTerms: [raw.toLowerCase()] };
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/^[^\p{L}\p{N}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasHan(text: string) {
  return /[\p{Script=Han}]/u.test(String(text ?? ""));
}

function guessScrapeMode(keyword: string) {
  const raw = String(keyword || "").trim();
  const lower = raw.toLowerCase();
  const isPark =
    raw.includes("公園") ||
    raw.includes("狗公園") ||
    raw.includes("寵物公園") ||
    lower.includes("dog park") ||
    lower.includes("pet park") ||
    lower.includes("pet garden") ||
    lower.includes("dog garden");
  return isPark ? ("park" as const) : ("vet" as const);
}

function buildSearchQueries(input: { keyword: string; districtQuery: string }) {
  const baseKeyword = String(input.keyword || "").trim();
  const districtQuery = String(input.districtQuery || "").trim() || "Hong Kong";
  const queries: string[] = [];

  const push = (q: string) => {
    const t = q.trim();
    if (!t) return;
    if (!queries.includes(t)) queries.push(t);
  };

  push(`${baseKeyword} ${districtQuery} Hong Kong`);
  push(`${baseKeyword} ${districtQuery} 香港`);

  if (baseKeyword.includes("寵物公園") || baseKeyword.includes("狗公園")) {
    for (const kw of ["dog park", "pet park", "pet garden", "dog garden", "寵物公園", "狗公園", "寵物共享公園"]) {
      push(`${kw} ${districtQuery} Hong Kong`);
      push(`${kw} ${districtQuery} 香港`);
    }
  }

  return queries;
}

function normalizePhone(value: unknown) {
  return normalizeText(value).replace(/^電話[:：]?\s*/i, "");
}

function parseMaybeNumber(text: string) {
  const cleaned = text.replace(/,/g, "").trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function parseCoordinates(urlText: string) {
  const url = normalizeText(urlText);
  const atMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (atMatch) {
    return {
      latitude: Number(atMatch[1]),
      longitude: Number(atMatch[2]),
    };
  }
  const bangMatch = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bangMatch) {
    return {
      latitude: Number(bangMatch[1]),
      longitude: Number(bangMatch[2]),
    };
  }
  return { latitude: null, longitude: null };
}

function parseGooglePlaceId(urlText: string, html: string) {
  const url = normalizeText(urlText);
  const urlMatch =
    url.match(/!19s(ChI[^!?&/]+)/) ||
    url.match(/!1s(ChI[^!?&/]+)/) ||
    url.match(/\/place\/[^/]+\/data=.*!19s(ChI[^!?&/]+)/);
  if (urlMatch?.[1]) return String(urlMatch[1]).trim();

  const htmlMatch =
    html.match(/"placeId":"(ChI[^"]+)"/) ||
    html.match(/"place_id":"(ChI[^"]+)"/) ||
    html.match(/"data_id":"(ChI[^"]+)"/);
  if (htmlMatch?.[1]) return String(htmlMatch[1]).trim();
  return "";
}

function buildGoogleMapsUrl(query: string) {
  const url = new URL(`https://www.google.com/maps/search/${encodeURIComponent(query)}`);
  url.searchParams.set("hl", "zh-HK");
  url.searchParams.set("gl", "hk");
  url.searchParams.set("authuser", "0");
  return url.toString();
}

async function fetchZhHkPlaceDetails(placeId: string) {
  if (!GOOGLE_PLACES_API_KEY || !placeId) return null;
  const params = new URLSearchParams({
    place_id: placeId,
    language: "zh-HK",
    fields: "name,formatted_address,editorial_summary,reviews",
    key: GOOGLE_PLACES_API_KEY,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | {
        status?: string;
        result?: {
          name?: string;
          formatted_address?: string;
          editorial_summary?: { overview?: string };
          reviews?: Array<{ text?: string; language?: string }>;
        };
      }
    | null;
  if (!json || json.status !== "OK" || !json.result) return null;
  return {
    name: normalizeText(json.result.name),
    address: normalizeText(json.result.formatted_address),
    editorialSummary: normalizeText(json.result.editorial_summary?.overview),
    reviews: Array.isArray(json.result.reviews)
      ? json.result.reviews
          .map((item) => ({
            text: normalizeText(item?.text),
            language: normalizeText(item?.language),
          }))
          .filter((item) => item.text)
      : [],
  };
}

async function resolveChineseFields(input: {
  placeId: string;
  name: string;
  address: string;
  metadata: VetMetadata;
}) {
  const nameHasHan = hasHan(input.name);
  const addressHasHan = hasHan(input.address);
  if (nameHasHan && addressHasHan) {
    return {
      name: input.name,
      address: input.address,
      metadata: { ...input.metadata, language_status: "ok" as const, language_note: "" },
      languageMissing: false,
    };
  }

  const fallback = await fetchZhHkPlaceDetails(input.placeId).catch(() => null);
  const fallbackName = fallback?.name && hasHan(fallback.name) ? fallback.name : input.name;
  const fallbackAddress = fallback?.address && hasHan(fallback.address) ? fallback.address : input.address;
  const stillMissing = !(hasHan(fallbackName) && hasHan(fallbackAddress));
  const note = stillMissing
    ? GOOGLE_PLACES_API_KEY
      ? "Language Missing"
      : "Language Missing (no GOOGLE_PLACES_API_KEY fallback)"
    : "";

  return {
    name: fallbackName,
    address: fallbackAddress,
    metadata: {
      ...input.metadata,
      editorial_summary: fallback?.editorialSummary || input.metadata.editorial_summary || "",
      language_status: stillMissing ? ("language_missing" as const) : ("ok" as const),
      language_note: note,
    },
    languageMissing: stillMissing,
  };
}

function detect24h(name: string, address: string, keyword: string, openingHours: string | null) {
  const haystack = [name, address, keyword, openingHours ?? ""].join(" ").toLowerCase();
  return /24\s*h|24hours|24-hour|emergency|急症|通宵|24小時/.test(haystack);
}

function isDistrictRelevant(name: string, address: string, districtInfo: { matchTerms: string[] }) {
  const haystack = `${name} ${address}`.toLowerCase();
  return districtInfo.matchTerms.some((term) => term && haystack.includes(term.toLowerCase()));
}

function detectSubcategory(keyword: string, name: string, address: string, metadata: VetMetadata, taxonomy: Taxonomy) {
  const haystack = [keyword, name, address, metadata.phone, metadata.website].join(" ").toLowerCase();
  if (metadata.is_24h_emergency && taxonomy.subcategoryIds["24小時急症"]) return taxonomy.subcategoryIds["24小時急症"];
  if (/(exotic|avian|rabbit|hamster|reptile|珍禽|異獸)/i.test(haystack) && taxonomy.subcategoryIds["珍禽異獸"]) {
    return taxonomy.subcategoryIds["珍禽異獸"];
  }
  if (/(feline|cat only|cat clinic|貓專科|cats?)/i.test(haystack) && taxonomy.subcategoryIds["貓專科醫院"]) {
    return taxonomy.subcategoryIds["貓專科醫院"];
  }
  if (/(acupuncture|tcvm|中醫|針灸)/i.test(haystack) && taxonomy.subcategoryIds["中醫/針灸"]) {
    return taxonomy.subcategoryIds["中醫/針灸"];
  }
  return taxonomy.subcategoryIds["普通門診"] ?? Object.values(taxonomy.subcategoryIds)[0];
}

async function dismissGoogleOverlays(page: Page) {
  const texts = ["Accept all", "I agree", "接受", "同意", "Accept", "Reject all", "Not now"];
  for (const text of texts) {
    try {
      const clicked = await page
        .evaluate((targetText) => {
          const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
          const target = buttons.find((button) => (button.innerText || button.textContent || "").includes(targetText));
          if (!target) return false;
          target.click();
          return true;
        }, text)
        .catch(() => false);
      if (clicked) await sleep(800);
    } catch {}
  }
}

async function collectSearchCandidates(page: Page, query: string, limit: number) {
  const targetUrl = buildGoogleMapsUrl(query);
  await page.setViewport({ width: 1365, height: 920, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ "accept-language": "zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.6" });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissGoogleOverlays(page);
  await sleep(2500);

  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) {
        feed.scrollBy(0, 1800);
      } else {
        window.scrollBy(0, 1800);
      }
    });
    await sleep(1200);
  }

  const candidates = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    return anchors
      .map((anchor) => ({
        title: (anchor.getAttribute("aria-label") || anchor.textContent || "").trim(),
        href: anchor.href,
      }))
      .filter((item) => {
        if (!item.href || !item.title) return false;
        if (item.href.includes("/maps/place/")) return true;
        if (item.href.includes("/place/")) return true;
        if (item.href.includes("/maps?cid=")) return true;
        if (item.href.includes("/maps/search/")) return false;
        return false;
      });
  });

  return uniqueBy(candidates as SearchCandidate[], (item) => item.href).slice(0, limit);
}

async function extractPlaceDetails(
  browser: Browser,
  candidate: SearchCandidate,
  query: string,
  districtInfo: { stored: string; matchTerms: string[] },
  mode: "vet" | "park",
) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1365, height: 920, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({ "accept-language": "zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.6" });
    const detailUrl = new URL(candidate.href);
    detailUrl.searchParams.set("hl", "zh-HK");
    detailUrl.searchParams.set("gl", "hk");
    await page.goto(detailUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissGoogleOverlays(page);
    await sleep(2200);

    const details = await page.evaluate(() => {
      const text = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        return (el?.innerText || el?.textContent || "").trim();
      };
      const attr = (selector: string, name: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        return (el?.getAttribute(name) || "").trim();
      };

      const name =
        text("h1") ||
        text('h1[class*="fontHeadlineLarge"]') ||
        text('div[role="main"] h1') ||
        text('div[role="main"] [aria-level="1"]');
      const address =
        text('button[data-item-id="address"]') ||
        text('button[data-item-id*="address"]') ||
        text('button[aria-label^="Address"]');
      const phone =
        text('button[data-item-id^="phone"]') ||
        text('a[data-item-id^="phone"]') ||
        text('button[aria-label^="Phone"]');
      const website =
        attr('a[data-item-id="authority"]', "href") ||
        attr('a[data-item-id*="authority"]', "href") ||
        attr('a[aria-label^="Website"]', "href");
      const ratingFromLabel =
        attr('div[role="img"][aria-label*="stars"]', "aria-label") || attr('span[role="img"][aria-label*="stars"]', "aria-label");
      const ratingText = text('div[role="img"][aria-label*="stars"]') || text('span[role="img"][aria-label*="stars"]');
      const openingHours =
        text('button[data-item-id="oh"]') ||
        text('div[aria-label*="Hours"]') ||
        text('div[aria-label*="營業時間"]');

      return {
        name,
        address,
        phone,
        website,
        ratingRaw: ratingFromLabel || ratingText,
        openingHours,
        currentUrl: location.href,
        html: document.documentElement.outerHTML,
      };
    });

    const ratingMatch = `${details.ratingRaw}`.match(/([0-9]+(?:\.[0-9]+)?)/);
    const reviewMatch = `${details.ratingRaw}`.match(/\(([\d,]+)\)|([\d,]+)\s+reviews/i);
    const rating = ratingMatch ? parseMaybeNumber(ratingMatch[1]) : null;
    const reviewCount = reviewMatch ? parseMaybeNumber(reviewMatch[1] || reviewMatch[2] || "") : null;
    const coords = parseCoordinates(details.currentUrl || candidate.href);
    const html = String(details.html || "");
    const googlePlaceId = parseGooglePlaceId(details.currentUrl || candidate.href, html);
    const phone = normalizePhone(details.phone);
    const name = normalizeText(details.name || candidate.title);
    const address = normalizeText(details.address);
    const openingHours = normalizeText(details.openingHours) || null;

    if (!name || !address || (mode === "vet" && !phone)) {
      return { ok: false as const, reason: "missing_required_fields", candidate, query };
    }
    if (mode === "vet" && !isDistrictRelevant(name, address, districtInfo)) {
      return { ok: false as const, reason: "district_mismatch", candidate, query };
    }

    const baseMetadata: VetMetadata = {
      google_place_id: googlePlaceId,
      google_maps_url: normalizeText(detailUrl.toString()),
      rating,
      review_count: reviewCount,
      phone,
      website: normalizeText(details.website),
      raw_query: query,
      is_24h_emergency: detect24h(name, address, query, openingHours),
      specialist_services: [],
      booking_url: "",
      pet_types_supported: [],
    };
    const zhResolved = await resolveChineseFields({
      placeId: googlePlaceId,
      name,
      address,
      metadata: baseMetadata,
    });

    return {
      ok: true as const,
      place: {
        name: zhResolved.name,
        district: districtInfo.stored,
        address: zhResolved.address,
        opening_hours: openingHours,
        latitude: coords.latitude,
        longitude: coords.longitude,
        image_url: null,
        has_grass: false,
        has_wash_station: false,
        has_fencing: false,
        has_parking: false,
        metadata: zhResolved.metadata,
      },
      languageMissing: zhResolved.languageMissing,
    };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error && error.message ? error.message : "detail_scrape_failed",
      candidate,
      query,
    };
  } finally {
    await page.close().catch(() => null);
  }
}

async function loadVetTaxonomy() {
  const category = await supabase.from("guide_categories").select("id,name").eq("name", "獸醫").maybeSingle();
  if (category.error || !category.data?.id) {
    throw new Error("找不到 guide_categories: 獸醫");
  }

  const subs = await supabase
    .from("guide_subcategories")
    .select("id,name")
    .eq("category_id", category.data.id)
    .in("name", ["24小時急症", "珍禽異獸", "貓專科醫院", "中醫/針灸", "普通門診"]);
  if (subs.error) throw subs.error;

  const subcategoryIds: Record<string, string> = {};
  for (const row of subs.data ?? []) {
    subcategoryIds[String((row as any).name)] = String((row as any).id);
  }
  if (!subcategoryIds["普通門診"]) {
    throw new Error("找不到 guide_subcategories: 普通門診");
  }

  return { categoryId: category.data.id, subcategoryIds } satisfies Taxonomy;
}

async function loadParkTaxonomy() {
  const category = await supabase.from("guide_categories").select("id,name").eq("name", "寵物公園").maybeSingle();
  if (category.error || !category.data?.id) {
    throw new Error("找不到 guide_categories: 寵物公園");
  }

  const subs = await supabase
    .from("guide_subcategories")
    .select("id,name")
    .eq("category_id", category.data.id)
    .in("name", ["寵物共享公園", "專用狗公園", "設有清洗區", "室內寵物公園"]);
  if (subs.error) throw subs.error;

  const subcategoryIds: Record<string, string> = {};
  for (const row of subs.data ?? []) {
    subcategoryIds[String((row as any).name)] = String((row as any).id);
  }
  if (!subcategoryIds["寵物共享公園"] && Object.keys(subcategoryIds).length === 0) {
    throw new Error("找不到 guide_subcategories: 寵物共享公園");
  }

  return { categoryId: category.data.id, subcategoryIds } satisfies Taxonomy;
}

async function insertStagedPlaces(records: VetPlace[]) {
  if (records.length === 0) return { imported: 0, rows: [] as any[] };
  const { data, error } = await supabase
    .from("staged_places")
    .upsert(records, { onConflict: "name,address" })
    .select("id,name,address,status,source");
  if (error) throw error;
  return { imported: data?.length ?? 0, rows: data ?? [] };
}

async function run() {
  const args = parseArgs();
  const district = normalizeDistrict(args.district);
  const mode = guessScrapeMode(args.keyword);
  const taxonomy = mode === "park" ? await loadParkTaxonomy() : await loadVetTaxonomy();
  const queries = buildSearchQueries({ keyword: args.keyword, districtQuery: district.query });
  let searchQuery = queries[0] || `${args.keyword} ${district.query} Hong Kong`;

  const userDataDir = path.join(process.cwd(), "tmp-puppeteer-profile");
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    executablePath: CHROME_PATH || undefined,
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--lang=zh-HK",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-networking",
    ],
  });

  const failures: Array<Record<string, unknown>> = [];
  const languageWarnings: Array<Record<string, unknown>> = [];
  try {
    const listPage = await browser.newPage();
    let candidates: SearchCandidate[] = [];
    const tried: Array<{ query: string; candidates: number }> = [];
    for (const q of queries) {
      const result = await collectSearchCandidates(listPage, q, args.limit);
      tried.push({ query: q, candidates: result.length });
      console.log(`[search] ${q} -> ${result.length}`);
      if (result.length > 0) {
        candidates = result;
        searchQuery = q;
        break;
      }
    }
    await listPage.close().catch(() => null);

    const stagedPayloads: VetPlace[] = [];

    for (const candidate of candidates) {
      const detail = await extractPlaceDetails(browser, candidate, searchQuery, district, mode);
      if (!detail.ok) {
        failures.push({ type: "detail", title: candidate.title, href: candidate.href, reason: detail.reason });
        continue;
      }
      if (detail.languageMissing) {
        languageWarnings.push({
          type: "language",
          title: detail.place.name,
          address: detail.place.address,
          reason: "Language Missing",
          google_place_id: detail.place.metadata.google_place_id,
        });
      }

      const subcategoryId =
        mode === "park"
          ? (() => {
              const lower = `${args.keyword} ${detail.place.name} ${detail.place.address}`.toLowerCase();
              if ((lower.includes("indoor") || lower.includes("室內")) && taxonomy.subcategoryIds["室內寵物公園"]) {
                return taxonomy.subcategoryIds["室內寵物公園"];
              }
              if ((lower.includes("dog") || lower.includes("狗")) && taxonomy.subcategoryIds["專用狗公園"]) {
                return taxonomy.subcategoryIds["專用狗公園"];
              }
              return taxonomy.subcategoryIds["寵物共享公園"] ?? Object.values(taxonomy.subcategoryIds)[0];
            })()
          : detectSubcategory(args.keyword, detail.place.name, detail.place.address, detail.place.metadata, taxonomy);
      stagedPayloads.push({
        ...detail.place,
        category_id: taxonomy.categoryId,
        subcategory_id: subcategoryId,
        source: "scraper_google_maps",
        status: "pending",
      });
    }

    const filtered = uniqueBy(stagedPayloads, (item) => `${item.name}__${item.address}`);
    const result = await insertStagedPlaces(filtered);

    const report = {
      district: district.stored,
      keyword: args.keyword,
      query: searchQuery,
      mode,
      queriesTried: queries,
      queryAttempts: tried,
      candidates: candidates.length,
      validPlaces: filtered.length,
      imported: result.imported,
      failures,
      languageWarnings,
      importedRows: result.rows,
    };

    fs.writeFileSync(OUTPUT_REPORT, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close().catch(() => null);
  }
}

run().catch((error) => {
  const message = error instanceof Error && error.message ? error.message : String(error);
  console.error("vet_scraper failed:", message);
  process.exit(1);
});
