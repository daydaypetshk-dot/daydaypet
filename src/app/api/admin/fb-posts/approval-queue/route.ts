export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type FbQueueRow = {
  id: string;
  post_url: string;
  post_created_at: string | null;
  content_text: string | null;
  image_urls: unknown;
  ai_result: unknown;
  last_seen_at: string;
};

function clampLimit(value: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(Math.max(Math.floor(n), 1), 50);
}

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const limit = clampLimit(url.searchParams.get("limit"));

  const admin = supabaseAdmin();
  const { data: candidates, error } = await admin
    .from("fb_group_posts")
    .select("id,post_url,post_created_at,content_text,image_urls,ai_result,last_seen_at")
    .eq("ai_status", "done")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (candidates ?? []) as FbQueueRow[];
  const postUrls = rows.map((r) => String(r.post_url || "").trim()).filter(Boolean);
  if (!postUrls.length) return NextResponse.json({ items: [] satisfies FbQueueRow[] });

  const { data: published, error: publishedError } = await admin
    .from("pets")
    .select("source_url")
    .in("source_url", postUrls);

  if (publishedError) return NextResponse.json({ error: publishedError.message }, { status: 500 });

  const publishedSet = new Set((published ?? []).map((r) => String((r as any)?.source_url || "").trim()).filter(Boolean));
  const filtered = rows.filter((r) => !publishedSet.has(String(r.post_url || "").trim()));

  return NextResponse.json({ items: filtered });
}

