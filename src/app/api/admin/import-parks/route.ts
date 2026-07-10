export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { DISTRICTS_HK, normalizeDistrict } from "@/lib/pets/district";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GuideCategoryRow = {
  id: string;
  name: string;
};

type GuideSubcategoryRow = {
  id: string;
  category_id: string;
  name: string;
};

type GuidePlaceImportPayload = {
  category_id: string;
  subcategory_id: string;
  subcategory_ids: string[];
  source: string;
  status?: "pending" | "approved" | "rejected";
  name: string;
  district: string;
  address: string;
  opening_hours: string | null;
  plus_code: string | null;
  latitude: number;
  longitude: number;
  image_url: string | null;
  image_urls: string[];
  facility_tag_ids: string[];
  has_grass: boolean;
  has_wash_station: boolean;
  has_fencing: boolean;
  has_parking: boolean;
};

const LCSD_PARK_LIST_URL = "https://www.lcsd.gov.hk/clpss/en/webApp/Facility/Details.do?ftid=47";
const FETCH_TIMEOUT_MS = 15000;

type ParkType = "shared" | "dog";

const GOV_PARK_DATASETS: Array<{ url: string; parkType: ParkType }> = [
  {
    url: "https://www.lcsd.gov.hk/datagovhk/facility/facility-dgpg.json",
    parkType: "dog",
  },
  {
    url: "https://www.lcsd.gov.hk/datagovhk/facility/facility-ipfp.json",
    parkType: "shared",
  },
];

type PreparedParkRow = Omit<GuidePlaceImportPayload, "image_url" | "source"> & {
  image_url_seed?: string | null;
};

const PARK_NAME_KEYS = [
  "Name_cn",
  "Name_b5",
  "name_tc",
  "name",
  "chi_name",
  "cname",
  "venue_name",
  "venue_chi",
  "title",
  "名稱",
] as const;

const PARK_ADDRESS_KEYS = [
  "Address_cn",
  "Address_b5",
  "address_tc",
  "address",
  "chi_address",
  "venue_address",
  "地址",
] as const;

const PARK_LATITUDE_KEYS = ["LATITUDE", "Latitude", "latitude", "lat", "y", "northing", "NORTHING"] as const;
const PARK_LONGITUDE_KEYS = ["LONGITUDE", "Longitude", "long", "longitude", "lng", "lon", "x", "easting", "EASTING"] as const;

const DGPG_NAME_KEYS = ["Name_cn", "Name_b5", "Name_en", "name", "title"] as const;
const DGPG_ADDRESS_KEYS = ["Address_cn", "Address_b5", "Address_en", "address"] as const;
const DGPG_DISTRICT_KEYS = ["District_cn", "District_en", "district", "district_name"] as const;
const DGPG_OPENING_KEYS = ["Opening_hours_cn", "Opening_hours_en", "opening_hours"] as const;
const DGPG_FACILITY_KEYS = ["Facilities_b5", "Facilities_cn", "Facilities_en"] as const;
const DGPG_ANCILLARY_KEYS = ["Ancillary_facilities_cn", "Ancillary_facilities_b5", "Ancillary_facilities_en"] as const;

