export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { withTimeout } from "@/lib/server/promise-timeout";

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch (err) {
    console.error("POST /api/admin/delete-pet invalid JSON:", err);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const petId = String(body.id || "").trim();
  if (!petId) {
    return NextResponse.json({ error: "Missing pet ID" }, { status: 400 });
  }

  console.log("[admin/delete-pet] delete request:", {
    petId,
    actorUserId: guard.user.id,
  });

  const admin = supabaseAdmin();
  try {
    const result = await withTimeout(
      admin.from("pets").delete().eq("id", petId),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[admin/delete-pet] delete",
    );
    if (result.error) throw result.error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("POST /api/admin/delete-pet error:", err);
    return NextResponse.json(
      { error: err?.message || "Delete failed" },
      { status: 500 },
    );
  }
}
