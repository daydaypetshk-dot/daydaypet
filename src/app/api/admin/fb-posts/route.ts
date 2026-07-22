export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { mapImageUrlArrayWithProxy } from "@/lib/image-proxy";
import { supabaseAdmin } from "@/lib/supabase/admin";

type AiStatus = "pending" | "processing" | "done" | "failed" | "skipped";

type FbPostRow = {
  id: string;
  source_group_id: string;
  fb_post_id: string;
  post_url: string;
  post_created_at: string | null;
  content_text: string | null;
  image_urls: unknown;
  raw_payload: unknown;
  ai_status: AiStatus;
  ai_result: unknown;
  ai_error: string | null;
  ai_processed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

function normalizeFbPostImages(row: FbPostRow): FbPostRow {
  return {
    ...row,
    image_urls: mapImageUrlArrayWithProxy(row.image_urls),
  };
}

function clampLimit(raw: string | null, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 100);
}

function parseIds(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseStatus(value: string | null): AiStatus | "" {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v === "pending" || v === "processing" || v === "done" || v === "failed" || v === "skipped") return v;
  return "";
}

export async function GET(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const ids = parseIds(url.searchParams.get("ids"));
  const limit = clampLimit(url.searchParams.get("limit"), 50);

  const admin = supabaseAdmin();

  let query = admin
    .from("fb_group_posts")
    .select(
      "id,source_group_id,fb_post_id,post_url,post_created_at,content_text,image_urls,raw_payload,ai_status,ai_result,ai_error,ai_processed_at,first_seen_at,last_seen_at",
    )
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (ids.length) {
    query = query.in("id", ids);
  } else if (status) {
    query = query.eq("ai_status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const posts = ((data ?? []) as FbPostRow[]).map(normalizeFbPostImages);
  return NextResponse.json({ posts });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: existing, error: lookupError } = await admin
    .from("fb_group_posts")
    .select("id,post_url")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "FB post not found" }, { status: 404 });

  const sourceUrl = String((existing as { post_url?: string | null }).post_url || "").trim();
  if (sourceUrl) {
    const { data: published, error: publishedError } = await admin
      .from("pets")
      .select("id")
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (publishedError) return NextResponse.json({ error: publishedError.message }, { status: 500 });
    if (published?.id) {
      return NextResponse.json({ error: "此貼文已發佈到地圖，不能直接刪除來源記錄。" }, { status: 409 });
    }
  }

  const { error: deleteError } = await admin.from("fb_group_posts").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ ok: true, id });
}
