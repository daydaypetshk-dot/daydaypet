export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type FacilityTagRow = {
  id: string;
  name: string;
  icon: string;
  legacy_key: string | null;
  match_keywords: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function normalizeCsvList(value: string) {
  return value
    .split(/[,，、|/]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTextArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return normalizeCsvList(value);
  }
  return [];
}

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const activeRaw = String(url.searchParams.get("active") || "").trim();
  const activeFilter = activeRaw === "true" ? true : activeRaw === "false" ? false : null;

  const admin = supabaseAdmin();
  let query = admin
    .from("facility_tags")
    .select("id,name,icon,legacy_key,match_keywords,is_active,sort_order,created_at,updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (activeFilter !== null) query = query.eq("is_active", activeFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: (data ?? []) as FacilityTagRow[] });
}

type CreateBody = Partial<{
  name: string;
  icon: string;
  legacy_key: string | null;
  match_keywords: unknown;
  is_active: boolean;
  sort_order: number;
}>;

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const icon = String(body.icon || "").trim();
  const legacy_key = body.legacy_key === null ? null : String(body.legacy_key || "").trim() || null;
  const match_keywords = normalizeTextArray(body.match_keywords);
  const is_active = body.is_active === undefined ? true : body.is_active === true;
  const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100;
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("facility_tags")
    .upsert({ name, icon, legacy_key, match_keywords, is_active, sort_order }, { onConflict: "name" })
    .select("id,name,icon,legacy_key,match_keywords,is_active,sort_order,created_at,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data as FacilityTagRow });
}

type UpdateBody = Partial<{
  id: string;
  name: string;
  icon: string;
  legacy_key: string | null;
  match_keywords: unknown;
  is_active: boolean;
  sort_order: number;
}>;

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

  const updates: Partial<FacilityTagRow> & { match_keywords?: string[] } = {};
  if (body.name !== undefined) updates.name = String(body.name || "").trim();
  if (body.icon !== undefined) updates.icon = String(body.icon || "").trim();
  if (body.legacy_key !== undefined) {
    updates.legacy_key = body.legacy_key === null ? null : String(body.legacy_key || "").trim() || null;
  }
  if (body.match_keywords !== undefined) updates.match_keywords = normalizeTextArray(body.match_keywords);
  if (body.is_active !== undefined) updates.is_active = body.is_active === true;
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) updates.sort_order = Number(body.sort_order);
  if ("name" in updates && !String(updates.name || "").trim()) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("facility_tags")
    .update(updates)
    .eq("id", id)
    .select("id,name,icon,legacy_key,match_keywords,is_active,sort_order,created_at,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data as FacilityTagRow });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("facility_tags")
    .update({ is_active: false })
    .eq("id", id)
    .select("id,name,icon,legacy_key,match_keywords,is_active,sort_order,created_at,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data as FacilityTagRow });
}

