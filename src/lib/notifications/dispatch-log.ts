import { supabaseAdmin } from "@/lib/supabase/admin";

export type NotificationDispatchChannel =
  | "whatsapp_owner_sighting"
  | "in_app_owner_sighting"
  | "whatsapp_admin_pending_report"
  | "whatsapp_reporter_approved";
export type NotificationDispatchStatus = "sent" | "skipped_rate_limited" | "failed";

type CreateDispatchLogInput = {
  petId: string;
  ownerUserId?: string | null;
  channel: NotificationDispatchChannel;
  status: NotificationDispatchStatus;
  metadata?: Record<string, unknown>;
};

export async function createNotificationDispatchLog(input: CreateDispatchLogInput) {
  const admin = supabaseAdmin();
  const baseMetadata = input.metadata ?? {};
  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // #region debug-point D:dispatch-insert-start
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
        location: "src/lib/notifications/dispatch-log.ts:insert",
        msg: "[DEBUG] dispatch log insert attempt",
        data: { petId: input.petId, channel: input.channel, status: input.status },
        ts: Date.now(),
        traceId,
      }),
    }).catch(() => {});
  })();
  // #endregion

  const insertFull = async (
    override?: Partial<{ status: string; channel: string; metadata: Record<string, unknown> }>,
  ) => {
    return admin.from("notification_dispatch_logs").insert({
      pet_id: input.petId,
      owner_user_id: input.ownerUserId ?? null,
      channel: override?.channel ?? input.channel,
      status: override?.status ?? input.status,
      metadata: override?.metadata ?? baseMetadata,
    });
  };

  const { error } = await insertFull();
  if (!error) return;

  const message = String(error.message || "");
  // #region debug-point D:dispatch-insert-error
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
        location: "src/lib/notifications/dispatch-log.ts:error",
        msg: "[DEBUG] dispatch log insert error",
        data: { petId: input.petId, channel: input.channel, status: input.status, error: message },
        ts: Date.now(),
        traceId,
      }),
    }).catch(() => {});
  })();
  // #endregion

  if (message.includes("column") && (message.includes("status") || message.includes("owner_user_id"))) {
    // #region debug-point D:dispatch-retry-legacy-columns
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
          location: "src/lib/notifications/dispatch-log.ts:retry-legacy-columns",
          msg: "[DEBUG] retry legacy dispatch log insert (no status/owner_user_id columns)",
          data: { petId: input.petId, channel: input.channel },
          ts: Date.now(),
          traceId,
        }),
      }).catch(() => {});
    })();
    // #endregion
    const { error: retryError } = await admin.from("notification_dispatch_logs").insert({
      pet_id: input.petId,
      channel: input.channel,
      metadata: baseMetadata,
    });
    if (!retryError) return;
    throw new Error(retryError.message);
  }

  if (
    input.status === "failed" &&
    (message.includes("notification_dispatch_logs_status_check") || message.includes("status_check"))
  ) {
    // #region debug-point D:dispatch-retry-legacy-status
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
          location: "src/lib/notifications/dispatch-log.ts:retry-legacy-status",
          msg: "[DEBUG] retry legacy status dispatch log insert (fallback to sent + legacyStatus)",
          data: { petId: input.petId, channel: input.channel, status: input.status },
          ts: Date.now(),
          traceId,
        }),
      }).catch(() => {});
    })();
    // #endregion
    const { error: retryError } = await insertFull({
      status: "sent",
      metadata: { ...baseMetadata, legacyStatus: "failed" },
    });
    if (!retryError) return;
    throw new Error(retryError.message);
  }

  throw new Error(error.message);
}
