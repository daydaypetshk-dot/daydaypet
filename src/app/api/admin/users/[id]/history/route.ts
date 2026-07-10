export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  const userId = String(id || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: caseRows, error: caseError } = await admin
    .from("pets")
    .select("id,pet_name,lost_time,status,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (caseError) return NextResponse.json({ error: caseError.message }, { status: 500 });

  const { data: sightingRows, error: sightingError } = await admin
    .from("pet_sightings")
    .select("id,pet_id,sighting_time,content,created_at,pets!inner(id,pet_name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (sightingError) return NextResponse.json({ error: sightingError.message }, { status: 500 });

  const cases = (caseRows || []).map((row: any) => ({
    id: String(row.id || ""),
    title: String(row.pet_name || "(未命名案件)"),
    time: String(row.lost_time || row.created_at || ""),
    status: String(row.status || ""),
    href: `/?petId=${encodeURIComponent(String(row.id || ""))}`,
  }));

  const sightings = (sightingRows || []).map((row: any) => ({
    id: String(row.id || ""),
    petId: String(row.pet_id || ""),
    petTitle: String(row.pets?.pet_name || "(未命名案件)"),
    time: String(row.sighting_time || row.created_at || ""),
    content: String(row.content || ""),
    href: `/?petId=${encodeURIComponent(String(row.pet_id || ""))}`,
  }));

  return NextResponse.json({ cases, sightings });
}

