export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type GuideCategoryRow = {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
};

type GuideSubcategoryRow = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
};

type GuideCategoryWithSubcategories = GuideCategoryRow & {
  subcategories: GuideSubcategoryRow[];
};

export async function GET() {
  const admin = supabaseAdmin();
  const [{ data: categories, error: categoriesError }, { data: subcategories, error: subcategoriesError }] =
    await Promise.all([
      admin.from("guide_categories").select("id,name,icon,sort_order").order("sort_order", { ascending: true }).order("name", {
        ascending: true,
      }),
      admin
        .from("guide_subcategories")
        .select("id,category_id,name,sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

  if (categoriesError) {
    return NextResponse.json({ error: categoriesError.message }, { status: 500 });
  }
  if (subcategoriesError) {
    return NextResponse.json({ error: subcategoriesError.message }, { status: 500 });
  }

  const grouped = new Map<string, GuideSubcategoryRow[]>();
  for (const row of (subcategories ?? []) as GuideSubcategoryRow[]) {
    const items = grouped.get(row.category_id) ?? [];
    items.push(row);
    grouped.set(row.category_id, items);
  }

  const items: GuideCategoryWithSubcategories[] = ((categories ?? []) as GuideCategoryRow[]).map((category) => ({
    ...category,
    subcategories: grouped.get(category.id) ?? [],
  }));

  return NextResponse.json({ items });
}