const IPFP_NAME_KEYS = ["NAME_TC", "NAME_EN", "Name_cn", "Name_b5", "name", "title"] as const;
const IPFP_ADDRESS_KEYS = ["ADDRESS_TC", "ADDRESS_EN", "Address_cn", "Address_b5", "address"] as const;
const IPFP_DISTRICT_KEYS = ["District_cn", "District_en", "SEARCH01_TC", "SEARCH01_EN", "district", "district_name"] as const;
const IPFP_OPENING_KEYS = ["NSEARCH02_TC", "NSEARCH02_EN", "Opening_hours_cn", "Opening_hours_en", "opening_hours"] as const;
const IPFP_FACILITY_KEYS = ["Facilities_b5", "Facilities_cn", "Facilities_en", "SEARCH02_TC", "SEARCH02_EN"] as const;
const IPFP_ANCILLARY_KEYS = ["NSEARCH01_TC", "NSEARCH01_EN", "Ancillary_facilities_cn", "Ancillary_facilities_en"] as const;

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function decodeHtmlEntities(text: string) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeWhitespace(text: string) {
  return stripHtml(decodeHtmlEntities(text))
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function normalizeImageUrl(url: string) {
  const trimmed = decodeHtmlEntities(url).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://www.lcsd.gov.hk${trimmed}`;
  if (trimmed.startsWith("http://")) return `https://${trimmed.slice("http://".length)}`;
  return trimmed.startsWith("http") ? trimmed : null;
}

function guessDistrict(rawDistrict: string, rawAddress: string) {
  const fromDistrict = normalizeDistrictLabel(rawDistrict);
  if (fromDistrict) return fromDistrict;
  for (const district of DISTRICTS_HK) {
    if (district === "全港") continue;
    if (rawAddress.includes(district)) return district;
    if (rawAddress.includes(district.replace("區", ""))) return district;
  }
  return "全港";
}

function normalizeDistrictLabel(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = normalizeDistrict(trimmed);
  if (direct && direct !== "全港") return direct;

  const englishGuess = normalizeDistrict(`${trimmed} district`);
  if (englishGuess && englishGuess !== "全港") return englishGuess;

  const clean = trimmed.replaceAll("區", "").replace(/district/gi, "").trim().toLowerCase();
  if (!clean) return null;
  for (const district of DISTRICTS_HK) {
    if (district === "全港") continue;
    const canon = district.replaceAll("區", "").trim().toLowerCase();
    if (canon === clean) return district;
  }
  return null;
}

function parseCoordinateValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;

  const dms = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[-:]\s*(\d+(?:\.\d+)?)\s*[-:]\s*(\d+(?:\.\d+)?)$/);
  if (!dms) return null;
  const deg = Number(dms[1]);
  const min = Number(dms[2]);
  const sec = Number(dms[3]);
  if (![deg, min, sec].every(Number.isFinite)) return null;
  const sign = deg < 0 ? -1 : 1;
  return sign * (Math.abs(deg) + min / 60 + sec / 3600);
}

