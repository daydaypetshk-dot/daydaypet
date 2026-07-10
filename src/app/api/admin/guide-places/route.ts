export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GuidePlaceRow = {
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
};

type UpsertBody = {
  category_id?: string;
  subcategory_id?: string;
  subcategory_ids?: unknown;
  name?: string;
  district?: string;
  address?: string;
  opening_hours?: string | null;
  plus_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  image_url?: string | null;
  image_urls?: unknown;
  facility_tag_ids?: unknown;
  has_grass?: boolean;
  has_wash_station?: boolean;
  has_fencing?: boolean;
  has_parking?: boolean;
  metadata?: unknown;
};

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
  if (Array.isArray(value)) return value.map((v) => String(v ?? "").trim()).filter(Boolean);
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

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const categoryId = String(url.searchParams.get("category_id") || "").trim();
  const subcategoryId = String(url.searchParams.get("subcategory_id") || "").trim();
  const district = String(url.searchParams.get("district") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSizeRaw = Number(url.searchParams.get("pageSize") || 20) || 20;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = supabaseAdmin();
  let query = admin
    .from("guide_places")
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata",
      { count: "exact" },
    )
    .order("district", { ascending: true })
    .order("name", { ascending: true });

  if (categoryId) query = query.eq("category_id", categoryId);
  if (subcategoryId) query = query.contains("subcategory_ids", [subcategoryId]);
  if (district) query = query.eq("district", district);
  if (q) {
    const term = q.replaceAll(",", "").replaceAll(":", "").trim();
    if (term) query = query.or(`name.ilike.%${term}%,district.ilike.%${term}%`);
  }
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data ?? []) as GuidePlaceRow[],
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: UpsertBody;
  try {
    body = (await req.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const category_id = String(body.category_id || "").trim();
  const subcategory_ids = normalizeSubcategoryIds(body.subcategory_ids, body.subcategory_id);
  const name = String(body.name || "").trim();
  const district = String(body.district || "").trim();
  const address = String(body.address || "").trim();
  if (!category_id) return NextResponse.json({ error: "Missing category_id" }, { status: 400 });
  if (subcategory_ids.length === 0) return NextResponse.json({ error: "Missing subcategory_ids" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  if (!district) return NextResponse.json({ error: "Missing district" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "Missing address" }, { status: 400 });

  const image_urls = body.image_urls !== undefined ? normalizeUrlArray(body.image_urls) : [];
  const payload = {
    category_id,
    subcategory_id: subcategory_ids[0],
    subcategory_ids,
    name,
    district,
    address,
    opening_hours: normalizeNullableText(body.opening_hours),
    plus_code: normalizeNullableText(body.plus_code),
    latitude: normalizeNullableNumber(body.latitude),
    longitude: normalizeNullableNumber(body.longitude),
    image_url: getPrimaryImageUrl(image_urls, body.image_url),
    image_urls,
    facility_tag_ids: body.facility_tag_ids !== undefined ? normalizeUuidArray(body.facility_tag_ids) : [],
    has_grass: normalizeBoolean(body.has_grass),
    has_wash_station: normalizeBoolean(body.has_wash_station),
    has_fencing: normalizeBoolean(body.has_fencing),
    has_parking: normalizeBoolean(body.has_parking),
    metadata: body.metadata !== undefined ? normalizeMetadata(body.metadata) : undefined,
  };

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("guide_places")
    .insert(payload)
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as GuidePlaceRow });
}

type UpdateBody = UpsertBody & {
  id?: string;
};

export async function PATCH(req: NextRequest) {
  try {
    const guard = await assertAdminServer();
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    let body: UpdateBody;
    try {
      body = (await req.json()) as UpdateBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const id = String(body.id || "").trim();
    const category_id = String(body.category_id || "").trim();
    const subcategory_ids = normalizeSubcategoryIds(body.subcategory_ids, body.subcategory_id);
    const name = String(body.name || "").trim();
    const district = String(body.district || "").trim();
    const address = String(body.address || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (!category_id) return NextResponse.json({ error: "Missing category_id" }, { status: 400 });
    if (subcategory_ids.length === 0) return NextResponse.json({ error: "Missing subcategory_ids" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
    if (!district) return NextResponse.json({ error: "Missing district" }, { status: 400 });
    if (!address) return NextResponse.json({ error: "Missing address" }, { status: 400 });

    const image_urls = body.image_urls !== undefined ? normalizeUrlArray(body.image_urls) : undefined;
    const payload = {
      category_id,
      subcategory_id: subcategory_ids[0],
      subcategory_ids,
      name,
      district,
      address,
      opening_hours: normalizeNullableText(body.opening_hours),
      plus_code: normalizeNullableText(body.plus_code),
      latitude: body.latitude !== undefined ? normalizeNullableNumber(body.latitude) : undefined,
      longitude: body.longitude !== undefined ? normalizeNullableNumber(body.longitude) : undefined,
      image_url: image_urls !== undefined ? getPrimaryImageUrl(image_urls, body.image_url) : normalizeNullableText(body.image_url),
      image_urls,
      facility_tag_ids: body.facility_tag_ids !== undefined ? normalizeUuidArray(body.facility_tag_ids) : undefined,
      has_grass: normalizeBoolean(body.has_grass),
      has_wash_station: normalizeBoolean(body.has_wash_station),
      has_fencing: normalizeBoolean(body.has_fencing),
      has_parking: normalizeBoolean(body.has_parking),
      metadata: body.metadata !== undefined ? normalizeMetadata(body.metadata) : {},
    };

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("guide_places")
      .update(payload)
      .eq("id", id)
      .select(
        "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata",
      )
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, item: data as GuidePlaceRow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message ? error.message : "更新指南地點失敗（未知錯誤）" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  let ids: string[] = [];
  if (id) {
    ids = [id];
  } else {
    try {
      const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
      ids = Array.isArray(body?.ids)
        ? (body!.ids as unknown[]).map((v) => String(v || "").trim()).filter(Boolean)
        : [];
    } catch {
      ids = [];
    }
  }
  if (ids.length === 0) return NextResponse.json({ error: "Missing id(s)" }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin.from("guide_places").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, deleted: ids.length });
}
