export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getSystemSettings } from "@/lib/system-settings/server";

export async function GET() {
  try {
    const settings = await getSystemSettings();
    const logoUrl = settings.site_logo_url?.value?.trim() || "";
    return NextResponse.json({
      logoUrl,
      fallbackLogoUrl: "/logo.png",
      effectiveLogoUrl: logoUrl || "/logo.png",
    });
  } catch (error) {
    return NextResponse.json(
      {
        logoUrl: "",
        fallbackLogoUrl: "/logo.png",
        effectiveLogoUrl: "/logo.png",
      },
      { status: 200 },
    );
  }
}
