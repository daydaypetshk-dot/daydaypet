export const runtime = "nodejs";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { withTimeout } from "@/lib/server/promise-timeout";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseUserSafely } from "@/lib/supabase/server-auth";

type PatchBody = {
  notificationId?: string;
  markAll?: boolean;
};

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

async function getSignedInUserId() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase env.");
  }
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });

  const authResult = await getSupabaseUserSafely(supabaseAuth, "[notifications]");
  if (!authResult.user) {
    if (authResult.reason && authResult.reason !== "Unauthorized") {
      console.error("[notifications] auth guard failed", { reason: authResult.reason });
    }
    return null;
  }

  return authResult.user.id;
}

export async function GET() {
  try {
    const userId = await getSignedInUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const admin = supabaseAdmin();
    const { data, error } = await withTimeout(
      admin
        .from("notifications")
        .select("id,title,content,is_read,created_at,pet_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[notifications] list query",
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const notifications = (data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      isRead: Boolean(item.is_read),
      createdAt: item.created_at,
      petId: item.pet_id ?? null,
    }));
    return NextResponse.json({ notifications });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load notifications";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getSignedInUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const admin = supabaseAdmin();
    let query = admin.from("notifications").update({ is_read: true }).eq("user_id", userId);
    if (!body.markAll) {
      const notificationId = String(body.notificationId || "").trim();
      if (!notificationId) {
        return NextResponse.json({ error: "Missing notificationId" }, { status: 400 });
      }
      query = query.eq("id", notificationId);
    }
    const { error } = await withTimeout(query, SUPABASE_QUERY_TIMEOUT_MS, "[notifications] patch update");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update notifications";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
