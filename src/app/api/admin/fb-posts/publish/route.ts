export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { reverseGeocodeDistrict } from "@/lib/pets/district";
import type { PetInsert } from "@/lib/pets/db";
import { supabaseAdmin } from "@/lib/supabase/admin";

type PublishBody = {
  id?: string;
  overrides?: {
    pet_type?: "cat" | "dog" | "bird" | "other" | null;
    breed?: string | null;
    location?: string | null;
    contact_phone?: string | null;
  };
  pet?: Partial<PetInsert>;
};

type FbPostRow = {
  id: string;
  post_url: string;
  post_created_at: string | null;
  content_text: string | null;
  image_urls: unknown;
  ai_result: unknown;
};

type AiExtract = {
  pet_type?: "cat" | "dog" | "bird" | "other" | null;
  breed?: string | null;
  location?: string | null;
  characteristics?: string | null;
  contact_phone?: string | null;
};

type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

type PhotonGeoJson = {
  features?: PhotonFeature[];
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeExternalUrl(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  if (/^(m\.)?facebook\.com\//i.test(s)) return `https://${s}`;
  if (/^fb\.watch\//i.test(s)) return `https://${s}`;
  return s;
}

function asNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildLabel(props: Record<string, unknown>, fallback: string) {
  const name = asString(props.name);
  const street = asString(props.street);
  const district = asString(props.district) || asString(props.city);
  return [name, street, district].filter(Boolean).join(", ") || fallback;
}

async function geocodeHongKong(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
    trimmed,
  )}&bbox=113.8,22.1,114.4,22.6&limit=1`;
  const response = await fetch(photonUrl, { method: "GET", cache: "no-store" });
  if (!response.ok) return null;
  const geojson = (await response.json().catch(() => null)) as PhotonGeoJson | null;
  const first = Array.isArray(geojson?.features) ? geojson!.features![0] : null;
  const props = (first?.properties && typeof first.properties === "object" ? first.properties : {}) as Record<string, unknown>;
  const coordsRaw = (first?.geometry as any)?.coordinates;
  const coords = Array.isArray(coordsRaw) ? coordsRaw : null;
  const lng = coords ? asNumber(coords[0]) : null;
  const lat = coords ? asNumber(coords[1]) : null;
  if (lat == null || lng == null) return null;
  return { lat, lng, label: buildLabel(props, trimmed) };
}

function pickAiExtract(aiResult: unknown): AiExtract {
  if (!aiResult || typeof aiResult !== "object" || Array.isArray(aiResult)) return {};
  const r = aiResult as Record<string, unknown>;
  const petType = r.pet_type;
  const pet_type =
    petType === "cat" || petType === "dog" || petType === "bird" || petType === "other" ? petType : null;
  const breed = typeof r.breed === "string" ? r.breed.trim() : null;
  const location = typeof r.location === "string" ? r.location.trim() : null;
  const characteristics = typeof r.characteristics === "string" ? r.characteristics.trim() : null;
  const contact_phone = typeof r.contact_phone === "string" ? r.contact_phone.trim() : null;
  return { pet_type, breed: breed || null, location: location || null, characteristics: characteristics || null, contact_phone: contact_phone || null };
}

function normalizeOverride(body: PublishBody["overrides"]): AiExtract {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!raw) return {};
  const out: AiExtract = {};

  if (raw.pet_type === "cat" || raw.pet_type === "dog" || raw.pet_type === "bird" || raw.pet_type === "other") {
    out.pet_type = raw.pet_type;
  }
  if (raw.pet_type === null) out.pet_type = null;

  if (typeof raw.breed === "string") out.breed = raw.breed.trim() || null;
  if (raw.breed === null) out.breed = null;

  if (typeof raw.location === "string") out.location = raw.location.trim() || null;
  if (raw.location === null) out.location = null;

  if (typeof raw.contact_phone === "string") out.contact_phone = raw.contact_phone.trim() || null;
  if (raw.contact_phone === null) out.contact_phone = null;

  return out;
}

function detectCaseType(text: string) {
  const t = text;
  if (/(救起|救到|拾獲|已救起)/i.test(t)) return "found_rescued";
  if (/(目擊|見到|見過|發現|出沒|徘徊)/i.test(t)) return "spotted_unrescued";
  return "lost";
}

function pickSourceType(caseType: string) {
  if (caseType === "found_rescued") return "repost_rescued";
  if (caseType === "spotted_unrescued") return "repost_sighting";
  return "repost_owner";
}

function buildPetName(ai: AiExtract) {
  if (ai.breed) return ai.breed;
  if (ai.pet_type === "bird") return "鸚鵡";
  if (ai.pet_type === "dog") return "狗狗";
  if (ai.pet_type === "cat") return "貓貓";
  return "毛孩";
}

function buildFeatures(ai: AiExtract, content: string) {
  const parts = [];
  if (ai.characteristics) parts.push(ai.characteristics);
  if (ai.breed) parts.push(`品種：${ai.breed}`);
  const snippet = content.trim().slice(0, 120);
  if (snippet) parts.push(`貼文摘要：${snippet}`);
  return parts.join(" / ") || "未提供";
}

function pickImageUrl(imageUrls: unknown) {
  if (!Array.isArray(imageUrls)) return "";
  const first = imageUrls.map(String).map((s) => s.trim()).find(Boolean);
  return first || "";
}

function normalizePetOverride(raw: PublishBody["pet"]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<PetInsert> = {};

  if (typeof r.pet_name === "string") out.pet_name = r.pet_name.trim();
  if (r.pet_type === "cat" || r.pet_type === "dog" || r.pet_type === "bird" || r.pet_type === "other") {
    out.pet_type = r.pet_type;
  }
  if (typeof r.breed === "string") out.breed = r.breed.trim() || null;
  if (r.breed === null) out.breed = null;
  if (typeof r.location === "string") out.location = r.location.trim();
  if (typeof r.manual_address === "string") out.manual_address = r.manual_address.trim() || null;
  if (typeof r.district === "string") out.district = r.district.trim() || null;
  if (typeof r.lost_time === "string") out.lost_time = r.lost_time.trim();
  if (typeof r.features === "string") out.features = r.features.trim();
  if (typeof r.phone === "string") out.phone = r.phone.trim();
  if (typeof r.enable_privacy === "boolean") out.enable_privacy = r.enable_privacy;
  if (typeof r.image_url === "string") out.image_url = r.image_url.trim();
  if (typeof r.source_url === "string") out.source_url = normalizeExternalUrl(r.source_url);
  if (typeof r.source_link === "string") out.source_link = normalizeExternalUrl(r.source_link) || null;
  if (typeof r.source_type === "string") out.source_type = r.source_type as any;
  if (r.case_type === "lost" || r.case_type === "spotted_unrescued" || r.case_type === "found_rescued") {
    out.case_type = r.case_type;
  }
  if (typeof r.latitude !== "undefined") {
    const lat = asNumber(r.latitude);
    if (lat != null) out.latitude = lat;
  }
  if (typeof r.longitude !== "undefined") {
    const lng = asNumber(r.longitude);
    if (lng != null) out.longitude = lng;
  }
  if (Array.isArray(r.timeline)) out.timeline = r.timeline as any;

  return out;
}

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: PublishBody = {};
  try {
    body = (await req.json()) as PublishBody;
  } catch {}

  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: fbPost, error: fbError } = await admin
    .from("fb_group_posts")
    .select("id,post_url,post_created_at,content_text,image_urls,ai_result,ai_status")
    .eq("id", id)
    .maybeSingle();

  if (fbError) return NextResponse.json({ error: fbError.message }, { status: 500 });
  if (!fbPost) return NextResponse.json({ error: "FB post not found" }, { status: 404 });
  if ((fbPost as any).ai_status !== "done") {
    return NextResponse.json({ error: "FB post is not ai_status=done" }, { status: 400 });
  }

  const row = fbPost as FbPostRow;
  const postUrl = normalizeExternalUrl(String(row.post_url || ""));
  if (!postUrl) return NextResponse.json({ error: "Missing post_url" }, { status: 400 });

  const { data: existing, error: existingError } = await admin
    .from("pets")
    .select("id")
    .eq("source_url", postUrl)
    .maybeSingle();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (existing?.id) return NextResponse.json({ error: "Already published" }, { status: 409 });

  const aiBase = pickAiExtract(row.ai_result);
  const overrides = normalizeOverride(body.overrides);
  const ai: AiExtract = { ...aiBase, ...overrides };

  const petOverride = normalizePetOverride(body.pet);
  const location = String(petOverride?.location || ai.location || "").trim();
  if (!location) return NextResponse.json({ error: "Missing location" }, { status: 400 });

  const overrideLat = typeof petOverride?.latitude === "number" && Number.isFinite(petOverride.latitude) ? petOverride.latitude : null;
  const overrideLng = typeof petOverride?.longitude === "number" && Number.isFinite(petOverride.longitude) ? petOverride.longitude : null;

  const geocoded =
    overrideLat != null && overrideLng != null ? { lat: overrideLat, lng: overrideLng, label: location } : await geocodeHongKong(location);
  if (!geocoded) return NextResponse.json({ error: "Geocoding failed for location" }, { status: 400 });

  const district =
    typeof petOverride?.district === "string" && petOverride.district.trim()
      ? petOverride.district.trim()
      : await reverseGeocodeDistrict(geocoded.lat, geocoded.lng);

  const content = String(row.content_text || "").trim();
  const inferredCaseType = detectCaseType(content);
  const caseType = (petOverride?.case_type as any) || inferredCaseType;
  const inferredSourceType = pickSourceType(caseType);
  const sourceType = (petOverride?.source_type as any) || inferredSourceType;
  const nowIso = new Date().toISOString();
  const lostTime = String(petOverride?.lost_time || row.post_created_at || nowIso);

  if (body.overrides && Object.keys(overrides).length) {
    const merged = {
      ...(row.ai_result && typeof row.ai_result === "object" && !Array.isArray(row.ai_result)
        ? (row.ai_result as Record<string, unknown>)
        : {}),
      ...overrides,
      admin_override: true,
      admin_override_at: nowIso,
    };
    await admin.from("fb_group_posts").update({ ai_result: merged }).eq("id", row.id);
  }

  const payload: PetInsert = {
    user_id: null,
    pet_name: String(petOverride?.pet_name || buildPetName(ai)).trim() || buildPetName(ai),
    pet_type: (petOverride?.pet_type as any) || ai.pet_type || "other",
    breed: typeof petOverride?.breed === "string" ? petOverride.breed.trim() || null : ai.breed || null,
    location,
    manual_address: petOverride?.manual_address ?? null,
    district: district || null,
    lost_time: lostTime,
    features: String(petOverride?.features || buildFeatures(ai, content)).trim() || buildFeatures(ai, content),
    phone: String(petOverride?.phone || ai.contact_phone || "—").trim() || "—",
    enable_privacy: typeof petOverride?.enable_privacy === "boolean" ? petOverride.enable_privacy : true,
    image_url: String(petOverride?.image_url || pickImageUrl(row.image_urls)).trim() || "",
    source_url: normalizeExternalUrl(String(petOverride?.source_url || postUrl)) || postUrl,
    source_type: sourceType,
    source_link: normalizeExternalUrl(String(petOverride?.source_link || postUrl)) || postUrl,
    case_type: caseType,
    status: "approved",
    latitude: geocoded.lat,
    longitude: geocoded.lng,
    timeline: (petOverride?.timeline as any) ?? null,
  };

  const { data: inserted, error: insertError } = await admin.from("pets").insert(payload).select("id").single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true, pet_id: inserted.id });
}
