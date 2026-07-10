export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type FacilityTagRow = {
  id: string;
  name: string;
  icon: string;
  legacy_key: string | null;
  sort_order: number;
};

export async function GET() {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("facility_tags")
    .select("id,name,icon,legacy_key,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []) as FacilityTagRow[] });
}

