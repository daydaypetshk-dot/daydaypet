import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SIGHTING_BUCKET_NAME = "sighting-attachments";

function extensionFromType(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("圖片格式無效，請重新選擇 JPG / PNG / WEBP。");
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("只支援 JPG / PNG / WEBP 圖片格式。");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("圖片內容為空，請重新上傳。");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("圖片大小不可超過 5MB。");
  }
  return { mimeType, buffer };
}

export async function uploadSightingAttachmentDataUrl(
  dataUrl: string,
  options: { petId: string; userId: string },
) {
  const { buffer, mimeType } = parseImageDataUrl(dataUrl);
  const admin = supabaseAdmin();
  const ext = extensionFromType(mimeType);
  const path = `${options.petId}/${options.userId}-${randomUUID()}.${ext}`;

  const { error: uploadError } = await admin.storage.from(SIGHTING_BUCKET_NAME).upload(path, buffer, {
    cacheControl: "3600",
    upsert: false,
    contentType: mimeType,
  });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data } = admin.storage.from(SIGHTING_BUCKET_NAME).getPublicUrl(path);
  if (!data.publicUrl) {
    throw new Error("圖片上傳成功，但無法取得公開網址。");
  }

  return data.publicUrl;
}
