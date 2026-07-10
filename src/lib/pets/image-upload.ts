"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_BUCKET_NAME = "pet-images";

function extensionFromType(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export function validatePetImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("只支援 JPG / PNG / WEBP 圖片格式。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("圖片大小不可超過 5MB。");
  }
}

export function fileToDataUrl(file: File) {
  validatePetImageFile(file);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("讀取圖片失敗"));
    reader.readAsDataURL(file);
  });
}

export async function dataUrlToFile(dataUrl: string, filename = "pet-upload") {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = extensionFromType(blob.type || "image/jpeg");
  const file = new File([blob], `${filename}.${ext}`, {
    type: blob.type || "image/jpeg",
  });
  validatePetImageFile(file);
  return file;
}

export async function uploadPetImage(
  supabase: SupabaseClient,
  input: File | string,
  options?: { folder?: string; bucket?: string },
) {
  const file =
    typeof input === "string" ? await dataUrlToFile(input, "pet-from-cache") : input;

  validatePetImageFile(file);

  const bucket = options?.bucket ?? DEFAULT_BUCKET_NAME;
  const folder = options?.folder ?? "public";
  const ext = extensionFromType(file.type);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data.publicUrl) {
    throw new Error("圖片上傳成功，但無法取得公開網址。");
  }
  return data.publicUrl;
}
