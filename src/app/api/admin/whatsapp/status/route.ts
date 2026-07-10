export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { getWhatsAppStatus, resetWhatsAppSession } from "@/lib/whatsapp/client";

function isVercelDeployment() {
  return String(process.env.VERCEL ?? "").trim() === "1" || Boolean(String(process.env.VERCEL_ENV ?? "").trim());
}

export async function GET() {
  const guard = await assertAdminServer();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (isVercelDeployment()) {
    return NextResponse.json({
      enabled: true,
      state: "cloud_deployed",
      qrDataUrl: null,
      accountLabel: null,
      lastError: null,
      notice: "雲端服務已部署，WhatsApp Bridge 需要在指定伺服器運行。",
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const status = await getWhatsAppStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "讀取 WhatsApp 狀態失敗");
    return NextResponse.json(
      {
        enabled: false,
        state: "error",
        qrDataUrl: null,
        accountLabel: null,
        lastError: message,
        notice: null,
        updatedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}

export async function POST() {
  const guard = await assertAdminServer();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    await resetWhatsAppSession("admin_manual_reset");
    const status = await getWhatsAppStatus();
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "重設 WhatsApp 失敗");
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
