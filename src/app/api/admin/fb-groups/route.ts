export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import {
  createFbMonitoredGroup,
  FbGroupConflictError,
  FbGroupInputError,
  listFbMonitoredGroups,
} from "@/lib/fb-groups/server";

type CreateBody = {
  group_name: unknown;
  group_url: unknown;
};

export async function GET() {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const groups = await listFbMonitoredGroups();
    return NextResponse.json({ groups });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "讀取 Facebook 監控群組失敗" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const group = await createFbMonitoredGroup(body);
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    if (error instanceof FbGroupInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof FbGroupConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "新增 Facebook 監控群組失敗" },
      { status: 500 },
    );
  }
}
