export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type StagedRow = {
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
  source: string;
  status: "pending" | "approved" | "rejected";
};

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const staged = await admin
    .from("staged_places")
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata,source,status",
    )
    .eq("id", id)
    .single();

  if (staged.error) return NextResponse.json({ error: staged.error.message }, { status: 400 });
  const row = staged.data as StagedRow;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ error: "Only pending records can be approved" }, { status: 400 });

  const insertPayload = {
    category_id: row.category_id,
    subcategory_id: (Array.isArray(row.subcategory_ids) && row.subcategory_ids[0]) || row.subcategory_id,
    subcategory_ids: Array.isArray(row.subcategory_ids) && row.subcategory_ids.length > 0 ? row.subcategory_ids : [row.subcategory_id],
    name: row.name,
    district: row.district,
    address: row.address,
    opening_hours: row.opening_hours,
    plus_code: row.plus_code,
    latitude: row.latitude,
    longitude: row.longitude,
    image_url: row.image_url,
    image_urls: Array.isArray(row.image_urls) ? row.image_urls : row.image_url ? [row.image_url] : [],
    facility_tag_ids: Array.isArray(row.facility_tag_ids) ? row.facility_tag_ids : [],
    has_grass: row.has_grass,
    has_wash_station: row.has_wash_station,
    has_fencing: row.has_fencing,
    has_parking: row.has_parking,
    metadata: row.metadata ?? {},
    source: row.source || "external",
  };

  const inserted = await admin
    .from("guide_places")
    .upsert(insertPayload, { onConflict: "name,address" })
    .select("id")
    .single();

  if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 400 });

  const updated = await admin.from("staged_places").update({ status: "approved" }).eq("id", id);
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 400 });

  return NextResponse.json({ ok: true, guide_place_id: inserted.data?.id ?? null });
}
