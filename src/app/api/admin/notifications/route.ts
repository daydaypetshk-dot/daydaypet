export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/admin";

type NotificationLogRow = {
  id: string;
  petId: string;
  petName: string;
  receiverUserId: string | null;
  receiverName: string;
  receiverEmail: string;
  receiverContact: string;
  channel:
    | "whatsapp_owner_sighting"
    | "in_app_owner_sighting"
    | "whatsapp_admin_pending_report"
    | "whatsapp_reporter_approved";
  status: "sent" | "skipped_rate_limited" | "failed";
  createdAt: string;
};

function getUserDisplayName(user: any) {
  const meta = (user?.user_metadata || {}) as Record<string, unknown>;
  return typeof meta.full_name === "string"
    ? meta.full_name
    : typeof meta.name === "string"
      ? meta.name
      : "";
}

export async function GET(_req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = supabaseAdmin();
  const { data: rows, error } = await admin
    .from("notification_dispatch_logs")
    .select("id,pet_id,owner_user_id,channel,status,created_at,metadata,pets!inner(id,pet_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const receiverIds = Array.from(
    new Set(
      (rows ?? [])
        .map((row: any) => String(row.owner_user_id || "").trim())
        .filter(Boolean),
    ),
  );

  const userById = new Map<string, { name: string; email: string }>();
  if (receiverIds.length) {
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }
    for (const user of usersData.users ?? []) {
      if (!receiverIds.includes(user.id)) continue;
      userById.set(user.id, {
        name: getUserDisplayName(user),
        email: user.email || "",
      });
    }
  }

  const logs: NotificationLogRow[] = (rows ?? []).map((row: any) => {
    const receiverUserId = String(row.owner_user_id || "") || null;
    const receiver = receiverUserId ? userById.get(receiverUserId) : undefined;
    const metadata = (row.metadata || {}) as Record<string, unknown>;
    const fallbackReceiverName =
      typeof metadata.receiverLabel === "string" ? metadata.receiverLabel : "";
    const receiverContact = typeof metadata.receiverContact === "string" ? metadata.receiverContact : "";
    const fallbackReceiverEmail = receiverContact;
    const legacyStatus = typeof metadata.legacyStatus === "string" ? metadata.legacyStatus : "";
    return {
      id: row.id,
      petId: row.pet_id,
      petName: row.pets?.pet_name || row.pet_id,
      receiverUserId,
      receiverName: receiver?.name || fallbackReceiverName,
      receiverEmail: receiver?.email || fallbackReceiverEmail,
      receiverContact,
      channel: row.channel,
      status:
        legacyStatus === "failed"
          ? "failed"
          : row.status === "skipped_rate_limited"
          ? "skipped_rate_limited"
          : row.status === "failed"
            ? "failed"
            : "sent",
      createdAt: row.created_at,
    };
  });

  return NextResponse.json({ logs });
}
