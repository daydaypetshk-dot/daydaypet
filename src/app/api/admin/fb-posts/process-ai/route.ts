export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { clampFbAiLimit, processPendingFbPosts } from "@/lib/fb-scraper/process-ai";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ProcessBody = {
  limit?: number;
  ids?: string[];
};

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: ProcessBody = {};
  try {
    body = (await req.json()) as ProcessBody;
  } catch {}

  const limit = clampFbAiLimit(body.limit);
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];

  const admin = supabaseAdmin();
  const result = await processPendingFbPosts(admin, { limit, ids });
  return NextResponse.json({ ok: true, ...result });
}
