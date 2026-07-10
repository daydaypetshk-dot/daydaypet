export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type PetType = "cat" | "dog" | "bird";

type PetBreedRow = {
  id: string;
  pet_type: PetType;
  breed_name: string;
  sort_order: number;
};

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const petType = url.searchParams.get("pet_type");
  const filter: PetType | null =
    petType === "cat" || petType === "dog" || petType === "bird" ? petType : null;

  const admin = supabaseAdmin();
  let query = admin
    .from("pet_breeds")
    .select("id,pet_type,breed_name,sort_order")
    .order("pet_type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("breed_name", { ascending: true });
  if (filter) query = query.eq("pet_type", filter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: (data ?? []) as PetBreedRow[] });
}

type CreateBody = {
  pet_type?: PetType;
  breed_name?: string;
  sort_order?: number;
};

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pet_type = body.pet_type;
  const breed_name = String(body.breed_name || "").trim();
  const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 100;
  if (pet_type !== "cat" && pet_type !== "dog" && pet_type !== "bird") {
    return NextResponse.json({ error: "Invalid pet_type" }, { status: 400 });
  }
  if (!breed_name) {
    return NextResponse.json({ error: "Missing breed_name" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("pet_breeds")
    .upsert({ pet_type, breed_name, sort_order }, { onConflict: "pet_type,breed_name" })
    .select("id,pet_type,breed_name,sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as PetBreedRow });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin.from("pet_breeds").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

type UpdateBody = {
  id?: string;
  pet_type?: PetType;
  breed_name?: string;
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
  const breed_name = String(body.breed_name || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!breed_name) return NextResponse.json({ error: "Missing breed_name" }, { status: 400 });

  const updates: Partial<PetBreedRow> = { breed_name };
  if (body.pet_type === "cat" || body.pet_type === "dog" || body.pet_type === "bird") {
    updates.pet_type = body.pet_type;
  }
  if (Number.isFinite(Number(body.sort_order))) {
    updates.sort_order = Number(body.sort_order);
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("pet_breeds")
    .update(updates)
    .eq("id", id)
    .select("id,pet_type,breed_name,sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, item: data as PetBreedRow });
}
