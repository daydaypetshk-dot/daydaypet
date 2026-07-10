import { NextResponse } from "next/server";

const MAINTENANCE_COOKIE_NAME = "maintenance_access";

function getExpectedMaintenancePassword() {
  return String(process.env.MAINTENANCE_MODE_PASSWORD ?? "").trim();
}

export async function POST(req: Request) {
  const expectedPassword = getExpectedMaintenancePassword();
  if (!expectedPassword) {
    return NextResponse.json({ ok: false, error: "未設定維護模式密碼。" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { password?: string; next?: string } | null;
  const password = String(body?.password ?? "").trim();
  const nextPath = String(body?.next ?? "/").trim();

  if (!password || password !== expectedPassword) {
    return NextResponse.json({ ok: false, error: "密碼錯誤，請再試一次。" }, { status: 401 });
  }

  const redirectTo = nextPath.startsWith("/") ? nextPath : "/";
  const res = NextResponse.json({ ok: true, redirectTo });
  res.cookies.set(MAINTENANCE_COOKIE_NAME, expectedPassword, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
