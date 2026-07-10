import type { PetCaseInput } from "./types";

function pickString(v: unknown) {
  return typeof v === "string" ? v : "";
}

function pickNumber(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractPhone(text: string) {
  const normalized = text.replace(/[\u200b-\u200d\uFEFF]/g, " ");
  const m = normalized.match(/\b([2-9]\d{3})\s?(\d{4})\b/);
  if (!m) return "";
  return `${m[1]} ${m[2]}`;
}

function firstImageUrl(item: any) {
  if (typeof item?.imageUrl === "string") return item.imageUrl;
  if (typeof item?.image === "string") return item.image;
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  for (const a of attachments) {
    const uri = a?.image?.uri ?? a?.imageUrl ?? a?.url;
    if (typeof uri === "string" && uri.startsWith("http")) return uri;
  }
  const images = Array.isArray(item?.images) ? item.images : [];
  for (const u of images) {
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  const carousel = Array.isArray(item?.carousel_media_images) ? item.carousel_media_images : [];
  for (const u of carousel) {
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  const threadsImage =
    item?.image_versions2?.candidates?.[0]?.url ?? item?.profile?.profile_pic_url;
  if (typeof threadsImage === "string" && threadsImage.startsWith("http")) return threadsImage;
  return "";
}

function inferKind(text: string) {
  const t = text.toLowerCase();
  const lostHints = ["走失", "遺失", "missing", "lost", "尋貓", "尋狗", "lost pet", "lost cat", "lost dog"];
  const sightHints = ["目擊", "found", "seen", "報料", "found pet"];
  if (lostHints.some((k) => t.includes(k))) return "lost" as const;
  if (sightHints.some((k) => t.includes(k))) return "sighting" as const;
  return undefined;
}

export type ApifyNormalizedBatch = {
  items: PetCaseInput[];
  rejected: number;
};

export function normalizeApifyPayload(payload: unknown): ApifyNormalizedBatch {
  const rawItems = (() => {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      const p: any = payload;
      if (Array.isArray(p.items)) return p.items;
      if (Array.isArray(p.datasetItems)) return p.datasetItems;
      if (Array.isArray(p.data)) return p.data;
    }
    return [];
  })();

  const items: PetCaseInput[] = [];
  let rejected = 0;

  for (const raw of rawItems) {
    try {
      const r: any = raw;
      const text =
        pickString(r.text) ||
        pickString(r.caption?.text) ||
        pickString(r.postText) ||
        pickString(r.description) ||
        "";
      const petName =
        pickString(r.petName) ||
        pickString(r.name) ||
        pickString(r.title) ||
        pickString(r.postTitle) ||
        "";
      const location =
        pickString(r.location) ||
        pickString(r.locationName) ||
        pickString(r.place?.name) ||
        pickString(r.address) ||
        "";
      const lostTime =
        pickString(r.lostTime) ||
        pickString(r.time) ||
        pickString(r.published) ||
        pickString(r.taken_at) ||
        "";
      const features = pickString(r.features) || pickString(r.details) || text;
      const phone = pickString(r.phone) || extractPhone(text);
      const imageUrl = firstImageUrl(r);
      const sourceUrl =
        pickString(r.sourceUrl) || pickString(r.url) || pickString(r.postUrl) || pickString(r.facebookUrl);
      const lat =
        pickNumber(r.lat) ??
        pickNumber(r.latitude) ??
        pickNumber(r.location?.lat) ??
        pickNumber(r.place?.lat) ??
        pickNumber(r.place?.latitude);
      const lng =
        pickNumber(r.lng) ??
        pickNumber(r.longitude) ??
        pickNumber(r.location?.lng) ??
        pickNumber(r.place?.lng) ??
        pickNumber(r.place?.longitude);
      const sourceLabel =
        pickString(r.sourceLabel) ||
        pickString(r.groupTitle) ||
        pickString(r.profile?.username) ||
        pickString(r.user?.name) ||
        "";
      const kind = inferKind(`${petName} ${text}`);

      if (!sourceUrl) {
        rejected += 1;
        continue;
      }

      items.push({
        id: pickString(r.id) || pickString(r.legacyId) || undefined,
        petName: petName || "（未命名）",
        location,
        lostTime: typeof lostTime === "string" ? lostTime : "",
        features,
        phone,
        imageUrl,
        sourceUrl,
        lat: lat ?? NaN,
        lng: lng ?? NaN,
        sourceLabel: sourceLabel || undefined,
        kind,
      });
    } catch {
      rejected += 1;
    }
  }

  return { items, rejected };
}

export async function geocodeIfNeeded(items: PetCaseInput[]) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return items;

  const out: PetCaseInput[] = [];
  for (const it of items) {
    if (Number.isFinite(it.lat) && Number.isFinite(it.lng)) {
      out.push(it);
      continue;
    }
    const location = (it.location ?? "").trim();
    if (!location) {
      out.push(it);
      continue;
    }
    const params = new URLSearchParams({
      address: location,
      key: apiKey,
      region: "hk",
    });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        out.push(it);
        continue;
      }
      const json: any = await res.json();
      const loc = json?.results?.[0]?.geometry?.location;
      const lat = typeof loc?.lat === "number" ? loc.lat : null;
      const lng = typeof loc?.lng === "number" ? loc.lng : null;
      if (lat == null || lng == null) {
        out.push(it);
        continue;
      }
      out.push({ ...it, lat, lng });
    } catch {
      out.push(it);
    }
  }
  return out;
}

