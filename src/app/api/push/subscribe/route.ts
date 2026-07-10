export const runtime = "nodejs";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { normalizeSubscriptionDistricts } from "@/lib/push/district-selection";
import { withTimeout } from "@/lib/server/promise-timeout";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseUserSafely } from "@/lib/supabase/server-auth";

type Body = {
  district?: string;
  districts?: string[];
  subscription?: {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
};

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json({ error: "Missing Supabase env." }, { status: 500 });
    }

    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(_cookiesToSet) {},
      },
    });

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const districts = normalizeSubscriptionDistricts(body.districts ?? body.district ?? "全港");
    const endpoint = String(body.subscription?.endpoint || "").trim();
    const keys = body.subscription?.keys;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Missing subscription" }, { status: 400 });
    }

    const authResult = await getSupabaseUserSafely(supabaseAuth, "[push-subscribe]");
    if (!authResult.user && authResult.reason && authResult.reason !== "Unauthorized") {
      console.warn("[push-subscribe] auth guard failed", { reason: authResult.reason });
    }
    const signedInUserId = authResult.user?.id ?? null;

    const admin = supabaseAdmin();
    const { data: existing, error: existingError } = await withTimeout(
      admin.from("user_subscriptions").select("user_id").eq("endpoint", endpoint).maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[push-subscribe] existing subscription lookup",
    );
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    const { error: upsertError } = await withTimeout(
      admin.from("user_subscriptions").upsert(
        {
          user_id: signedInUserId ?? existing?.user_id ?? null,
          districts,
          endpoint,
          subscription_json: body.subscription,
        },
        { onConflict: "endpoint" },
      ),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[push-subscribe] upsert",
    );
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, linked: Boolean(signedInUserId), districts });
  } catch (error) {
    console.error("[push-subscribe] unhandled route error", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
