export const runtime = "nodejs";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createNotificationDispatchLog } from "@/lib/notifications/dispatch-log";
import { uploadSightingAttachmentDataUrl } from "@/lib/pets/server-image-upload";
import { createNotification } from "@/lib/notifications/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseUserSafely } from "@/lib/supabase/server-auth";
import { getDisplayAddress } from "@/lib/pets/display";
import { sendDistrictWebPush } from "@/lib/push/server";
import { withTimeout } from "@/lib/server/promise-timeout";
import { notifyAdminPendingSightingByWhatsApp, notifyOwnerByWhatsApp } from "@/lib/whatsapp/notify";

type Body = {
  time?: string;
  text?: string;
  imageDataUrl?: string;
};

const DUPLICATE_SUBMIT_WINDOW_MS = 60_000;
const WHATSAPP_COOLDOWN_MS = 3 * 60_000;
const OWNER_SIGHTING_WHATSAPP_CHANNEL = "whatsapp_owner_sighting";
const SUPABASE_QUERY_TIMEOUT_MS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeTimeline = (input: unknown) => {
  if (!Array.isArray(input)) return [] as { time: string; text: string; imageUrl?: string | null }[];
  return (input as any[])
    .map((t) => ({
      time: typeof t?.time === "string" ? t.time : "",
      text: typeof t?.text === "string" ? t.text : "",
      imageUrl: typeof t?.imageUrl === "string" ? t.imageUrl : null,
    }))
    .filter((t) => t.time.trim() && t.text.trim());
};

function isUuid(value: string) {
  return UUID_RE.test(value.trim());
}

