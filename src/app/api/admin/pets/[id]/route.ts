export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { createNotificationDispatchLog } from "@/lib/notifications/dispatch-log";
import { createNotification } from "@/lib/notifications/server";
import type { PetInsert } from "@/lib/pets/db";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { withTimeout } from "@/lib/server/promise-timeout";
import { getSystemSettings, renderSystemTemplate } from "@/lib/system-settings/server";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

const SUPABASE_QUERY_TIMEOUT_MS = 10_000;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  const petId = String(id || "").trim();
  if (!petId) {
    return NextResponse.json({ error: "Missing pet id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.from("pets").select("*").eq("id", petId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Pet not found" }, { status: 404 });
  }

  return NextResponse.json({ pet: data });
}

type PatchBody = Partial<PetInsert>;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  const petId = String(id || "").trim();
  if (!petId) {
    return NextResponse.json({ error: "Missing pet id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: existing, error: existingError } = await withTimeout(
    admin.from("pets").select("*").eq("id", petId).maybeSingle(),
    SUPABASE_QUERY_TIMEOUT_MS,
    "[admin/pets/:id] lookup",
  );
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Pet not found" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await withTimeout(
    admin.from("pets").update(body).eq("id", petId).select("*").single(),
    SUPABASE_QUERY_TIMEOUT_MS,
    "[admin/pets/:id] update",
  );
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
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
    } catch (error) {
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
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      } catch {}
    }
  }

  return NextResponse.json({ pet: updated });
}