function parseGeometryPoint(row: Record<string, unknown>) {
  const geometry = row.__geometry && typeof row.__geometry === "object" ? (row.__geometry as Record<string, unknown>) : null;
  const coords = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (!coords || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function normalizeLatLng(latitude: number | null, longitude: number | null) {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 20 || latitude > 24) return null;
  if (longitude < 113 || longitude > 115) return null;
  return { latitude, longitude };
}

function classifyParkTypeText(raw: string): ParkType {
  const joined = raw.toLowerCase();
  if (
    joined.includes("狗公園") ||
    joined.includes("dog park") ||
    joined.includes("big dog area") ||
    joined.includes("small dog area")
  ) {
    return "dog";
  }
  if (joined.includes("共享") || joined.includes("pet sharing")) return "shared";
  if (joined.includes("pet garden")) return "shared";
  return "shared";
}

function classifyParkType(row: Record<string, unknown>) {
  return classifyParkTypeText(
    [
      pickString(row, ["type", "type_tc", "facility_type", "category", "category_tc", "park_type"]),
      pickString(row, ["name_tc", "name", "chi_name", "cname", "venue_name", "venue_chi", "title", "名稱"]),
      pickString(row, ["address_tc", "address", "chi_address", "地址"]),
      pickString(row, ["facilities", "Facilities"]),
      pickString(row, ["ancillary_facilities", "Ancillary Facilities"]),
    ].join(" "),
  );
}

function buildImageQueries(name: string) {
  const normalized = name.trim();
  if (!normalized) return [];
  const shortened = normalized
    .replace(/寵物共享公園/g, "")
    .replace(/寵物公園/g, "")
    .replace(/共享公園/g, "")
    .replace(/狗公園/g, "")
    .replace(/公園/g, "")
    .trim();
  const shortPrefix = shortened ? shortened.slice(0, 4).trim() : "";
  return Array.from(
    new Set(
      [
        `${normalized} 香港`,
        `${normalized} 公園 香港`,
        shortened ? `${shortened} 香港` : "",
        shortened ? `${shortened} 公園 香港` : "",
        shortPrefix && shortPrefix !== shortened ? `${shortPrefix} 香港 公園` : "",
      ].filter(Boolean),
    ),
  );
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function tryFetchJson(url: string) {
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Accept: "application/json,text/plain,*/*" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());

  const decodeJson = (encoding: "utf-8" | "big5") => {
    const decoded = new TextDecoder(encoding).decode(buf);
    return JSON.parse(decoded) as unknown;
  };

  let parsed: unknown;
  try {
    parsed = decodeJson("utf-8");
  } catch (error) {
    try {
      parsed = decodeJson("big5");
    } catch {
      throw error instanceof Error ? error : new Error("Failed to parse JSON");
    }
  }

  const maybeLooksBroken = (value: unknown) => {
    if (typeof value !== "string") return false;
    const sample = value.slice(0, 80);
    return /[Σ╛╣╖╜µ]/.test(sample);
  };

  try {
    const obj = parsed as Record<string, unknown>;
    const dgpgRows = extractDgpgRows(obj);
    const dgpgSample = dgpgRows[0] ?? null;
    const ipfpRows = extractIpfpRows(obj);
    const ipfpSample = ipfpRows[0] ?? null;

    const suspicious =
      maybeLooksBroken((dgpgSample as Record<string, unknown> | null)?.Name_cn) ||
      maybeLooksBroken((dgpgSample as Record<string, unknown> | null)?.District_cn) ||
      maybeLooksBroken((ipfpSample as Record<string, unknown> | null)?.NAME_TC) ||
      maybeLooksBroken((ipfpSample as Record<string, unknown> | null)?.DATASET_TC);

    if (!suspicious) return parsed;

    const big5Parsed = decodeJson("big5");
    return big5Parsed;
  } catch {
    return parsed;
  }
}

async function tryFetchText(url: string) {
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.text();
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") return [];

  const source = payload as Record<string, unknown>;
  const directArrays = [
    source,
    source.records,
    source.data,
    source.items,
    source.results,
    source.features,
    (source.result as Record<string, unknown> | undefined)?.records,
    (source.result as Record<string, unknown> | undefined)?.items,
    (source.result as Record<string, unknown> | undefined)?.features,
  ];

  for (const arr of directArrays) {
    if (Array.isArray(arr)) {
      return arr
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const maybeFeature = item as Record<string, unknown>;
          const props =
            maybeFeature.properties && typeof maybeFeature.properties === "object"
              ? (maybeFeature.properties as Record<string, unknown>)
              : maybeFeature;
          const geometry =
            maybeFeature.geometry && typeof maybeFeature.geometry === "object"
              ? (maybeFeature.geometry as Record<string, unknown>)
              : null;
          return geometry ? { ...props, __geometry: geometry } : props;
        })
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
  }

  const firstArray = Object.values(source).find(Array.isArray);
  if (Array.isArray(firstArray)) {
    return firstArray
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const geometry = item.geometry && typeof item.geometry === "object" ? (item.geometry as Record<string, unknown>) : null;
        return geometry ? { ...item, __geometry: geometry } : item;
      });
  }

  return [];
}

type ParkDataset = "dgpg" | "ipfp" | "fallback";

type GovDatasetRow = {
  dataset: ParkDataset;
  row: Record<string, unknown>;
};

function extractDgpgRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  const dgpg = (source.data && typeof source.data === "object" ? (source.data as Record<string, unknown>).dgpg : null) ?? source.dgpg;
  if (Array.isArray(dgpg)) {
    return dgpg.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  return extractRows(payload);
}

function extractIpfpRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  const records =
    (source.data && typeof source.data === "object" ? (source.data as Record<string, unknown>).records : null) ?? source.records;
  if (Array.isArray(records)) {
    return records.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  return extractRows(payload);
}

type FacilityFlags = Pick<GuidePlaceImportPayload, "has_grass" | "has_wash_station" | "has_fencing" | "has_parking">;

type FacilityTagMatcherRow = {
  id: string;
  legacy_key: string | null;
  match_keywords: string[] | null;
};

type FacilityMatch = FacilityFlags & {
  facility_tag_ids: string[];
};

