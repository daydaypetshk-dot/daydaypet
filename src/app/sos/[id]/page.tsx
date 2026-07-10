export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { headers } from "next/headers";

import SosShareRedirect from "./SosShareRedirect";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDisplayAddress } from "@/lib/pets/display";

type PetShareRow = {
  id: string;
  pet_name: string;
  location: string | null;
  manual_address: string | null;
  image_url: string | null;
  lost_time: string | null;
  features: string | null;
};

async function getRequestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  const fallback = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  if (!host) return fallback;
  return `${proto}://${host}`;
}

async function fetchPetRow(id: string) {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("pets")
    .select("id,pet_name,location,manual_address,image_url,lost_time,features")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as PetShareRow | null;
}

function toAbsoluteUrl(origin: string, value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, origin).toString();
  } catch {
    return "";
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const origin = await getRequestOrigin();
  const shareUrl = `${origin}/sos/${encodeURIComponent(id)}`;
  const pet = await fetchPetRow(id);

  const title = pet?.pet_name ? `[走失寵物] ${pet.pet_name}` : "【日日寵】尋寵地圖";
  const locationName = pet ? getDisplayAddress(pet.location || "", pet.manual_address) : "";
  const featureText = String(pet?.features || "").trim();
  const description = pet?.pet_name
    ? `請幫忙分享！在${locationName || "香港"}走失的${pet.pet_name}${featureText ? `，特徵：${featureText}` : ""}，尋求各界協助。點擊連結查看詳情。`
    : `請幫忙分享！點擊連結查看詳情：${shareUrl}`;
  const imageUrl = toAbsoluteUrl(origin, pet?.image_url);

  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: {
      canonical: shareUrl,
    },
    openGraph: {
      title,
      description,
      url: shareUrl,
      type: "article",
      siteName: "日日寵 尋寵地圖",
      locale: "zh_HK",
      images: imageUrl
        ? [
            {
              url: imageUrl,
              alt: pet?.pet_name ? `${pet.pet_name} 尋寵相片` : "日日寵 尋寵地圖",
            },
          ]
        : [],
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: imageUrl ? [imageUrl] : [],
    },
  };
}

export default async function SosSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const redirectTo = `/?petId=${encodeURIComponent(id)}`;
  return <SosShareRedirect to={redirectTo} />;
}
