const path = require("node:path");
const fs = require("node:fs");

const express = require("express");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const PORT = Number(process.env.WHATSAPP_SERVICE_PORT || "3001");
const CLIENT_ID = process.env.WHATSAPP_WEB_CLIENT_ID || "daydaypet";
const AUTH_PATH = path.join(__dirname, ".wwebjs_auth");
const SESSION_PATH = path.join(AUTH_PATH, `session-${CLIENT_ID}`);

const status = {
  enabled: true,
  state: "initializing",
  qrDataUrl: null,
  accountLabel: null,
  lastError: null,
  updatedAt: new Date().toISOString(),
};

function markStatus(next) {
  Object.assign(status, next, { updatedAt: new Date().toISOString() });
}

function normalizeHongKongNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("852")) return digits;
  if (digits.length === 8) return `852${digits}`;
  return digits;
}

function cleanupZombieLocks() {
  const candidates = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
  for (const name of candidates) {
    const target = path.join(SESSION_PATH, name);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {}
  }
}

let client = null;

function attachClientEvents(nextClient) {
  nextClient.on("qr", async (qr) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      const terminalQr = await QRCode.toString(qr, { type: "terminal", small: true });
      markStatus({ state: "qr_ready", qrDataUrl, accountLabel: null, lastError: null });
      console.log("[WhatsAppService] ★ 請掃描最新 QR Code ★");
      console.log(terminalQr);
    } catch (error) {
      markStatus({
        state: "error",
        lastError: error instanceof Error ? error.message : String(error || "qr_failed"),
      });
    }
  });

  nextClient.on("authenticated", () => {
    markStatus({ state: "authenticated", lastError: null });
  });

  nextClient.on("ready", () => {
    const info = nextClient.info;
    markStatus({
      state: "ready",
      qrDataUrl: null,
      accountLabel: info?.pushname || info?.wid?.user || null,
      lastError: null,
    });
    console.log("[WhatsAppService] 🟢 WhatsApp 獨立服務已就緒！");
  });

  nextClient.on("auth_failure", (message) => {
    markStatus({ state: "auth_failure", lastError: message || "auth_failure" });
  });

  nextClient.on("disconnected", (reason) => {
    markStatus({ state: "disconnected", lastError: reason || "disconnected", qrDataUrl: null, accountLabel: null });
  });
}

async function startClient() {
  cleanupZombieLocks();
  const nextClient = new Client({
    authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: AUTH_PATH }),
    puppeteer: {
      headless: true,
      executablePath: process.env.WHATSAPP_CHROME_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-extensions"],
    },
  });
  attachClientEvents(nextClient);
  client = nextClient;
  markStatus({ state: "initializing", lastError: null });
  await nextClient.initialize();
}

async function resetClient(reason) {
  try {
    if (client) {
      await Promise.resolve(client.destroy());
    }
  } catch {}
  client = null;
  try {
    fs.rmSync(AUTH_PATH, { recursive: true, force: true });
  } catch {}
  markStatus({ state: "initializing", lastError: `reset:${reason || "manual"}`, qrDataUrl: null, accountLabel: null });
  await startClient();
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/status", async (_req, res) => {
  res.json(status);
});

app.post("/api/reset", async (req, res) => {
  const reason = req?.body?.reason || "manual_reset";
  try {
    await resetClient(reason);
    res.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "reset_failed");
    markStatus({ state: "error", lastError: message });
    res.status(500).json({ ok: false, error: message, status });
  }
});

app.post("/api/send", async (req, res) => {
  const number = normalizeHongKongNumber(req?.body?.number);
  const message = typeof req?.body?.message === "string" ? req.body.message : "";
  if (!number || !message.trim()) {
    res.status(400).json({ ok: false, error: "INVALID_INPUT" });
    return;
  }
  if (!client) {
    res.status(503).json({ ok: false, error: "CLIENT_NOT_READY" });
    return;
  }
  try {
    const chatId = `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "SEND_FAILED");
    res.status(500).json({ ok: false, error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[WhatsAppService] 🚀 WhatsApp API Server running on http://localhost:${PORT}`);
  console.log(`[WhatsAppService] WhatsApp bridge running on port ${PORT}`);
});

startClient().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || "init_failed");
  markStatus({ state: "error", lastError: message });
  console.error("[WhatsAppService] init failed:", message);
});