function resolveFacilityMatch(text: string, tags: FacilityTagMatcherRow[]): FacilityMatch {
  const t = text || "";
  const lower = t.toLowerCase();
  const facility_tag_ids: string[] = [];
  const flags: FacilityFlags = { has_grass: false, has_wash_station: false, has_fencing: false, has_parking: false };

  if (tags.length === 0) {
    flags.has_fencing = t.includes("圍欄") || lower.includes("fence") || lower.includes("enclosed");
    flags.has_parking = t.includes("泊車") || t.includes("停車") || lower.includes("car park") || lower.includes("parking");
    flags.has_grass = t.includes("草地") || lower.includes("turf") || lower.includes("grass");
    flags.has_wash_station =
      t.includes("清洗") ||
      t.includes("洗手") ||
      t.includes("狗廁所") ||
      t.includes("飲水機") ||
      lower.includes("hand-washing") ||
      lower.includes("wash") ||
      lower.includes("shower") ||
      lower.includes("water fountain");
    return { facility_tag_ids, ...flags };
  }

  for (const tag of tags) {
    const keywords = Array.isArray(tag.match_keywords) ? tag.match_keywords : [];
    const hit = keywords.some((kw) => {
      const raw = String(kw ?? "").trim();
      if (!raw) return false;
      return t.includes(raw) || lower.includes(raw.toLowerCase());
    });
    if (!hit) continue;
    facility_tag_ids.push(tag.id);
    const legacy = String(tag.legacy_key || "").trim();
    if (legacy === "has_grass") flags.has_grass = true;
    if (legacy === "has_wash_station") flags.has_wash_station = true;
    if (legacy === "has_fencing") flags.has_fencing = true;
    if (legacy === "has_parking") flags.has_parking = true;
  }

  return { facility_tag_ids, ...flags };
}

type BasicGovPlace = {
  name: string;
  address: string;
  districtRaw: string;
  openingHours: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrlSeed: string | null;
  featureText: string;
  parkType: ParkType;
};

function parseDgpgRow(row: Record<string, unknown>): BasicGovPlace | null {
  const name =
    pickString(row, ["Name_C", "Name_cn", "Name_b5", "NAME_TC", "name", "title"]) || pickString(row, [...PARK_NAME_KEYS]);
  const address =
    pickString(row, ["Address_C", "Address_cn", "Address_b5", "ADDRESS_TC", "address"]) || pickString(row, [...PARK_ADDRESS_KEYS]);
  const districtRaw = pickString(row, ["District_C", "District_cn", "District_en", "district"]) || "";
  const openingHours = pickString(row, ["Opening_hours_C", "Opening_hours_cn", "Opening_hours_en", "opening_hours"]) || "";
  const remark =
    pickString(row, ["Remark_C", "Remark_cn", "Remark_b5", "Remark", "Facilities_C", "Facilities_cn", "Facilities_b5", "Facilities"]) ||
    "";
  const ancillary = pickString(row, ["Ancillary_facilities_C", "Ancillary_facilities_cn", "Ancillary_facilities_b5"]) || "";
  const featureText = [remark, ancillary].filter(Boolean).join(" ");
  const imageUrlSeed = pickString(row, ["image_url", "imageUrl"]) || "";

  const geom = parseGeometryPoint(row);
  const lat =
    parseCoordinateValue(row.Latitude) ??
    parseCoordinateValue(row.LATITUDE) ??
    parseCoordinateValue(row.latitude) ??
    parseCoordinateValue(row.lat) ??
    (geom ? geom.lat : null) ??
    pickNumber(row, [...PARK_LATITUDE_KEYS]);
  const lng =
    parseCoordinateValue(row.Longitude) ??
    parseCoordinateValue(row.LONGITUDE) ??
    parseCoordinateValue(row.longitude) ??
    parseCoordinateValue(row.lng) ??
    parseCoordinateValue(row.lon) ??
    (geom ? geom.lng : null) ??
    pickNumber(row, [...PARK_LONGITUDE_KEYS]);

  if (!name || !address) return null;
  const normalized = normalizeLatLng(lat ?? null, lng ?? null);
  return {
    name,
    address,
    districtRaw,
    openingHours: openingHours || null,
    latitude: normalized?.latitude ?? null,
    longitude: normalized?.longitude ?? null,
    imageUrlSeed: imageUrlSeed || null,
    featureText: featureText || "",
    parkType: "dog",
  };
}

