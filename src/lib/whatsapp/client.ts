import { withTimeout } from "@/lib/server/promise-timeout";

export type WhatsAppBridgeState =
  | "disabled"
  | "initializing"
  | "qr_ready"
  | "authenticated"
  | "ready"
  | "auth_failure"
  | "disconnected"
  | "cloud_deployed"
  | "error";

export type WhatsAppStatus = {
  enabled: boolean;
  state: WhatsAppBridgeState;
  qrDataUrl: string | null;
  accountLabel: string | null;
  lastError: string | null;
  notice: string | null;
  updatedAt: string | null;
};

type WhatsAppSendResult = { ok: true } | { ok: false; reason: string };

const SERVICE_URL = (() => {
  const raw = String(process.env.WHATSAPP_SERVICE_URL || "http://127.0.0.1:3001").trim();
  const normalized = raw.replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1");
  return normalized.replace(/\/+$/, "");
})();
const enabled = process.env.WHATSAPP_WEB_ENABLED === "true";

function createStatus(next: Partial<WhatsAppStatus> = {}): WhatsAppStatus {
  const base: WhatsAppStatus = {
    enabled,
    state: enabled ? "initializing" : "disabled",
    qrDataUrl: null,
    accountLabel: null,
    lastError: null,
    notice: null,
    updatedAt: null,
  };
  return { ...base, ...next, enabled };
}

function normalizeHongKongNumber(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("852")) return digits;
  if (digits.length === 8) return `852${digits}`;
  return digits;
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 12_000): Promise<T> {
  return withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof (json as any)?.error === "string"
            ? (json as any).error
            : `HTTP_${res.status}`;
        throw new Error(msg);
      }
      return json as T;
    }),
    timeoutMs,
    `[whatsapp-service] request timeout: ${url}`,
  );
}

async function getJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  return withTimeout(
    fetch(url, { method: "GET" }).then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof (json as any)?.error === "string"
            ? (json as any).error
            : `HTTP_${res.status}`;
        throw new Error(msg);
      }
      return json as T;
    }),
    timeoutMs,
    `[whatsapp-service] request timeout: ${url}`,
  );
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  if (!enabled) return createStatus({ state: "disabled" });
  try {
    const remote = await getJson<Partial<WhatsAppStatus>>(`${SERVICE_URL}/api/status`);
    return createStatus({
      state: (remote.state as WhatsAppBridgeState) || "initializing",
      qrDataUrl: typeof remote.qrDataUrl === "string" ? remote.qrDataUrl : null,
      accountLabel: typeof remote.accountLabel === "string" ? remote.accountLabel : null,
      lastError: typeof remote.lastError === "string" ? remote.lastError : null,
      notice: typeof remote.notice === "string" ? remote.notice : null,
      updatedAt: typeof remote.updatedAt === "string" ? remote.updatedAt : null,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "SERVICE_UNAVAILABLE");
    const connectionHint =
      rawMessage.includes("fetch failed") || rawMessage.includes("ECONNREFUSED") || rawMessage.includes("timeout")
        ? `WhatsApp bridge 未啟動或無法連線（${SERVICE_URL}）。請另開終端機執行：npm run whatsapp`
        : rawMessage;
    return createStatus({
      state: "error",
      lastError: connectionHint,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function resetWhatsAppSession(reason = "manual_reset") {
  if (!enabled) return;
  await postJson(`${SERVICE_URL}/api/reset`, { reason }, 20_000).catch(() => {});
}

export async function sendWhatsAppText(phone: string, message: string): Promise<WhatsAppSendResult> {
  if (!enabled) return { ok: false, reason: "disabled" };
  const number = normalizeHongKongNumber(phone);
  if (!number) return { ok: false, reason: "invalid_phone" };
  const text = String(message || "");
  if (!text.trim()) return { ok: false, reason: "empty_message" };
  try {
    await postJson(`${SERVICE_URL}/api/send`, { number, message: text }, 20_000);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error || "send_failed") };
  }
}
