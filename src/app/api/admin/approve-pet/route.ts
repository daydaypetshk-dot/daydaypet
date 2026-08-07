export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { createNotificationDispatchLog } from "@/lib/notifications/dispatch-log";
import { createNotification } from "@/lib/notifications/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { withTimeout } from "@/lib/server/promise-timeout";
import { getSystemSettings, renderSystemTemplate } from "@/lib/system-settings/server";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { id?: string; status?: string; district?: string | null };
  try {
    body = (await req.json()) as { id?: string; status?: string; district?: string | null };
  } catch (err) {
    console.error("POST /api/admin/approve-pet invalid JSON:", err);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const petId = String(body.id || "").trim();
  if (!petId) {
    return NextResponse.json({ error: "Missing pet ID" }, { status: 400 });
  }

  const nextStatus = String(body.status || "approved").trim() as any;
  const payload: Record<string, any> = { status: nextStatus };
  if (Object.prototype.hasOwnProperty.call(body, "district")) {
    payload.district = body.district ?? null;
  }

  const admin = supabaseAdmin();

  const { data: existing, error: existingError } = await withTimeout(
    admin.from("pets").select("*").eq("id", petId).maybeSingle(),
    SUPABASE_QUERY_TIMEOUT_MS,
    "[admin/approve-pet] lookup",
  );
  if (existingError) {
    console.error("[admin/approve-pet] lookup error:", existingError);
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Pet not found" }, { status: 404 });
  }

  console.log("[admin/approve-pet] update payload:", {
    petId,
    payload,
    actorUserId: guard.user.id,
  });

  let updated: any = undefined;
  try {
    const result = await withTimeout(
      admin.from("pets").update(payload).eq("id", petId).select("*").single(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[admin/approve-pet] update",
    );
    if (result.error) throw result.error;
    updated = result.data;
  } catch (err: any) {
    console.error("[admin/approve-pet] database update error:", err);
    return NextResponse.json(
      { error: err?.message || "Database update failed" },
      { status: 500 },
    );
  }

  const approvalTransition = existing.status !== "approved" && updated.status === "approved";
  if (approvalTransition) {
    const appUrl =
      String(process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
      req.headers.get("origin") ||
      "http://localhost:3000";
    const settings = await getSystemSettings();
    const citizenTemplate = settings.template_citizen_approved.value;
    const petUrl = `${appUrl.replace(/\/+$/, "")}/?petId=${encodeURIComponent(updated.id)}`;
    const citizenMessage = renderSystemTemplate(citizenTemplate, {
      pet_name: updated.pet_name || "未命名毛孩",
      pet_url: petUrl,
    });

    try {
      const whatsappResult = await sendWhatsAppText(updated.phone || "", citizenMessage);
      await createNotificationDispatchLog({
        petId: updated.id,
        ownerUserId: updated.user_id ?? null,
        channel: "whatsapp_reporter_approved",
        status: whatsappResult.ok ? "sent" : "failed",
        metadata: {
          triggeredByAdminUserId: guard.user.id,
          receiverLabel: "報料市民 WhatsApp",
          receiverContact: updated.phone || "",
          templateKey: "template_citizen_approved",
          reason: whatsappResult.ok ? null : whatsappResult.reason,
        },
      });
      if (updated.user_id) {
        await createNotification({
          userId: updated.user_id,
          petId: updated.id,
          title: "你的報料已通過審核",
          content: `你提交的案件「${updated.pet_name || "未命名毛孩"}」已正式上架。查看：${petUrl}`,
        }).catch(() => {});
      }
    } catch (notifyErr) {
      console.error("[admin/approve-pet] post-approval notify error:", notifyErr);
      try {
        await createNotificationDispatchLog({
          petId: updated.id,
          ownerUserId: updated.user_id ?? null,
          channel: "whatsapp_reporter_approved",
          status: "failed",
          metadata: {
            triggeredByAdminUserId: guard.user.id,
            receiverLabel: "報料市民 WhatsApp",
            receiverContact: updated.phone || "",
            templateKey: "template_citizen_approved",
            reason: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
          },
        });
      } catch {}
    }
  }

  return NextResponse.json({ success: true, data: updated });
}
