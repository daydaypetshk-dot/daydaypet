export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

import {
  getSubscriptionDistrictSummary,
  normalizeSubscriptionDistricts,
  type SubscriptionDistrict,
} from "@/lib/push/district-selection";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertAdminServer, isDeveloperAdminEmail, type UserRole } from "@/lib/auth/role";

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  createdAt: string;
  caseCount: number;
  sightingCount: number;
  subscriptionDistricts: SubscriptionDistrict[];
  subscriptionSummary: string;
  subscriptionCount: number;
  status: "active" | "banned";
  role: UserRole;
};

export async function GET(_req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = supabaseAdmin();

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });

  const users = usersData.users ?? [];
  const userIds = users.map((u) => u.id);

  const caseCountByUserId = new Map<string, number>();
  if (userIds.length) {
    const { data: petsRows, error: petsError } = await admin
      .from("pets")
      .select("user_id")
      .in("user_id", userIds)
      .limit(20000);
    if (petsError) return NextResponse.json({ error: petsError.message }, { status: 500 });

    for (const row of petsRows || []) {
      const id = row.user_id as string | null;
      if (!id) continue;
      caseCountByUserId.set(id, (caseCountByUserId.get(id) || 0) + 1);
    }
  }

  const sightingCountByUserId = new Map<string, number>();
  if (userIds.length) {
    const { data: sightingRows, error: sightingError } = await admin
      .from("pet_sightings")
      .select("user_id")
      .in("user_id", userIds)
      .limit(20000);
    if (sightingError) return NextResponse.json({ error: sightingError.message }, { status: 500 });

    for (const row of sightingRows || []) {
      const id = row.user_id as string | null;
      if (!id) continue;
      sightingCountByUserId.set(id, (sightingCountByUserId.get(id) || 0) + 1);
    }
  }

  const statusByUserId = new Map<string, "active" | "banned">();
  if (userIds.length) {
    const { data: statusRows, error: statusError } = await admin
      .from("user_statuses")
      .select("user_id,status")
      .in("user_id", userIds);
    if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 });

    for (const row of statusRows || []) {
      const id = String((row as any).user_id || "");
      const status = (row as any).status === "banned" ? "banned" : "active";
      if (id) statusByUserId.set(id, status);
    }
  }

  const roleByUserId = new Map<string, UserRole>();
  if (userIds.length) {
    const { data: roleRows, error: roleError } = await admin.from("user_roles").select("user_id,role").in("user_id", userIds);
    if (roleError) return NextResponse.json({ error: roleError.message }, { status: 500 });

    for (const row of roleRows || []) {
      const id = String((row as any).user_id || "");
      const role = (row as any).role === "admin" ? "admin" : "user";
      if (id) roleByUserId.set(id, role);
    }
  }

  const subscriptionDistrictsByUserId = new Map<string, SubscriptionDistrict[]>();
  const subscriptionCountByUserId = new Map<string, number>();
  if (userIds.length) {
    const { data: subscriptionRows, error: subscriptionError } = await admin
      .from("user_subscriptions")
      .select("user_id,districts")
      .in("user_id", userIds)
      .limit(20000);
    if (subscriptionError) return NextResponse.json({ error: subscriptionError.message }, { status: 500 });

    for (const row of subscriptionRows || []) {
      const id = String((row as any).user_id || "");
      if (!id) continue;
      const nextDistricts = normalizeSubscriptionDistricts((row as any).districts);
      const current = subscriptionDistrictsByUserId.get(id) || [];
      const merged = normalizeSubscriptionDistricts([...current, ...nextDistricts]);
      subscriptionDistrictsByUserId.set(id, merged);
      subscriptionCountByUserId.set(id, (subscriptionCountByUserId.get(id) || 0) + 1);
    }
  }

  const rows: AdminUserRow[] = users.map((u) => {
    const meta = (u.user_metadata || {}) as Record<string, unknown>;
    const name =
      typeof meta.full_name === "string"
        ? meta.full_name
        : typeof meta.name === "string"
          ? meta.name
          : "";
    const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : "";
    const email = u.email || "";
    const subscriptionDistricts = subscriptionDistrictsByUserId.get(u.id) || [];
    const subscriptionCount = subscriptionCountByUserId.get(u.id) || 0;

    return {
      id: u.id,
      email,
      name,
      avatarUrl,
      createdAt: u.created_at || "",
      caseCount: caseCountByUserId.get(u.id) || 0,
      sightingCount: sightingCountByUserId.get(u.id) || 0,
      subscriptionDistricts,
      subscriptionSummary:
        subscriptionDistricts.length > 0 ? getSubscriptionDistrictSummary(subscriptionDistricts) : "未訂閱",
      subscriptionCount,
      status: statusByUserId.get(u.id) || "active",
      role: roleByUserId.get(u.id) || (email && isDeveloperAdminEmail(email) ? "admin" : "user"),
    };
  });

  return NextResponse.json({ users: rows, viewerUserId: guard.user.id });
}

type PatchBody = {
  userId?: string;
  action?: "ban" | "unban" | "set_role";
  role?: UserRole;
};

export async function PATCH(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = String(body.userId || "").trim();
  const action = body.action;
  if (!userId || (action !== "ban" && action !== "unban" && action !== "set_role")) {
    return NextResponse.json({ error: "Missing userId/action" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  if (action === "set_role") {
    const role = body.role === "admin" ? "admin" : "user";
    if (userId === guard.user.id && role !== "admin") {
      return NextResponse.json({ error: "Cannot remove your own admin role" }, { status: 400 });
    }
    const { error: upsertError } = await admin.from("user_roles").upsert({ user_id: userId, role });
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
    return NextResponse.json({ ok: true, role });
  }

  const status = action === "ban" ? "banned" : "active";
  const { error: upsertError } = await admin.from("user_statuses").upsert({ user_id: userId, status });
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
