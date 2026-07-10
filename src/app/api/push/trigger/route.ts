export const runtime = "nodejs";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getDisplayAddress } from "@/lib/pets/display";
import { sendDistrictWebPush, type WebPushPayload } from "@/lib/push/server";
import { withTimeout } from "@/lib/server/promise-timeout";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseUserSafely } from "@/lib/supabase/server-auth";

type Body = {
  kind?: "NEW_CASE" | "NEW_SIGHTING";
  petId?: string;
  time?: string;
  text?: string;
};

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

function pickOrigin(req: NextRequest) {
  const direct = req.headers.get("origin");
  if (direct) return direct;
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return host ? `${proto}://${host}` : "";
}

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

    const authResult = await getSupabaseUserSafely(supabaseAuth, "[push-trigger]");
    if (!authResult.user?.id) {
      console.error("[push-trigger] auth guard rejected request", { reason: authResult.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const kind = body.kind;
    const petId = String(body.petId || "").trim();
    if ((kind !== "NEW_CASE" && kind !== "NEW_SIGHTING") || !petId) {
      return NextResponse.json({ error: "Missing kind/petId" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: adminRow, error: adminRowError } = await withTimeout(
      admin.from("admin_users").select("user_id").eq("user_id", authResult.user.id).maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[push-trigger] admin lookup",
    );
    if (adminRowError) {
      return NextResponse.json({ error: adminRowError.message }, { status: 400 });
    }
    if (!adminRow?.user_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: pet, error: petError } = await withTimeout(
      admin
        .from("pets")
        .select("id,status,pet_name,image_url,location,manual_address,district,latitude,longitude")
        .eq("id", petId)
        .single(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[push-trigger] pet lookup",
    );
    if (petError) {
      return NextResponse.json({ error: petError.message }, { status: 400 });
    }

    const district = (pet.district || "").trim() || "全港";
    const origin = pickOrigin(req) || "";
    const targetUrl = origin ? `${origin}/?petId=${encodeURIComponent(petId)}` : `/?petId=${encodeURIComponent(petId)}`;

    let payload: WebPushPayload;
    if (kind === "NEW_CASE") {
      payload = {
        kind,
        district,
        petId,
        title: "叮！你附近有毛孩需要救援！",
        body: `剛剛：${district} 有「${String(pet.pet_name || "毛孩")}」需要協助`,
        icon: String(pet.image_url || "") || undefined,
        url: targetUrl,
        tag: `daydaypet:${kind}:${petId}`,
      };
    } else {
      const time = String(body.time || "").trim() || "剛剛";
      const text = String(body.text || "").trim() || "收到新情報";
      payload = {
        kind,
        district,
        petId,
        title: "有最新目擊回報！",
        body: `${time}：${text}`,
        icon: String(pet.image_url || "") || undefined,
        url: targetUrl,
        tag: `daydaypet:${kind}:${petId}`,
      };
    }

    const result = await withTimeout(
      sendDistrictWebPush({ district, payload }),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[push-trigger] send web push",
    );
    return NextResponse.json({ ok: true, result, address: getDisplayAddress(pet.location, pet.manual_address) });
  } catch (error) {
    console.error("[push-trigger] unhandled route error", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