function toHongKongIsoString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const y = parts.year || "1970";
  const m = parts.month || "01";
  const d = parts.day || "01";
  const hh = parts.hour || "00";
  const mm = parts.minute || "00";
  const ss = parts.second || "00";
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`;
}

function normalizeSightingTime(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\d{4}年\d{2}月\d{2}日\s+\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    const hk = new Date(toHongKongIsoString(new Date()));
    const yyyy = String(hk.getFullYear());
    const mm = String(hk.getMonth() + 1).padStart(2, "0");
    const dd = String(hk.getDate()).padStart(2, "0");
    return `${yyyy}年${mm}月${dd}日 ${trimmed}`;
  }
  const mdHm = trimmed.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (mdHm) {
    const hk = new Date(toHongKongIsoString(new Date()));
    const yyyy = String(hk.getFullYear());
    return `${yyyy}年${mdHm[1]}月${mdHm[2]}日 ${mdHm[3]}:${mdHm[4]}`;
  }
  const ymdHm = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (ymdHm) {
    return `${ymdHm[1]}年${ymdHm[2]}月${ymdHm[3]}日 ${ymdHm[4]}:${ymdHm[5]}`;
  }
  return trimmed;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const traceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    // #region debug-point A:entry
    (() => {
      const fs = require("fs");
      const p = ".dbg/sighting-no-logs.env";
      let u = "http://127.0.0.1:7780/event";
      let s = "sighting-no-logs";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
      } catch {}
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s,
          runId: "pre",
          hypothesisId: "A",
          location: "src/app/api/pets/[id]/timeline/route.ts:entry",
          msg: "[DEBUG] timeline POST entry",
          data: { petId: id },
          ts: Date.now(),
          traceId,
        }),
      }).catch(() => {});
    })();
    // #endregion
    if (!id || !isUuid(id)) {
      // #region debug-point B:invalid-pet-id
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "B",
            location: "src/app/api/pets/[id]/timeline/route.ts:invalid-id",
            msg: "[DEBUG] invalid pet id, returning 400",
            data: { petId: id },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      return NextResponse.json({ error: "Invalid pet id" }, { status: 400 });
    }
    console.log("====== 收到前端目擊報告請求 ======");

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

    const authResult = await getSupabaseUserSafely(supabaseAuth, "[timeline]");
    if (!authResult.user) {
      // #region debug-point B:auth-rejected
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "B",
            location: "src/app/api/pets/[id]/timeline/route.ts:auth",
            msg: "[DEBUG] auth rejected, returning 401",
            data: { petId: id, reason: authResult.reason || "" },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      console.error("[timeline] auth guard rejected request", { petId: id, reason: authResult.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const time = normalizeSightingTime(String(body.time || ""));
    const text = String(body.text || "").trim();
    const imageDataUrl = String(body.imageDataUrl || "").trim();
    if (!time || !text) {
      return NextResponse.json({ error: "Missing time/text" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: row, error: rowError } = await withTimeout(
      admin
        .from("pets")
        .select("id,status,timeline,district,image_url,pet_name,location,manual_address,latitude,longitude,user_id,phone")
        .eq("id", id)
        .maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[timeline] pets lookup",
    );
    if (rowError) {
      console.error("[timeline] pet lookup failed", { petId: id, error: rowError.message });
      return NextResponse.json({ error: rowError.message }, { status: 400 });
    }
    if (!row) {
      // #region debug-point B:pet-not-found
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "B",
            location: "src/app/api/pets/[id]/timeline/route.ts:pet-not-found",
            msg: "[DEBUG] pet not found, returning 404",
            data: { petId: id },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (row.status !== "approved") {
      // #region debug-point B:pet-not-approved
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "B",
            location: "src/app/api/pets/[id]/timeline/route.ts:pet-status",
            msg: "[DEBUG] pet not approved, returning 400",
            data: { petId: id, status: row.status || "" },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      return NextResponse.json({ error: "Only approved cases accept sightings" }, { status: 400 });
    }
    // #region debug-point B:pet-approved
    (() => {
      const fs = require("fs");
      const p = ".dbg/sighting-no-logs.env";
      let u = "http://127.0.0.1:7780/event";
      let s = "sighting-no-logs";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
      } catch {}
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s,
          runId: "pre",
          hypothesisId: "B",
          location: "src/app/api/pets/[id]/timeline/route.ts:pet-approved",
          msg: "[DEBUG] pet approved, continue pipeline",
          data: { petId: id, ownerUserId: String(row.user_id || ""), ownerPhone: String(row.phone || "") },
          ts: Date.now(),
          traceId,
        }),
      }).catch(() => {});
    })();
    // #endregion

    const duplicateCutoffIso = new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS).toISOString();
    const { data: recentUserSighting, error: recentUserSightingError } = await withTimeout(
      admin
        .from("pet_sightings")
        .select("id,created_at")
        .eq("pet_id", id)
        .eq("user_id", authResult.user.id)
        .gt("created_at", duplicateCutoffIso)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[timeline] duplicate lookup",
    );
    if (recentUserSightingError) {
      console.error("[timeline] duplicate lookup failed", {
        petId: id,
        userId: authResult.user.id,
        error: recentUserSightingError.message,
      });
      return NextResponse.json({ error: recentUserSightingError.message }, { status: 400 });
    }
    if (recentUserSighting) {
      // #region debug-point B:duplicate-guard
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "B",
            location: "src/app/api/pets/[id]/timeline/route.ts:duplicate",
            msg: "[DEBUG] duplicate guard hit, returning 429",
            data: { petId: id, userId: authResult.user.id },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      return NextResponse.json({ error: "你提交得太頻繁了，請稍後再試" }, { status: 429 });
    }

    const uploadedImageUrl = imageDataUrl
      ? await withTimeout(
          uploadSightingAttachmentDataUrl(imageDataUrl, {
            petId: id,
            userId: authResult.user.id,
          }),
          SUPABASE_QUERY_TIMEOUT_MS,
          "[timeline] sighting attachment upload",
        )
      : null;

    const nextTimeline = [
      ...normalizeTimeline(row.timeline),
      uploadedImageUrl ? { time, text, imageUrl: uploadedImageUrl } : { time, text },
    ];
    const { data: updated, error: updateError } = await withTimeout(
      admin.from("pets").update({ timeline: nextTimeline }).eq("id", id).select("timeline").single(),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[timeline] pets.timeline update",
    );
    if (updateError) {
      console.error("[timeline] pets.timeline update failed", {
        petId: id,
        userId: authResult.user.id,
        error: updateError.message,
      });
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    const { error: sightingError } = await withTimeout(
      admin.from("pet_sightings").insert({
        pet_id: id,
        user_id: authResult.user.id,
        sighting_time: time,
        content: text,
        image_url: uploadedImageUrl,
      }),
      SUPABASE_QUERY_TIMEOUT_MS,
      "[timeline] pet_sightings insert",
    );
    if (sightingError) {
      console.error("[timeline] pet_sightings insert failed", {
        petId: id,
        userId: authResult.user.id,
        error: sightingError.message,
      });
      return NextResponse.json({ error: sightingError.message }, { status: 400 });
    }
    // #region debug-point B:db-written
    (() => {
      const fs = require("fs");
      const p = ".dbg/sighting-no-logs.env";
      let u = "http://127.0.0.1:7780/event";
      let s = "sighting-no-logs";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
      } catch {}
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s,
          runId: "pre",
          hypothesisId: "B",
          location: "src/app/api/pets/[id]/timeline/route.ts:db-written",
          msg: "[DEBUG] timeline and pet_sightings written",
          data: { petId: id, userId: authResult.user.id, time, textLen: text.length },
          ts: Date.now(),
          traceId,
        }),
      }).catch(() => {});
    })();
    // #endregion

    const displayAddress = getDisplayAddress(String(row.location || ""), row.manual_address || null);
    const adminWhatsappNumber = String(process.env.ADMIN_WHATSAPP_NUMBER || "").trim();
    const origin = req.headers.get("origin") || "http://localhost:3000";

    if (adminWhatsappNumber) {
      try {
        await notifyAdminPendingSightingByWhatsApp({
          phone: adminWhatsappNumber,
          petName: row.pet_name || "未命名毛孩",
          reportedAt: new Date().toLocaleString("zh-HK", {
            timeZone: "Asia/Hong_Kong",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }),
          approvalUrl: `${origin}/admin/dashboard`,
        });
      } catch (error) {
        console.warn("[timeline] admin WhatsApp notify failed", {
          petId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const ownerUserId = row.user_id ? String(row.user_id) : null;
    if (ownerUserId && ownerUserId !== authResult.user.id) {
      try {
        await createNotification({
          userId: ownerUserId,
          petId: id,
          title: "🚨 有人剛目擊到疑似你的毛孩",
          content: `地點在 ${displayAddress}。請立刻到小鈴鐺或時間軸查看詳情。`,
        });
        await createNotificationDispatchLog({
          petId: id,
          ownerUserId,
          channel: "in_app_owner_sighting",
          status: "sent",
          metadata: {
            triggeredByUserId: authResult.user.id,
          },
        });
      } catch (error) {
        console.warn("[timeline] in-app owner notify failed", {
          petId: id,
          ownerUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const ownerPhone = String(row.phone || "").trim();
      // #region debug-point C:owner-phone
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "C",
            location: "src/app/api/pets/[id]/timeline/route.ts:owner-phone",
            msg: "[DEBUG] extracted owner phone for WhatsApp",
            data: { petId: id, ownerUserId: ownerUserId || "", ownerPhone: ownerPhone },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      if (!ownerPhone) {
        // #region debug-point C:missing-phone
        (() => {
          const fs = require("fs");
          const p = ".dbg/sighting-no-logs.env";
          let u = "http://127.0.0.1:7780/event";
          let s = "sighting-no-logs";
          try {
            const e = fs.readFileSync(p, "utf8");
            u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
            s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
          } catch {}
          fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: s,
              runId: "pre",
              hypothesisId: "C",
              location: "src/app/api/pets/[id]/timeline/route.ts:missing-phone",
              msg: "[DEBUG] missing owner phone, will log failed",
              data: { petId: id },
              ts: Date.now(),
              traceId,
            }),
          }).catch(() => {});
        })();
        // #endregion
        await createNotificationDispatchLog({
          petId: id,
          ownerUserId,
          channel: "whatsapp_owner_sighting",
          status: "failed",
          metadata: {
            triggeredByUserId: authResult.user.id,
            receiverLabel: "原主人 WhatsApp",
            receiverContact: "",
            reason: "missing_phone",
          },
        });
        throw new Error("missing_phone");
      }
      const whatsappCooldownCutoffIso = new Date(Date.now() - WHATSAPP_COOLDOWN_MS).toISOString();
      const { data: recentDispatch, error: recentDispatchError } = await withTimeout(
        admin
          .from("notification_dispatch_logs")
          .select("id,created_at")
          .eq("pet_id", id)
          .eq("channel", OWNER_SIGHTING_WHATSAPP_CHANNEL)
          .eq("status", "sent")
          .gt("created_at", whatsappCooldownCutoffIso)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        SUPABASE_QUERY_TIMEOUT_MS,
        "[timeline] recent dispatch lookup",
      );
      if (recentDispatchError) {
        throw new Error(recentDispatchError.message);
      }
      if (recentDispatch) {
        await createNotificationDispatchLog({
          petId: id,
          ownerUserId,
          channel: "whatsapp_owner_sighting",
          status: "skipped_rate_limited",
          metadata: {
            triggeredByUserId: authResult.user.id,
            receiverLabel: "原主人 WhatsApp",
            receiverContact: ownerPhone,
          },
        });
      } else {
        // #region debug-point C:whatsapp-call
        (() => {
          const fs = require("fs");
          const p = ".dbg/sighting-no-logs.env";
          let u = "http://127.0.0.1:7780/event";
          let s = "sighting-no-logs";
          try {
            const e = fs.readFileSync(p, "utf8");
            u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
            s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
          } catch {}
          fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: s,
              runId: "pre",
              hypothesisId: "C",
              location: "src/app/api/pets/[id]/timeline/route.ts:whatsapp-call",
              msg: "[DEBUG] calling notifyOwnerByWhatsApp",
              data: { petId: id, ownerPhone },
              ts: Date.now(),
              traceId,
            }),
          }).catch(() => {});
        })();
        // #endregion
        const whatsappResult = await notifyOwnerByWhatsApp({
          phone: ownerPhone,
          description: text,
          imageUrl: uploadedImageUrl,
        });
        // #region debug-point C:whatsapp-result
        (() => {
          const fs = require("fs");
          const p = ".dbg/sighting-no-logs.env";
          let u = "http://127.0.0.1:7780/event";
          let s = "sighting-no-logs";
          try {
            const e = fs.readFileSync(p, "utf8");
            u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
            s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
          } catch {}
          fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: s,
              runId: "pre",
              hypothesisId: "C",
              location: "src/app/api/pets/[id]/timeline/route.ts:whatsapp-result",
              msg: "[DEBUG] notifyOwnerByWhatsApp returned",
              data: { petId: id, ownerPhone, ok: whatsappResult.ok, reason: (whatsappResult as any).reason || "" },
              ts: Date.now(),
              traceId,
            }),
          }).catch(() => {});
        })();
        // #endregion
        await createNotificationDispatchLog({
          petId: id,
          ownerUserId,
          channel: "whatsapp_owner_sighting",
          status: whatsappResult.ok ? "sent" : "failed",
          metadata: {
            triggeredByUserId: authResult.user.id,
            receiverLabel: "原主人 WhatsApp",
            receiverContact: ownerPhone,
            reason: whatsappResult.ok ? null : whatsappResult.reason,
          },
        });
      }
    } catch (error) {
      // #region debug-point C:owner-whatsapp-catch
      (() => {
        const fs = require("fs");
        const p = ".dbg/sighting-no-logs.env";
        let u = "http://127.0.0.1:7780/event";
        let s = "sighting-no-logs";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "pre",
            hypothesisId: "C",
            location: "src/app/api/pets/[id]/timeline/route.ts:owner-whatsapp-catch",
            msg: "[DEBUG] owner whatsapp try/catch hit",
            data: { petId: id, error: error instanceof Error ? error.message : String(error) },
            ts: Date.now(),
            traceId,
          }),
        }).catch(() => {});
      })();
      // #endregion
      console.warn("[timeline] owner WhatsApp notify failed", {
        petId: id,
        ownerUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const district = (row.district || "").trim() || "全港";
      const targetUrl = origin ? `${origin}/?petId=${encodeURIComponent(id)}` : `/?petId=${encodeURIComponent(id)}`;
      await sendDistrictWebPush({
        district,
        excludeUserId: authResult.user.id,
        payload: {
          kind: "NEW_SIGHTING",
          district,
          petId: id,
          title: "有最新目擊回報！",
          body: `${time}：${text}`,
          icon: row.image_url || undefined,
          url: targetUrl,
          tag: `daydaypet:NEW_SIGHTING:${id}`,
        },
      });
    } catch (error) {
      console.warn("[timeline] district web push failed", {
        petId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      timeline: normalizeTimeline(updated?.timeline),
      district: row.district ?? null,
      petName: row.pet_name ?? "",
      imageUrl: row.image_url ?? "",
      address: displayAddress,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
    });
  } catch (error) {
    // #region debug-point D:unhandled
    (() => {
      const fs = require("fs");
      const p = ".dbg/sighting-no-logs.env";
      let u = "http://127.0.0.1:7780/event";
      let s = "sighting-no-logs";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
      } catch {}
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s,
          runId: "pre",
          hypothesisId: "D",
          location: "src/app/api/pets/[id]/timeline/route.ts:unhandled",
          msg: "[DEBUG] unhandled route error",
          data: { error: error instanceof Error ? error.message : String(error) },
          ts: Date.now(),
          traceId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        }),
      }).catch(() => {});
    })();
    // #endregion
    console.error("[timeline] unhandled route error", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
