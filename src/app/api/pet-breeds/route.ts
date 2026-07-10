export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type PetBreedRow = {
  id: string;
  pet_type: "cat" | "dog" | "bird";
  breed_name: string;
  sort_order: number;
};

export async function GET() {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("pet_breeds")
    .select("id,pet_type,breed_name,sort_order")
    .order("pet_type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("breed_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []) as PetBreedRow[] });
}
