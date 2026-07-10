import { sendWhatsAppText } from "@/lib/whatsapp/client";

type OwnerSightingWhatsAppInput = {
  phone: string | null | undefined;
  description: string;
  imageUrl?: string | null | undefined;
};

type AdminPendingSightingWhatsAppInput = {
  phone: string | null | undefined;
  petName: string;
  reportedAt: string;
  approvalUrl: string;
};

type ReporterApprovedWhatsAppInput = {
  phone: string | null | undefined;
  petId: string;
  petName: string;
  features?: string | null | undefined;
  appUrl: string;
};

export async function notifyOwnerByWhatsApp(input: OwnerSightingWhatsAppInput) {
  const phone = String(input.phone || "").trim();
  if (!phone) {
    return { ok: false as const, reason: "missing_phone" };
  }
  const description = String(input.description || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const message = [
    "🔴【日日寵】有人剛目擊疑似你的毛孩！",
    "",
    `最新線索情報：${description}`,
    "",
    "請立刻到網頁的小鈴鐺或時間軸查看詳情！",
    ...(imageUrl ? ["", `最新現場相片線索：${imageUrl}`] : []),
  ].join("\n");
  return sendWhatsAppText(phone, message);
}

export async function notifyAdminPendingSightingByWhatsApp(input: AdminPendingSightingWhatsAppInput) {
  const phone = String(input.phone || "").trim();
  if (!phone) {
    return { ok: false as const, reason: "missing_phone" };
  }
  const petName = input.petName.trim() || "未命名毛孩";
  const reportedAt = input.reportedAt.trim() || "未提供";
  const approvalUrl = input.approvalUrl.trim() || "http://localhost:3000/admin/dashboard";
  const message = [
    "🚨【日日寵 - 管理員通知】有全新的目擊情報等待審批！",
    `🐾 毛孩名字：${petName}`,
    `📅 報料時間：${reportedAt}`,
    `🔗 立即前往後台審批：${approvalUrl}`,
  ].join("\n");
  return sendWhatsAppText(phone, message);
}

export async function notifyReporterApprovedByWhatsApp(input: ReporterApprovedWhatsAppInput) {
  const phone = String(input.phone || "").trim();
  if (!phone) {
    return { ok: false as const, reason: "missing_phone" };
  }
  const petName = input.petName.trim();
  const featureText = String(input.features || "").trim();
  const petSummary = petName || featureText || "未命名毛孩";
  const appUrl = input.appUrl.trim().replace(/\/+$/, "") || "http://localhost:3000";
  const viewUrl = `${appUrl}/?petId=${encodeURIComponent(input.petId)}`;
  const message = [
    "【Day Day Pets 日日寵】好消息！",
    `您之前提交的寵物報料（毛孩名稱/特徵：${petSummary}）已經通過管理員審核，正式批准上架發布喇！`,
    "感謝您的熱心幫忙，希望毛孩早日平安回家。",
    `查看連結：${viewUrl}`,
  ].join("\n");
  return sendWhatsAppText(phone, message);
}