function parseIpfpRow(row: Record<string, unknown>): BasicGovPlace | null {
  const name =
    pickString(row, ["Name_cn", "Name_b5", "NAME_TC", "name", "title"]) || pickString(row, [...PARK_NAME_KEYS]);
  const address =
    pickString(row, ["Address_cn", "Address_b5", "ADDRESS_TC", "address"]) || pickString(row, [...PARK_ADDRESS_KEYS]);
  const districtRaw = pickString(row, ["District_cn", "District_en", "SEARCH01_TC", "SEARCH01_EN", "district"]) || "";
  const openingHours = pickString(row, ["Opening_hours_cn", "Opening_hours_en", "NSEARCH02_TC", "NSEARCH02_EN", "opening_hours"]) || "";
  const remark =
    pickString(row, ["Remark_cn", "Remark_b5", "Remark", "Facilities_cn", "Facilities_b5", "Facilities", "SEARCH02_TC", "SEARCH02_EN"]) ||
    "";
  const ancillary = pickString(row, ["Ancillary_facilities_cn", "Ancillary_facilities_b5", "NSEARCH01_TC", "NSEARCH01_EN"]) || "";
  const featureText = [remark, ancillary].filter(Boolean).join(" ");
  const imageUrlSeed = pickString(row, ["image_url", "imageUrl"]) || "";

  const geom = parseGeometryPoint(row);
  const lat =
    parseCoordinateValue(row.LATITUDE) ??
    parseCoordinateValue(row.Latitude) ??
    parseCoordinateValue(row.latitude) ??
    parseCoordinateValue(row.lat) ??
    (geom ? geom.lat : null) ??
    pickNumber(row, [...PARK_LATITUDE_KEYS]);
  const lng =
    parseCoordinateValue(row.LONGITUDE) ??
    parseCoordinateValue(row.Longitude) ??
    parseCoordinateValue(row.longitude) ??
    parseCoordinateValue(row.lng) ??
    parseCoordinateValue(row.lon) ??
    (geom ? geom.lng : null) ??
    pickNumber(row, [...PARK_LONGITUDE_KEYS]);

  if (!name || !address) return null;
  const normalized = normalizeLatLng(lat ?? null, lng ?? null);
  return {
    name,
    address,
    districtRaw,
    openingHours: openingHours || null,
    latitude: normalized?.latitude ?? null,
    longitude: normalized?.longitude ?? null,
    imageUrlSeed: imageUrlSeed || null,
    featureText: featureText || "",
    parkType: "shared",
  };
}

function parseFallbackRow(row: Record<string, unknown>): BasicGovPlace | null {
  const name = pickString(row, ["name", "title", ...PARK_NAME_KEYS]) || "";
  const address = pickString(row, ["address", ...PARK_ADDRESS_KEYS]) || "";
  if (!name || !address) return null;
  const districtRaw = pickString(row, ["district", "District_cn", "District_en"]) || "";
  const openingHours = pickString(row, ["opening_hours", "Opening Hours"]) || "";
  const featureText = [
    pickString(row, ["facilities", "Facilities"]),
    pickString(row, ["ancillary_facilities", "Ancillary Facilities"]),
  ]
    .filter(Boolean)
    .join(" ");
  const parkType = classifyParkTypeText(`${name} ${featureText}`);
  const imageUrlSeed = pickString(row, ["image_url", "imageUrl"]) || "";
  const geom = parseGeometryPoint(row);
  const lat = pickNumber(row, [...PARK_LATITUDE_KEYS]) ?? (geom ? geom.lat : null);
  const lng = pickNumber(row, [...PARK_LONGITUDE_KEYS]) ?? (geom ? geom.lng : null);
  const normalized = normalizeLatLng(lat ?? null, lng ?? null);

  return {
    name,
    address,
    districtRaw,
    openingHours: openingHours || null,
    latitude: normalized?.latitude ?? null,
    longitude: normalized?.longitude ?? null,
    imageUrlSeed: imageUrlSeed || null,
    featureText,
    parkType,
  };
}

