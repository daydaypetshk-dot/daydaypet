export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { geocodeIfNeeded, normalizeApifyPayload } from "@/lib/pets/normalize";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PetInsert } from "@/lib/pets/db";

function getSecret(req: Request) {
  const header =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-apify-webhook-secret") ??
    req.headers.get("authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] ?? header).trim();
}

function pickDatasetId(payload: any) {
  return (
    payload?.resource?.defaultDatasetId ??
    payload?.defaultDatasetId ??
    payload?.data?.defaultDatasetId ??
    payload?.eventData?.resource?.defaultDatasetId ??
    null
  );
}

async function fetchApifyDatasetItems(datasetId: string) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return null;
  const params = new URLSearchParams({
    token,
    clean: "true",
    format: "json",
  });
  const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?${params.toString()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const expected = process.env.APIFY_WEBHOOK_SECRET;
  if (!expected) {
    return Response.json({ error: "Missing APIFY_WEBHOOK_SECRET" }, { status: 500 });
  }
  const got = getSecret(req);
  if (!got || got !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const firstPass = normalizeApifyPayload(payload);
  const datasetId =
    firstPass.items.length === 0 && payload && typeof payload === "object"
      ? pickDatasetId(payload as any)
      : null;
  const fetchedItems = datasetId ? await fetchApifyDatasetItems(datasetId) : null;
  const { items: normalized, rejected } = fetchedItems
    ? normalizeApifyPayload(fetchedItems)
    : firstPass;
  const withGeo = await geocodeIfNeeded(normalized);
  const insertable = withGeo.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng));
  const missingCoords = withGeo.length - insertable.length;

  if (insertable.length > 0) {
    const rows: PetInsert[] = insertable.map((i) => ({
      user_id: null,
      pet_name: i.petName,
      pet_type: "other",
      breed: null,
      location: i.location || "",
      manual_address: null,
      district: null,
      lost_time: i.lostTime || "",
      features: i.features || "",
      phone: i.phone || "",
      enable_privacy: true,
      image_url: i.imageUrl || "",
      source_url: i.sourceUrl,
      source_type: i.kind === "sighting" ? "repost_sighting" : "repost_owner",
      source_link: i.sourceUrl || null,
      case_type: i.kind === "sighting" ? "spotted_unrescued" : "lost",
      status: "pending",
      latitude: i.lat,
      longitude: i.lng,
    }));
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("pets").upsert(rows, { onConflict: "source_url" });
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  return Response.json({
    ok: true,
    received: normalized.length,
    rejected,
    inserted: insertable.length,
    missingCoords,
    datasetFetched: Boolean(fetchedItems),
  });
}
