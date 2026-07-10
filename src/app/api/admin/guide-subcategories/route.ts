export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GuideSubcategoryRow = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
};

type CreateBody = {
  category_id?: string;
  name?: string;
  sort_order?: number;
};

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const categoryId = String(url.searchParams.get("category_id") || "").trim();

  const admin = supabaseAdmin();
  let query = admin
    .from("guide_subcategories")
    .select("id,category_id,name,sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (categoryId) query = query.eq("category_id", categoryId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: (data ?? []) as GuideSubcategoryRow[] });
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

  const category_id = String(body.category_id || "").trim();
  const name = String(body.name || "").trim();
  const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100;
  if (!category_id) return NextResponse.json({ error: "Missing category_id" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("guide_subcategories")
    .upsert({ category_id, name, sort_order }, { onConflict: "category_id,name" })
    .select("id,category_id,name,sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as GuideSubcategoryRow });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin.from("guide_subcategories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

type UpdateBody = {
  id?: string;
  category_id?: string;
  name?: string;
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
  const category_id = String(body.category_id || "").trim();
  const name = String(body.name || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!category_id) return NextResponse.json({ error: "Missing category_id" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const updates: Partial<GuideSubcategoryRow> = { category_id, name };
  if (Number.isFinite(Number(body.sort_order))) {
    updates.sort_order = Number(body.sort_order);
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("guide_subcategories")
    .update(updates)
    .eq("id", id)
    .select("id,category_id,name,sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as GuideSubcategoryRow });
}
