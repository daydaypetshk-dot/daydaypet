export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createNotificationDispatchLog } from "@/lib/notifications/dispatch-log";
import { type PetInsert } from "@/lib/pets/db";
import { withTimeout } from "@/lib/server/promise-timeout";
import { getSupabaseUserSafely } from "@/lib/supabase/server-auth";
import { getSystemSettings, renderSystemTemplate } from "@/lib/system-settings/server";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

export async function GET() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("pets")
    .select("*")
    .eq("status", "approved")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}

type CreateCitizenPetBody = {
  pet_name?: string;
  pet_type?: PetInsert["pet_type"];
  breed?: string | null;
  location?: string;
  manual_address?: string | null;
  lost_time?: string;
  features?: string;
  phone?: string;
  enable_privacy?: boolean;
  image_url?: string;
  source_url?: string;
  source_type?: PetInsert["source_type"];
  source_link?: string | null;
  case_type?: PetInsert["case_type"];
  status?: PetInsert["status"];
  latitude?: number | null;
  longitude?: number | null;
};

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

    const authResult = await getSupabaseUserSafely(supabaseAuth, "[pets.create]");
    if (!authResult.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: CreateCitizenPetBody;
    try {
      body = (await req.json()) as CreateCitizenPetBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const petName = String(body.pet_name || "").trim() || "（未命名）";
    const petType = body.pet_type;
    const breed = typeof body.breed === "string" ? body.breed.trim() || null : null;
    const location = String(body.location || "").trim();
    const manualAddress = String(body.manual_address || "").trim();
    const lostTime = String(body.lost_time || "").trim();
    const features = String(body.features || "").trim();
    const phone = String(body.phone || "").trim();
    const enablePrivacy = typeof body.enable_privacy === "boolean" ? body.enable_privacy : true;
    const imageUrl = String(body.image_url || "").trim();
    const sourceUrl = String(body.source_url || "").trim();
    const sourceType = body.source_type;
    const sourceLink = String(body.source_link || "").trim();
    const caseType = body.case_type;
    const status = body.status;
    const latitude = typeof body.latitude === "number" && Number.isFinite(body.latitude) ? body.latitude : null;
    const longitude =
      typeof body.longitude === "number" && Number.isFinite(body.longitude) ? body.longitude : null;

    if (!petType || !sourceType || !caseType || status !== "pending") {
      return NextResponse.json({ error: "Invalid report payload" }, { status: 400 });
    }
    if (!lostTime || !phone || !sourceUrl) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!location && !manualAddress) {
      return NextResponse.json({ error: "Missing location or manual address" }, { status: 400 });
    }

    const insertPayload: PetInsert = {
      user_id: authResult.user.id,
      pet_name: petName,
      pet_type: petType,
      breed,
      location: location || manualAddress,
      manual_address: manualAddress || null,
      lost_time: lostTime,
      features,
      phone,
      enable_privacy: enablePrivacy,
      image_url: imageUrl,
      source_url: sourceUrl,
      source_type: sourceType,
      source_link: sourceLink || null,
      case_type: caseType,
      status: "pending",
      latitude,
      longitude,
      district: null,
    };

    const admin = supabaseAdmin();
    const { data: inserted, error: insertError } = await withTimeout(
      admin.from("pets").insert(insertPayload).select("id,pet_name,user_id").single(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[pets.create] insert",
    );
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    const settings = await getSystemSettings();
    const adminWhatsappNumber = settings.admin_whatsapp_number.value;
    const adminTemplate = settings.template_admin_notification.value;
    const origin = req.headers.get("origin") || "http://localhost:3000";
    const adminMessage = renderSystemTemplate(adminTemplate, {
      pet_name: petName,
      description: features || "未提供",
      admin_url: `${origin}/admin/dashboard`,
    });

    if (adminWhatsappNumber) {
      try {
        const whatsappResult = await sendWhatsAppText(adminWhatsappNumber, adminMessage);

        await createNotificationDispatchLog({
          petId: inserted.id,
          ownerUserId: null,
          channel: "whatsapp_admin_pending_report",
          status: whatsappResult.ok ? "sent" : "failed",
          metadata: {
            triggeredByUserId: authResult.user.id,
            receiverLabel: "管理員 WhatsApp",
            receiverContact: adminWhatsappNumber,
            templateKey: "template_admin_notification",
            reason: whatsappResult.ok ? null : whatsappResult.reason,
          },
        });
      } catch (error) {
        await createNotificationDispatchLog({
          petId: inserted.id,
          ownerUserId: null,
          channel: "whatsapp_admin_pending_report",
          status: "failed",
          metadata: {
            triggeredByUserId: authResult.user.id,
            receiverLabel: "管理員 WhatsApp",
            receiverContact: adminWhatsappNumber,
            templateKey: "template_admin_notification",
            reason: error instanceof Error ? error.message : String(error),
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ petId: inserted.id, status: "pending" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
