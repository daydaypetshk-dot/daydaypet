export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type StagedPlaceStatus = "pending" | "approved" | "rejected";

type StagedPlaceRow = {
  id: string;
  category_id: string;
  subcategory_id: string;
  subcategory_ids: string[];
  name: string;
  district: string;
  address: string;
  opening_hours: string | null;
  plus_code: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  image_urls: string[];
  facility_tag_ids: string[];
  has_grass: boolean;
  has_wash_station: boolean;
  has_fencing: boolean;
  has_parking: boolean;
  metadata: unknown;
  status: StagedPlaceStatus;
  source: string;
  created_at: string;
  updated_at: string;
};

type UpdateBody = Partial<{
  id: string;
  category_id: string;
  subcategory_id: string;
  subcategory_ids: unknown;
  name: string;
  district: string;
  address: string;
  opening_hours: string | null;
  plus_code: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  image_urls: unknown;
  facility_tag_ids: unknown;
  has_grass: boolean;
  has_wash_station: boolean;
  has_fencing: boolean;
  has_parking: boolean;
  metadata: unknown;
  status: StagedPlaceStatus;
  source: string;
}>;

function normalizeNullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function normalizeUuidArray(value: unknown) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、|/]/g) : [];
  return items
    .map((v) => String(v ?? "").trim())
    .filter((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
}

function normalizeSubcategoryIds(value: unknown, fallback?: unknown) {
  const ids = normalizeUuidArray(value);
  if (ids.length > 0) return ids;
  const single = String(fallback ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(single) ? [single] : [];
}

function normalizeUrlArray(value: unknown) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,，、|]/g) : [];
  return items
    .map((v) => String(v ?? "").trim())
    .filter((v) => /^https?:\/\//i.test(v));
}

function getPrimaryImageUrl(image_urls: string[], image_url?: unknown) {
  const first = image_urls.find(Boolean);
  if (first) return first;
  return normalizeNullableText(image_url);
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，、|/]/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeMetadata(value: unknown) {
  if (value === null) return {};
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...obj };
  if ("is_24h_emergency" in next) next.is_24h_emergency = normalizeBoolean(next.is_24h_emergency);
  if ("specialist_services" in next) next.specialist_services = normalizeStringArray(next.specialist_services);
  if ("booking_url" in next) next.booking_url = String(next.booking_url ?? "").trim();
  if ("pet_types_supported" in next) next.pet_types_supported = normalizeStringArray(next.pet_types_supported);
  return next;
}

function normalizeStatus(value: unknown): StagedPlaceStatus | null {
  const raw = String(value ?? "").trim();
  if (raw === "pending" || raw === "approved" || raw === "rejected") return raw;
  return null;
}

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const status = normalizeStatus(url.searchParams.get("status")) ?? "pending";
  const q = String(url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSizeRaw = Number(url.searchParams.get("pageSize") || 20) || 20;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = supabaseAdmin();
  let query = admin
    .from("staged_places")
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata,status,source,created_at,updated_at",
      { count: "exact" },
    )
    .eq("status", status)
    .order("created_at", { ascending: true });

  if (q) {
    const term = q.replaceAll(",", "").replaceAll(":", "").trim();
    if (term) query = query.or(`name.ilike.%${term}%,district.ilike.%${term}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data ?? []) as StagedPlaceRow[],
    total: count ?? 0,
    page,
    pageSize,
    status,
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const nextStatus = body.status !== undefined ? normalizeStatus(body.status) : null;
  if (body.status !== undefined && !nextStatus) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  const image_urls = body.image_urls !== undefined ? normalizeUrlArray(body.image_urls) : undefined;
  const payload = {
    category_id: body.category_id ? String(body.category_id).trim() : undefined,
    subcategory_id:
      body.subcategory_ids !== undefined || body.subcategory_id !== undefined
        ? normalizeSubcategoryIds(body.subcategory_ids, body.subcategory_id)[0]
        : undefined,
    subcategory_ids:
      body.subcategory_ids !== undefined || body.subcategory_id !== undefined
        ? normalizeSubcategoryIds(body.subcategory_ids, body.subcategory_id)
        : undefined,
    name: body.name !== undefined ? String(body.name || "").trim() : undefined,
    district: body.district !== undefined ? String(body.district || "").trim() : undefined,
    address: body.address !== undefined ? String(body.address || "").trim() : undefined,
    opening_hours: body.opening_hours !== undefined ? normalizeNullableText(body.opening_hours) : undefined,
    plus_code: body.plus_code !== undefined ? normalizeNullableText(body.plus_code) : undefined,
    latitude: body.latitude !== undefined ? normalizeNullableNumber(body.latitude) : undefined,
    longitude: body.longitude !== undefined ? normalizeNullableNumber(body.longitude) : undefined,
    image_url: image_urls !== undefined ? getPrimaryImageUrl(image_urls, body.image_url) : body.image_url !== undefined ? normalizeNullableText(body.image_url) : undefined,
    image_urls,
    facility_tag_ids: body.facility_tag_ids !== undefined ? normalizeUuidArray(body.facility_tag_ids) : undefined,
    has_grass: body.has_grass !== undefined ? normalizeBoolean(body.has_grass) : undefined,
    has_wash_station: body.has_wash_station !== undefined ? normalizeBoolean(body.has_wash_station) : undefined,
    has_fencing: body.has_fencing !== undefined ? normalizeBoolean(body.has_fencing) : undefined,
    has_parking: body.has_parking !== undefined ? normalizeBoolean(body.has_parking) : undefined,
    metadata: body.metadata !== undefined ? normalizeMetadata(body.metadata) : undefined,
    status: nextStatus ?? undefined,
    source: body.source !== undefined ? String(body.source || "").trim() : undefined,
  };

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("staged_places")
    .update(payload)
    .eq("id", id)
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata,status,source,created_at,updated_at",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as StagedPlaceRow });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("staged_places")
    .update({ status: "rejected" })
    .eq("id", id)
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata,status,source,created_at,updated_at",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data as StagedPlaceRow });
}
