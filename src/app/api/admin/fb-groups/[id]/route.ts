export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { deleteFbMonitoredGroup, FbGroupInputError, updateFbMonitoredGroup } from "@/lib/fb-groups/server";

type PatchBody = {
  is_active?: boolean;
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const group = await updateFbMonitoredGroup(id, body);
    return NextResponse.json({ group });
  } catch (error) {
    if (error instanceof FbGroupInputError) {
      const isNotFound = error.message.includes("找不到");
      return NextResponse.json({ error: error.message }, { status: isNotFound ? 404 : 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新 Facebook 監控群組失敗" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;

  try {
    await deleteFbMonitoredGroup(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof FbGroupInputError) {
      const isNotFound = error.message.includes("找不到");
      return NextResponse.json({ error: error.message }, { status: isNotFound ? 404 : 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "刪除 Facebook 監控群組失敗" },
      { status: 500 },
    );
  }
}
