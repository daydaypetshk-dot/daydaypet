export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GuideCategoryRow = {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
};

type CreateBody = {
  name?: string;
  icon?: string;
  sort_order?: number;
};

export async function GET() {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("guide_categories")
    .select("id,name,icon,sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: (data ?? []) as GuideCategoryRow[] });
}

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
  const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100;
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  if (!icon) return NextResponse.json({ error: "Missing icon" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("guide_categories")
    .upsert({ name, icon, sort_order }, { onConflict: "name" })
    .select("id,name,icon,sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as GuideCategoryRow });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin.from("guide_categories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

type UpdateBody = {
  id?: string;
  name?: string;
  icon?: string;
  sort_order?: number;
};

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
  const name = String(body.name || "").trim();
  const icon = String(body.icon || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  if (!icon) return NextResponse.json({ error: "Missing icon" }, { status: 400 });

  const updates: Partial<GuideCategoryRow> = { name, icon };
  if (Number.isFinite(Number(body.sort_order))) {
    updates.sort_order = Number(body.sort_order);
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("guide_categories")
    .update(updates)
    .eq("id", id)
    .select("id,name,icon,sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as GuideCategoryRow });
}
