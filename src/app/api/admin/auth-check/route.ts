export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { assertAdminServer } from "@/lib/auth/role";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const cookieNames = cookieStore
      .getAll()
      .map((c) => c.name)
      .filter(Boolean);

    const guard = await assertAdminServer();
    if (!guard.ok) {
      const reason = guard.status === 403 ? "not_admin" : "not_authenticated";
      return NextResponse.json(
        {
          ok: false,
          reason,
          error: guard.error,
          cookieNames,
          adminEmailsConfigured: Boolean(String(process.env.ADMIN_EMAILS || "").trim()),
          developerEmailConfigured: Boolean(String(process.env.DEVELOPER_EMAIL || "").trim()),
        },
        { status: guard.status },
      );
    }
    return NextResponse.json({
      ok: true,
      userId: guard.user.id,
      email: guard.user.email,
      role: guard.role,
      source: guard.source,
      cookieNames,
      adminEmailsConfigured: Boolean(String(process.env.ADMIN_EMAILS || "").trim()),
      developerEmailConfigured: Boolean(String(process.env.DEVELOPER_EMAIL || "").trim()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ ok: false, reason: "server_error", error: message, stack }, { status: 500 });
  }
}