function extractTableCell(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<td[^>]*>\\s*${escaped}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const match = block.match(pattern);
  return normalizeWhitespace(match?.[1] || "");
}

async function fetchLcsdFallbackRows() {
  const html = await tryFetchText(LCSD_PARK_LIST_URL);
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const rows: Record<string, unknown>[] = [];

  for (const table of tables) {
    const name = extractTableCell(table, "Name of Venue");
    const address = extractTableCell(table, "Address");
    if (!name || !address) continue;

    const facilities = extractTableCell(table, "Facilities");
    const ancillary = extractTableCell(table, "Ancillary Facilities");
    const openingHours = extractTableCell(table, "Opening Hours");
    const district = guessDistrict("", address);
    const imageMatches = Array.from(table.matchAll(/<img[^>]+src="([^"]+)"/gi));
    const imageUrl = normalizeImageUrl(imageMatches[0]?.[1] || "");
    const facilityText = `${name} ${facilities} ${ancillary}`;

    rows.push({
      name,
      address,
      district,
      opening_hours: openingHours || null,
      facilities,
      ancillary_facilities: ancillary,
      park_type: classifyParkTypeText(facilityText),
      image_url: imageUrl,
    });
  }

  return rows;
}

async function fetchGovernmentParkRows() {
  const failures: string[] = [];
  const mergedRows: GovDatasetRow[] = [];

  const dgpg = GOV_PARK_DATASETS.find((d) => d.parkType === "dog");
  const ipfp = GOV_PARK_DATASETS.find((d) => d.parkType === "shared");

  if (dgpg) {
    try {
      const json = await tryFetchJson(dgpg.url);
      const rows = extractDgpgRows(json);
      if (rows.length > 0) {
        console.log("DGPG Sample:", rows[0]);
        mergedRows.push(...rows.map((row) => ({ dataset: "dgpg" as const, row })));
      } else {
        failures.push(`${dgpg.url}: empty`);
      }
    } catch (error) {
      failures.push(`${dgpg.url}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (ipfp) {
    try {
      const json = await tryFetchJson(ipfp.url);
      const rows = extractIpfpRows(json);
      if (rows.length > 0) {
        console.log("IPFP Sample:", rows[0]);
        mergedRows.push(...rows.map((row) => ({ dataset: "ipfp" as const, row })));
      } else {
        failures.push(`${ipfp.url}: empty`);
      }
    } catch (error) {
      failures.push(`${ipfp.url}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (mergedRows.length > 0) return mergedRows;

  try {
    const rows = await fetchLcsdFallbackRows();
    if (rows.length > 0) return rows.map((row) => ({ dataset: "fallback" as const, row }));
    failures.push(`${LCSD_PARK_LIST_URL}: empty`);
  } catch (error) {
    failures.push(`${LCSD_PARK_LIST_URL}: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  throw new Error(`無法取得政府公園資料。${failures.join(" | ")}`);
}

async function fetchWikipediaImage(query: string) {
  const url = `https://zh.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(
    query,
  )}&gsrlimit=1&prop=pageimages&piprop=original|thumbnail&pithumbsize=1200&origin=*`;
  try {
    const res = await fetchWithTimeout(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | {
          query?: {
            pages?: Record<string, { original?: { source?: string }; thumbnail?: { source?: string } }>;
          };
        }
      | null;
    const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
    for (const page of pages) {
      const image = page.original?.source || page.thumbnail?.source || "";
      if (image.startsWith("http")) return image;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchDuckDuckGoImage(query: string) {
  try {
    const html = await tryFetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    const patterns = [
      /<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i,
      /<img[^>]+data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i,
      /(https?:\/\/[^"' >]+\.(?:jpg|jpeg|png|webp)(?:\?[^"' >]*)?)/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const candidate = decodeHtmlEntities(match?.[1] || "");
      if (candidate.startsWith("http")) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveImageUrl(parkName: string, existingImageUrl?: string | null) {
  if (existingImageUrl?.trim()) return existingImageUrl.trim();
  const queries = buildImageQueries(parkName);
  for (const query of queries) {
    const wikiImage = await fetchWikipediaImage(query);
    if (wikiImage) return wikiImage;
  }
  for (const query of queries.slice(0, 3)) {
    const duckImage = await fetchDuckDuckGoImage(query);
    if (duckImage) return duckImage;
  }
  return null;
}

async function geocodeAddress(address: string) {
  try {
    const res = await fetchWithTimeout(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(`${address}, Hong Kong`)}&limit=1&lang=en`,
      { method: "GET", cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { features?: Array<{ geometry?: { coordinates?: [number, number] } }> }
      | null;
    const coords = Array.isArray(json?.features?.[0]?.geometry?.coordinates)
      ? json.features?.[0]?.geometry?.coordinates
      : null;
    if (!coords || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

type MapOutcome =
  | { ok: true; item: PreparedParkRow }
  | { ok: false; name: string; reason: string };

async function mapGovernmentRow(
  input: GovDatasetRow,
  categoryId: string,
  sharedSubcategoryId: string,
  dogSubcategoryId: string,
  facilityTags: FacilityTagMatcherRow[],
): Promise<MapOutcome> {
  const basic =
    input.dataset === "dgpg"
      ? parseDgpgRow(input.row)
      : input.dataset === "ipfp"
        ? parseIpfpRow(input.row)
        : parseFallbackRow(input.row);

  const fallbackName = basic?.name || "未命名公園";
  if (!basic) return { ok: false, name: fallbackName, reason: "缺少必要欄位（名稱/地址）" };

  const coords = normalizeLatLng(basic.latitude, basic.longitude);
  if (!coords) return { ok: false, name: basic.name, reason: "缺少或非法座標（請修正匯入欄位解析）" };
  const { latitude, longitude } = coords;

  const districtRaw = basic.districtRaw ? basic.districtRaw.replaceAll("區", "").trim() : "";
  const district = guessDistrict(districtRaw, basic.address);
  const facility = resolveFacilityMatch(basic.featureText, facilityTags);

  return {
    ok: true,
    item: {
      category_id: categoryId,
      subcategory_id: basic.parkType === "dog" ? dogSubcategoryId : sharedSubcategoryId,
      subcategory_ids: [basic.parkType === "dog" ? dogSubcategoryId : sharedSubcategoryId],
      name: basic.name,
      district,
      address: basic.address,
      opening_hours: basic.openingHours,
      plus_code: null,
      latitude,
      longitude,
      image_urls: basic.imageUrlSeed ? [basic.imageUrlSeed] : [],
      ...facility,
      image_url_seed: basic.imageUrlSeed,
    },
  };
}

export async function POST() {
  try {
    const guard = await assertAdminServer();
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const admin = supabaseAdmin();
    const [{ data: categories, error: categoriesError }, { data: subcategories, error: subcategoriesError }] =
      await Promise.all([
        admin.schema("public").from("guide_categories").select("id,name"),
        admin.schema("public").from("guide_subcategories").select("id,category_id,name"),
      ]);

    if (categoriesError) return NextResponse.json({ error: categoriesError.message }, { status: 500 });
    if (subcategoriesError) return NextResponse.json({ error: subcategoriesError.message }, { status: 500 });
    let activeFacilityTags: FacilityTagMatcherRow[] = [];
    let facilityTagsWarning: string | null = null;
    try {
      const { data: facilityTags, error: facilityTagsError } = await admin
        .schema("public")
        .from("facility_tags")
        .select("id,legacy_key,match_keywords")
        .eq("is_active", true);
      if (facilityTagsError) {
        facilityTagsWarning = facilityTagsError.message;
        console.log("facility_tags 讀取失敗，暫用 legacy boolean 映射：", facilityTagsError.message);
      } else {
        activeFacilityTags = (facilityTags ?? []) as FacilityTagMatcherRow[];
      }
    } catch (err) {
      facilityTagsWarning = err instanceof Error && err.message ? err.message : "facility_tags 讀取失敗";
      console.log("facility_tags 讀取失敗，暫用 legacy boolean 映射：", facilityTagsWarning);
    }

    const parkCategory = ((categories ?? []) as GuideCategoryRow[]).find((item) => item.name.trim() === "寵物公園");
    if (!parkCategory) {
      return NextResponse.json(
        { error: "找不到「寵物公園」大分類，請先確認資料庫 `guide_categories.name` 完全一致。" },
        { status: 400 },
      );
    }

    const parkSubcategories = ((subcategories ?? []) as GuideSubcategoryRow[]).filter(
      (item) => item.category_id === parkCategory.id,
    );
    const sharedSubcategory = parkSubcategories.find((item) => item.name.trim() === "寵物共享公園");
    const dogSubcategory = parkSubcategories.find((item) => item.name.trim() === "專用狗公園");
    if (!sharedSubcategory || !dogSubcategory) {
      return NextResponse.json(
        { error: "找不到「寵物共享公園」或「專用狗公園」子分類，請先確認資料庫 `guide_subcategories.name` 完全一致。" },
        { status: 400 },
      );
    }

    const govRows = await fetchGovernmentParkRows();
    const dedupedMap = new Map<string, GovDatasetRow>();
    for (const item of govRows) {
      const basic =
        item.dataset === "dgpg" ? parseDgpgRow(item.row) : item.dataset === "ipfp" ? parseIpfpRow(item.row) : parseFallbackRow(item.row);
      const name = basic?.name || "";
      const address = basic?.address || "";
      if (!name || !address) {
        console.log("跳過:", name || "未命名公園", "原因: 缺少名稱或地址");
        continue;
      }
      dedupedMap.set(`${name}__${address}`, item);
    }

    const dedupedRows = Array.from(dedupedMap.values());
    const items: Array<{ id: string; name: string; address: string }> = [];
    const failures: Array<{ name: string; error: string }> = [];
    let withImages = 0;

    for (const row of dedupedRows) {
      const basic =
        row.dataset === "dgpg" ? parseDgpgRow(row.row) : row.dataset === "ipfp" ? parseIpfpRow(row.row) : parseFallbackRow(row.row);
      const fallbackName = basic?.name || "未命名公園";

      try {
        const outcome = await mapGovernmentRow(row, parkCategory.id, sharedSubcategory.id, dogSubcategory.id, activeFacilityTags);
        if (!outcome.ok) {
          console.log("跳過:", outcome.name, "原因:", outcome.reason);
          failures.push({ name: outcome.name, error: outcome.reason });
          continue;
        }
        const mapped = outcome.item;

        let image_url: string | null = null;
        try {
          image_url = await resolveImageUrl(mapped.name, mapped.image_url_seed);
        } catch {
          image_url = mapped.image_url_seed ?? null;
        }

        const payload: GuidePlaceImportPayload = {
          category_id: mapped.category_id,
          subcategory_id: mapped.subcategory_id,
          subcategory_ids: mapped.subcategory_ids,
          source: "government",
          status: "pending",
          name: mapped.name,
          district: mapped.district,
          address: mapped.address,
          opening_hours: mapped.opening_hours,
          plus_code: null,
          latitude: mapped.latitude,
          longitude: mapped.longitude,
          image_url,
          image_urls: image_url ? [image_url] : [],
          facility_tag_ids: mapped.facility_tag_ids,
          has_grass: mapped.has_grass,
          has_wash_station: mapped.has_wash_station,
          has_fencing: mapped.has_fencing,
          has_parking: mapped.has_parking,
        };

        console.log("正在匯入:", payload.name, "分類:", payload.subcategory_id);

        const { data, error } = await admin
          .schema("public")
          .from("staged_places")
          .upsert(payload, { onConflict: "name,address" })
          .select("id,name,address")
          .single();

        if (error) {
          failures.push({ name: mapped.name, error: error.message });
          continue;
        }

        if (image_url) withImages += 1;
        if (data) items.push(data as { id: string; name: string; address: string });
      } catch (error) {
        failures.push({
          name: fallbackName,
          error: error instanceof Error && error.message ? error.message : "未知錯誤",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      imported: items.length,
      withImages,
      failed: failures.length,
      facilityTagsWarning,
      failures,
      items,
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "匯入政府公園時發生未知錯誤";
    console.error("import-parks failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
