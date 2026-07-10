export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const categoryId = String(url.searchParams.get("category_id") || "").trim();
  const subcategoryId = String(url.searchParams.get("subcategory_id") || "").trim();
  const district = String(url.searchParams.get("district") || "").trim();

  const admin = supabaseAdmin();
  let query = admin
    .from("guide_places")
    .select(
      "id,category_id,subcategory_id,subcategory_ids,name,district,address,opening_hours,plus_code,latitude,longitude,image_url,image_urls,facility_tag_ids,has_grass,has_wash_station,has_fencing,has_parking,metadata",
    )
    .order("district", { ascending: true })
    .order("name", { ascending: true });

  if (categoryId) query = query.eq("category_id", categoryId);
  if (subcategoryId) query = query.contains("subcategory_ids", [subcategoryId]);
  if (district) query = query.eq("district", district);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: (data ?? []) as GuidePlaceRow[] });
}
