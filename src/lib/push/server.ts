import webpush from "web-push";

import { matchesSubscriptionDistrict, normalizeSubscriptionDistricts } from "@/lib/push/district-selection";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type WebPushPayload = {
  title: string;
  body: string;
  icon?: string;
  url: string;
  tag?: string;
  kind: "NEW_CASE" | "NEW_SIGHTING";
  district: string;
  petId: string;
};

function loadVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT");
  }
  return { publicKey, privateKey, subject };
}

export async function sendDistrictWebPush({
  district,
  payload,
  excludeUserId,
}: {
  district: string | null | undefined;
  payload: WebPushPayload;
  excludeUserId?: string | null;
}) {
  const resolvedDistrict = (district || "").trim() || "全港";
  const { publicKey, privateKey, subject } = loadVapid();
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = supabaseAdmin();
  let q = admin
    .from("user_subscriptions")
    .select("id,user_id,endpoint,subscription_json,districts");

  if (excludeUserId) {
    q = q.neq("user_id", excludeUserId);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = (Array.isArray(data) ? data : []).filter((row: any) =>
    matchesSubscriptionDistrict(resolvedDistrict, normalizeSubscriptionDistricts(row?.districts)),
  );
  let sent = 0;
  let removed = 0;

  for (const row of rows as any[]) {
    try {
      await webpush.sendNotification(row.subscription_json, JSON.stringify(payload));
      sent += 1;
    } catch (err: any) {
      const statusCode = typeof err?.statusCode === "number" ? err.statusCode : null;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("user_subscriptions").delete().eq("id", row.id);
        removed += 1;
      }
    }
  }

  return { sent, removed, matched: rows.length, district: resolvedDistrict };
}
