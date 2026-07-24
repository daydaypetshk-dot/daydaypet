"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DivIcon } from "leaflet";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { RealtimeChannel, Session, User } from "@supabase/supabase-js";

import {
  type CaseIdentityCategory,
  CONTACT_IDENTITY_OPTIONS,
  getCaseIdentityCategory,
  getContactActionTarget,
  getDefaultCaseTypeForIdentity,
  getContactIdentityLabel,
  needsSourceLink,
  normalizeContactIdentity,
  syncIdentityWithCaseType,
  type ContactIdentityType,
} from "@/lib/pets/contact-identity";
import AppToast from "@/components/AppToast";
import PhotoWatermarkOverlay from "@/components/PhotoWatermarkOverlay";
import type { SosMapCanvasProps } from "@/components/SosMapCanvas";
import { downloadPosterPdf, type PetFormValues } from "@/components/PosterGenerator";
import type { PetRow, PetTimelineItem } from "@/lib/pets/db";
import { getDisplayAddress } from "@/lib/pets/display";
import {
  geocodeHongKongAddress,
  reverseGeocodeHongKong,
  searchHongKongAddresses,
  type GeocodeResult,
} from "@/lib/pets/geocoding";
import { fileToDataUrl, uploadPetImage } from "@/lib/pets/image-upload";
import {
  ALL_DISTRICTS_TOKEN,
  getDistrictCheckboxOptions,
  getRealtimeChannelNames,
  getSubscriptionDistrictLabels,
  getSubscriptionDistrictSummary,
  normalizeSubscriptionDistricts,
  type SubscriptionDistrict,
} from "@/lib/push/district-selection";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "life" | "sos";

type SosSpeciesFilter = "all" | "cat" | "dog" | "bird" | "other";
type MapLegendFilterState = Record<CaseIdentityCategory, boolean>;

type SosCase = {
  id: string;
  species: Exclude<SosSpeciesFilter, "all">;
  breed: string | null;
  caseType: "lost" | "spotted_unrescued" | "found_rescued";
  sourceLabel: string;
  contactIdentityType: ContactIdentityType;
  contactIdentity: string;
  sourceUrl: string;
  title: string;
  locationName: string;
  lostTime: string;
  features: string;
  phone: string;
  position: [number, number];
  avatarUrl: string;
  photoUrl: string;
  pulseColor: "red" | "blue" | "green";
  timeline: PetTimelineItem[];
  district: string | null;
  enablePrivacy?: boolean | null;
};

type DistrictNotificationKind = "NEW_CASE" | "NEW_SIGHTING";

type DistrictNotification = {
  id: string;
  kind: DistrictNotificationKind;
  district: string;
  title: string;
  message: string;
  petId: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
  createdAt: number;
  unread: boolean;
};

type AppNotification = {
  id: string;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  petId: string | null;
};

type PushSubscriptionJson = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

type AddressSuggestion = GeocodeResult & {
  id: string;
};

type PetBreedOption = {
  id: string;
  pet_type: "cat" | "dog" | "bird";
  breed_name: string;
  sort_order: number;
};

type GuideSubcategoryOption = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
};

type GuideCategoryOption = {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  subcategories: GuideSubcategoryOption[];
};

type GuidePlaceRow = {
  id: string;
  category_id: string;
  subcategory_id: string;
  subcategory_ids: string[];
  name: string;
  district: string;
  address: string;
  opening_hours: string | null;
  plus_code: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  image_urls: string[];
  facility_tag_ids: string[];
  has_grass: boolean;
  has_wash_station: boolean;
  has_fencing: boolean;
  has_parking: boolean;
  metadata?: unknown;
};

type FacilityTagOption = {
  id: string;
  name: string;
  icon: string;
  legacy_key: string | null;
  sort_order: number;
};

type GuidePlaceFeatureBadge = {
  key: string;
  label: string;
  className: string;
};

type LifeGuideItem = GuidePlaceRow & {
  category_name: string;
  category_icon: string;
  subcategory_name: string;
  subcategory_names: string[];
  title: string;
  position: [number, number] | null;
  featureBadges: GuidePlaceFeatureBadge[];
  distance_meters?: number | null;
};

const FOLLOW_DISTRICTS_STORAGE_KEY = "daydaypet_follow_districts_v2";
const NOTIFICATIONS_STORAGE_KEY = "daydaypet_notifications_v1";
const PUSH_SUBSCRIBED_DISTRICTS_STORAGE_KEY = "daydaypet_push_subscribed_districts_v2";
const AUTH_REFRESH_RETRY_DELAYS_MS = [0, 250, 700, 1500];

type CitizenReportForm = {
  caseType: "lost" | "spotted_unrescued" | "found_rescued";
  petType: Exclude<SosSpeciesFilter, "all">;
  breed: string;
  sourceType: ContactIdentityType;
  sourceLink: string;
  petName: string;
  phone: string;
  location: string;
  lostTime: string;
  features: string;
  latitude: number | null;
  longitude: number | null;
  manualAddress: string;
  imageUrl: string;
  email: string;
  enablePrivacy: boolean;
};

type MapFocusPoint = {
  center: [number, number];
  zoom?: number;
};

const PENDING_REPORT_STORAGE_KEY = "pending_report_data";
const DEFAULT_MAP_LEGEND_FILTERS: MapLegendFilterState = {
  seeking: true,
  sighting: true,
  rescued: true,
};

const HONG_KONG_DISTRICTS: Record<string, { center: [number, number]; zoom: number }> = {
  全部: { center: [22.3193, 114.1694], zoom: 11 },
  中西區: { center: [22.2867, 114.1557], zoom: 14 },
  灣仔區: { center: [22.2797, 114.1717], zoom: 14 },
  東區: { center: [22.2841, 114.2241], zoom: 14 },
  南區: { center: [22.2473, 114.1588], zoom: 14 },
  油尖旺區: { center: [22.3116, 114.1707], zoom: 14 },
  深水埗區: { center: [22.3294, 114.1606], zoom: 14 },
  九龍城區: { center: [22.3233, 114.1903], zoom: 14 },
  黃大仙區: { center: [22.3422, 114.196], zoom: 14 },
  觀塘區: { center: [22.3104, 114.2231], zoom: 14 },
  葵青區: { center: [22.3549, 114.1261], zoom: 14 },
  荃灣區: { center: [22.3686, 114.1131], zoom: 14 },
  屯門區: { center: [22.3916, 113.9709], zoom: 14 },
  元朗區: { center: [22.4456, 114.0222], zoom: 14 },
  北區: { center: [22.4947, 114.1381], zoom: 14 },
  大埔區: { center: [22.4508, 114.1642], zoom: 14 },
  沙田區: { center: [22.3757, 114.183], zoom: 14 },
  西貢區: { center: [22.3814, 114.2705], zoom: 14 },
  離島區: { center: [22.2611, 113.9461], zoom: 12 },
};

const SosMapCanvas = dynamic(() => import("@/components/SosMapCanvas"), {
  ssr: false,
});

const defaultCitizenReportForm = (): CitizenReportForm => ({
  caseType: "lost",
  petType: "cat",
  breed: "",
  sourceType: "owner",
  sourceLink: "",
  petName: "",
  phone: "",
  location: "",
  lostTime: new Date().toISOString(),
  features: "",
  latitude: null,
  longitude: null,
  manualAddress: "",
  imageUrl: "",
  email: "",
  enablePrivacy: true,
});

type TimelineImageLightboxProps = {
  src: string;
  onClose: () => void;
};

function TimelineImageLightbox({ src, onClose }: TimelineImageLightboxProps) {
  const dragStateRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(1, Number((prev - 0.5).toFixed(2))));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(6, Number((prev + 0.5).toFixed(2))));
  }, []);

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragStateRef.current.pointerId = null;
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scale <= 1) return;
      event.preventDefault();
      event.stopPropagation();
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      };
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [offset.x, offset.y, scale],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!isDragging || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setOffset({
        x: drag.originX + dx,
        y: drag.originY + dy,
      });
    },
    [isDragging],
  );

  const finishDrag = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (event && drag.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current.pointerId = null;
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setScale((prev) => {
      const delta = event.deltaY < 0 ? 0.2 : -0.2;
      return Math.max(1, Math.min(6, Number((prev + delta).toFixed(2))));
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    resetTransform();
  }, [resetTransform, src]);

  useEffect(() => {
    if (scale <= 1) {
      setOffset({ x: 0, y: 0 });
    }
  }, [scale]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999999,
        backgroundColor: "rgba(0, 0, 0, 0.95)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉放大相片"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-2xl font-black text-white shadow-2xl ring-1 ring-white/20 transition hover:bg-black/85 sm:h-16 sm:w-16"
        style={{
          position: "absolute",
          top: "24px",
          right: "24px",
          zIndex: 1000002,
          cursor: "pointer",
        }}
      >
        X
      </button>

      <div className="flex h-full w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <div
          className="relative flex h-full w-full items-center justify-center overflow-hidden"
          style={{
            paddingTop: "88px",
            paddingBottom: "120px",
            paddingLeft: "8px",
            paddingRight: "8px",
          }}
        >
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden"
            onWheel={handleWheel}
          >
            <div
              className={[
                "relative inline-flex max-h-full max-w-full items-center justify-center transition-transform duration-150",
                scale > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
              ].join(" ")}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: "center center",
              }}
            >
              <img
                src={src}
                alt="目擊現場相片全圖"
                className="block max-h-full max-w-full select-none object-contain"
                draggable={false}
              />
              <PhotoWatermarkOverlay />
            </div>
          </div>
          <div
            className="pointer-events-none"
            style={{
              position: "absolute",
              bottom: "40px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1000002,
              backgroundColor: "rgba(255, 255, 255, 0.15)",
              backdropFilter: "blur(4px)",
              padding: "8px 16px",
              borderRadius: "9999px",
              display: "flex",
              gap: "16px",
              alignItems: "center",
            }}
          >
            <div className="pointer-events-auto flex items-center gap-3">
              <button
                type="button"
                onClick={zoomOut}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/12 text-2xl font-black text-white transition hover:bg-white/20"
                aria-label="縮小圖片"
              >
                -
              </button>
              <button
                type="button"
                onClick={resetTransform}
                className="flex h-12 min-w-[6.5rem] items-center justify-center rounded-full bg-white/12 px-4 text-base font-black text-white transition hover:bg-white/20"
                aria-label="重設圖片位置與縮放"
              >
                🔄 重設
              </button>
              <button
                type="button"
                onClick={zoomIn}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/12 text-2xl font-black text-white transition hover:bg-white/20"
                aria-label="放大圖片"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseIsoToLocalParts(value: string): { date: string; hour: string; minute: string } | null {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hour = pad2(d.getHours());
  const minute = pad2(d.getMinutes());
  return { date, hour, minute };
}

function buildIsoFromLocalParts(date: string, hour: string, minute: string) {
  if (!date) return "";
  const d = new Date(`${date}T${hour}:${minute}:00`);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString();
}

function parseLeafletCoordinate(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getPushSubscriptionErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const lower = raw.toLowerCase();
  if (lower.includes("push service not available")) {
    return "此瀏覽器目前未提供系統級推播服務，暫時無法啟用離線通知。你仍可接收站內即時通知。";
  }
  if (lower.includes("permission denied") || lower.includes("denied")) {
    return "瀏覽器已封鎖通知權限，請先到網址列旁的權限設定開啟通知。";
  }
  if (lower.includes("no active service worker")) {
    return "通知服務尚未準備完成，請重新整理頁面後再試。";
  }
  if (lower.includes("registration failed")) {
    return "通知服務註冊失敗，請確認目前使用的是 localhost 或 HTTPS 網站。";
  }
  return "無法建立 Push Subscription，可能是瀏覽器或裝置暫不支援離線推播。";
}

function formatHongKongDateTime(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value?.trim() || "時間：暫未提供";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function waitForMs(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

const MOCK_SOS_CASES: SosCase[] = [
  {
    id: "case-a",
    species: "cat",
    breed: "唐貓 / 家貓",
    caseType: "lost",
    sourceLabel: "社交媒體轉貼 (主人帖文)",
    contactIdentityType: "repost_owner",
    contactIdentity: "社交媒體轉貼 (主人帖文)",
    sourceUrl: "https://www.threads.com/",
    title: "豆豉（失貓）",
    locationName: "旺角朗豪坊後巷",
    lostTime: "今日 14:00",
    features: "親人、帶有紅色頸圈。",
    phone: "9123 4567",
    position: [22.3182, 114.1687],
    avatarUrl:
      "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?auto=format&fit=crop&w=200&h=200&q=80",
    photoUrl:
      "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?auto=format&fit=crop&w=1200&h=1200&q=90",
    pulseColor: "red",
    timeline: [],
    district: "油尖旺區",
  },
  {
    id: "case-b",
    species: "dog",
    breed: "柴犬",
    caseType: "spotted_unrescued",
    sourceLabel: "社交媒體轉貼 (路人目擊)",
    contactIdentityType: "repost_sighting",
    contactIdentity: "社交媒體轉貼 (路人目擊)",
    sourceUrl: "https://www.facebook.com/",
    title: "市民目擊柴犬",
    locationName: "大角咀埃華街附近",
    lostTime: "今日 16:10",
    features: "左耳已剪、親人有晶片。",
    phone: "6345 7788",
    position: [22.3229, 114.1608],
    avatarUrl:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=200&h=200&q=80",
    photoUrl:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=1200&h=1200&q=90",
    pulseColor: "blue",
    timeline: [],
    district: "油尖旺區",
  },
  {
    id: "case-c",
    species: "cat",
    breed: "其他 / 不確定品種",
    caseType: "found_rescued",
    sourceLabel: "🏡 已救起搵主人",
    contactIdentityType: "rescued_finder",
    contactIdentity: "🏡 已救起搵主人",
    sourceUrl: "daydaypet://rescued-demo",
    title: "已救起虎紋貓",
    locationName: "深水埗欽州街附近",
    lostTime: "今日 18:20",
    features: "已安置，性格溫和，正在等主人認領。",
    phone: "9555 2233",
    position: [22.3308, 114.1622],
    avatarUrl:
      "https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=200&h=200&q=80",
    photoUrl:
      "https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=1200&h=1200&q=90",
    pulseColor: "green",
    timeline: [],
    district: "深水埗區",
  },
];

function inferSpecies(text: string): Exclude<SosSpeciesFilter, "all"> {
  const t = text.toLowerCase();
  if (t.includes("貓") || t.includes("cat")) return "cat";
  if (t.includes("狗") || t.includes("dog")) return "dog";
  if (t.includes("鸚") || t.includes("bird") || t.includes("雀")) return "bird";
  return "other";
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function toSosCaseFromRow(p: PetRow): SosCase | null {
  try {
    const lat = parseLeafletCoordinate(p.latitude);
    const lng = parseLeafletCoordinate(p.longitude);
    if (lat == null || lng == null) return null;
    const species = p.pet_type ?? inferSpecies(`${p.pet_name} ${p.features} ${p.location}`);
    const caseType = p.case_type;
    const identity = normalizeContactIdentity(p.source_type, p.case_type);
    const category = getCaseIdentityCategory(identity);
    const pulseColor: "red" | "blue" | "green" =
      category === "seeking" ? "red" : category === "rescued" ? "green" : "blue";
    const sourceUrl = String(p.source_link || p.source_url || "").trim();
    const timeline = Array.isArray(p.timeline)
      ? (p.timeline as PetTimelineItem[]).filter(
          (t) => t && typeof t === "object" && typeof t.time === "string" && typeof t.text === "string",
        )
      : [];
    return {
      id: p.id,
      species,
      breed: typeof p.breed === "string" ? p.breed.trim() || null : null,
      caseType,
      sourceLabel: getContactIdentityLabel(identity),
      contactIdentityType: identity,
      contactIdentity: getContactIdentityLabel(identity),
      sourceUrl,
      title: p.pet_name,
      locationName: getDisplayAddress(p.location, p.manual_address) || "未提供位置",
      lostTime: typeof p.lost_time === "string" ? p.lost_time : "",
      features: p.features,
      phone: p.phone,
      position: [lat, lng] as [number, number],
      avatarUrl: p.image_url,
      photoUrl: p.image_url,
      pulseColor,
      timeline,
      district: p.district ?? null,
      enablePrivacy:
        (p as PetRow & { enablePrivacy?: boolean | null; enable_privacy?: boolean | null }).enablePrivacy ??
        (p as PetRow & { enablePrivacy?: boolean | null; enable_privacy?: boolean | null }).enable_privacy ??
        null,
    };
  } catch (error) {
    console.error("Failed to map SOS case row:", p?.id, error);
    return null;
  }
}

function toPosterValuesFromCase(c: SosCase): PetFormValues {
  return {
    petName: c.title,
    location: c.locationName,
    lostTime: c.lostTime,
    features: c.features,
    phone: c.phone,
    qrUrl: c.sourceUrl,
    petImage: c.photoUrl,
    mapSnapshotUrl: "",
  };
}

function buildMarkerHtml(avatarUrl: string, pulseColor: "red" | "blue" | "green") {
  const markerClass = pulseColor === "red" ? "dp-marker-red" : pulseColor === "green" ? "dp-marker-green" : "dp-marker-blue";
  const safeUrl = String(avatarUrl || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const content = safeUrl
    ? `<img class="dp-marker-img" src="${safeUrl}" alt="" />`
    : `<div class="dp-marker-fallback" aria-hidden="true">🐾</div>`;
  return `<div class="dp-marker ${markerClass}">${content}</div>`;
}

function buildDivIcon(
  Lmod: typeof import("leaflet"),
  avatarUrl: string,
  pulseColor: "red" | "blue" | "green",
): DivIcon {
  return Lmod.divIcon({
    className: "dp-div-icon",
    html: buildMarkerHtml(avatarUrl, pulseColor),
    iconSize: [45, 45],
    iconAnchor: [22.5, 22.5],
  });
}

function buildReportLocationIcon(Lmod: typeof import("leaflet")): DivIcon {
  return Lmod.divIcon({
    className: "dp-div-icon",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;background:#0f172a;border:3px solid #ffffff;box-shadow:0 10px 24px rgba(15,23,42,0.35);color:#ffffff;font-size:16px;line-height:1;">
        📍
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

function buildGuidePlaceIcon(Lmod: typeof import("leaflet")): DivIcon {
  return Lmod.divIcon({
    className: "dp-div-icon",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;background:#f97316;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.18);color:#ffffff;font-size:14px;line-height:1;">
        📍
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

function buildMyLocationIcon(Lmod: typeof import("leaflet")): DivIcon {
  return Lmod.divIcon({
    className: "dp-div-icon",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:#2563eb;border:3px solid #ffffff;box-shadow:0 10px 24px rgba(37,99,235,0.25);">
        <div style="width:8px;height:8px;border-radius:9999px;background:#ffffff;"></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistanceMeters(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "";
  if (value < 1000) return `${Math.round(value)}m`;
  const km = value / 1000;
  return `${km.toFixed(km >= 10 ? 0 : 1)}km`;
}

function buildCoordinateKey(position: [number, number]) {
  return `${position[0].toFixed(6)},${position[1].toFixed(6)}`;
}

function offsetOverlappingPosition(position: [number, number], index: number, total: number): [number, number] {
  if (total <= 1 || index <= 0) return position;

  const [lat, lng] = position;
  const angle = index * 2.399963229728653;
  const radiusMeters = 10 + Math.sqrt(index) * 8;
  const latOffset = (radiusMeters * Math.sin(angle)) / 111320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const safeCosLat = Math.abs(cosLat) < 0.0001 ? 0.0001 : cosLat;
  const lngOffset = (radiusMeters * Math.cos(angle)) / (111320 * safeCosLat);

  return [lat + latOffset, lng + lngOffset];
}

function getGuidePlaceFeatureBadges(place: GuidePlaceRow, facilityTags: FacilityTagOption[]): GuidePlaceFeatureBadge[] {
  const tagIds = Array.isArray(place.facility_tag_ids) ? place.facility_tag_ids : [];
  const classByLegacyKey: Record<string, string> = {
    has_grass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    has_wash_station: "bg-sky-50 text-sky-700 ring-sky-200",
    has_fencing: "bg-violet-50 text-violet-700 ring-violet-200",
    has_parking: "bg-amber-50 text-amber-700 ring-amber-200",
  };

  const badges: GuidePlaceFeatureBadge[] = [];
  for (const tag of facilityTags) {
    const legacyKey = String(tag.legacy_key || "").trim();
    const hasLegacy = legacyKey ? (place as any)[legacyKey] === true : false;
    const hit = tagIds.includes(tag.id) || hasLegacy;
    if (!hit) continue;
    const icon = String(tag.icon || "").trim() || "🏷️";
    const label = `${icon} ${tag.name}`.trim();
    const className = legacyKey && legacyKey in classByLegacyKey ? classByLegacyKey[legacyKey] : "bg-slate-50 text-slate-700 ring-slate-200";
    badges.push({ key: tag.id, label, className });
  }
  return badges;
}

function normalizeGuideTag(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\s+/g, "").replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");
}

function extractGuideItemTags(item: LifeGuideItem) {
  const tags: string[] = [];
  const push = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    tags.push(raw);
  };

  for (const name of item.subcategory_names ?? []) push(name);
  push(item.subcategory_name);
  for (const badge of item.featureBadges) push(badge.label);

  const extra = (item as any).tags as unknown;
  if (Array.isArray(extra)) {
    for (const entry of extra) push(entry);
  } else if (typeof extra === "string") {
    for (const part of extra.split(/[,，、|/]/g)) push(part);
  }

  return tags;
}

function guideItemMatchesTag(item: LifeGuideItem, query: string) {
  const qRaw = String(query ?? "").trim();
  if (!qRaw || qRaw === "all") return true;
  const q = normalizeGuideTag(qRaw);
  if (!q) return true;

  const tags = extractGuideItemTags(item);
  const normalizedTags = tags.map(normalizeGuideTag).filter(Boolean);

  for (const t of normalizedTags) {
    if (t.includes(q)) return true;
  }

  const keyword = ["清洗區", "草地", "圍欄", "泊車", "車位"].map(normalizeGuideTag).find((k) => k && q.includes(k)) ?? "";
  if (keyword) {
    for (const t of normalizedTags) {
      if (t.includes(keyword)) return true;
    }
  }

  return false;
}

type GuidePlaceListCardProps = {
  item: LifeGuideItem;
  active: boolean;
  onClick: () => void;
};

function GuidePlaceListCard({ item, active, onClick }: GuidePlaceListCardProps) {
  const compactFeatureLabels = item.featureBadges.map((badge) => ({
    ...badge,
    compact: badge.label.includes(" ") ? badge.label.split(" ").slice(1).join(" ").trim() : badge.label,
  }));
  const distanceLabel = formatDistanceMeters(item.distance_meters ?? null);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition",
        active ? "border-orange-400 ring-2 ring-orange-200" : "border-slate-200 hover:border-orange-200 hover:shadow-md",
      ].join(" ")}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black text-slate-900">{item.title}</div>
            <div className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-600">{item.address}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">{item.district}</div>
            {distanceLabel ? (
              <div className="mt-1 text-[11px] font-black text-slate-500">{distanceLabel}</div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-black text-orange-700 ring-1 ring-orange-100">
            {item.category_name}
          </span>
          {(item.subcategory_names.length > 0 ? item.subcategory_names : [item.subcategory_name]).map((name) => (
            <span
              key={`${item.id}-${name}`}
              className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-800 ring-1 ring-amber-100"
            >
              {name}
            </span>
          ))}
          {compactFeatureLabels.length > 0
            ? compactFeatureLabels.map((badge) => (
                <span
                  key={`${item.id}-${badge.key}`}
                  className={`rounded-full px-2 py-1 text-[11px] font-black ring-1 ${badge.className}`}
                >
                  {badge.compact}
                </span>
              ))
            : null}
        </div>
      </div>
    </button>
  );
}

function SosSpeciesFilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shrink-0 rounded-full border px-4 py-2.5 text-sm font-black",
        "min-h-[44px]",
        active
          ? "bg-yellow-400 text-black border-2 border-black"
          : "bg-white text-zinc-900 border-zinc-200",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function SosBreedFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shrink-0 rounded-full border px-3 py-2 text-xs font-black",
        "min-h-[38px]",
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-900 border-slate-200",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function SosPetListCard({
  c,
  active,
  onClick,
}: {
  c: SosCase;
  active: boolean;
  onClick: () => void;
}) {
  const category = getCaseIdentityCategory(c.contactIdentityType);
  const tone =
    category === "seeking"
      ? {
          dot: "bg-red-500",
          status: "急尋中",
          card: "border border-red-200/80 bg-red-50/20",
          accent: "border-l-4 border-l-red-500",
        }
      : category === "rescued"
        ? {
            dot: "bg-emerald-500",
            status: "已救起",
            card: "border border-emerald-200/80 bg-emerald-50/20",
            accent: "border-l-4 border-l-emerald-500",
          }
        : {
            dot: "bg-blue-500",
            status: "目擊中",
            card: "border border-blue-200/80 bg-blue-50/20",
            accent: "border-l-4 border-l-blue-500",
          };
  const speciesLabel = c.species === "cat" ? "🐱 貓貓" : c.species === "dog" ? "🐶 狗狗" : c.species === "bird" ? "🦜 鸚鵡/雀鳥" : "🐹 其他";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-2xl px-3 py-3 text-left shadow-sm transition",
        tone.card,
        tone.accent,
        active
          ? "ring-2 ring-slate-900/10"
          : "hover:shadow-md hover:brightness-[1.02]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-black/5">
          {c.avatarUrl ? (
            <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-base">🐾</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-slate-900">{c.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700">
                  {speciesLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700">
                  {c.district || "全港"}
                </span>
              </div>
            </div>

            <div className="shrink-0">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-black text-white">
                <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                {tone.status}
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
            <div className="truncate">⏰ {formatHongKongDateTime(c.lostTime)}</div>
            <div className="shrink-0 text-slate-400">點擊定位 ➔</div>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function Home() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const SOS_ENABLED = (() => {
    const raw = String(process.env.NEXT_PUBLIC_ENABLE_SOS ?? "")
      .trim()
      .toLowerCase();
    if (!raw) return true;
    return raw !== "0" && raw !== "false" && raw !== "off";
  })();
  const [mode, setMode] = useState<Mode>(SOS_ENABLED ? "sos" : "life");
  const [lifeGuideCategory, setLifeGuideCategory] = useState<string>("");
  const [lifeGuideSubcategory, setLifeGuideSubcategory] = useState<string>("all");
  const [sosSpeciesFilter, setSosSpeciesFilter] = useState<SosSpeciesFilter>("all");
  const [sosBreedFilter, setSosBreedFilter] = useState<string>("all");
  const [mapLegendFilters, setMapLegendFilters] = useState<MapLegendFilterState>(DEFAULT_MAP_LEGEND_FILTERS);
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [selectedPetId, setSelectedPetId] = useState<string>("");
  const [selectedGuidePlaceId, setSelectedGuidePlaceId] = useState<string>("");
  const [selectedGuidePlaceImageIndex, setSelectedGuidePlaceImageIndex] = useState(0);
  const [focusedPetId, setFocusedPetId] = useState<string>("");
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [isMdUp, setIsMdUp] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState("全部");
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [isLocatingMyLocation, setIsLocatingMyLocation] = useState(false);
  const [isQuickDownloading, setIsQuickDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [iconByCaseId, setIconByCaseId] = useState<Map<string, DivIcon>>(new Map());
  const [leafletModule, setLeafletModule] = useState<typeof import("leaflet") | null>(null);
  const [remoteCases, setRemoteCases] = useState<SosCase[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportForm, setReportForm] = useState<CitizenReportForm>(defaultCitizenReportForm);
  const [petBreedOptions, setPetBreedOptions] = useState<PetBreedOption[]>([]);
  const [guideCategories, setGuideCategories] = useState<GuideCategoryOption[]>([]);
  const [guidePlaces, setGuidePlaces] = useState<GuidePlaceRow[]>([]);
  const [facilityTags, setFacilityTags] = useState<FacilityTagOption[]>([]);
  const [isLoadingPetBreeds, setIsLoadingPetBreeds] = useState(false);
  const [isLoadingGuideCategories, setIsLoadingGuideCategories] = useState(false);
  const [isLoadingGuidePlaces, setIsLoadingGuidePlaces] = useState(false);
  const [isLoadingFacilityTags, setIsLoadingFacilityTags] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isPickLocationMode, setIsPickLocationMode] = useState(false);
  const [reportMapFocus, setReportMapFocus] = useState<MapFocusPoint | null>(null);
  const [sosMapFocus, setSosMapFocus] = useState<MapFocusPoint | null>(null);
  const [guideMapFocus, setGuideMapFocus] = useState<MapFocusPoint | null>(null);
  const [isSearchingManualAddress, setIsSearchingManualAddress] = useState(false);
  const [manualAddressSuggestions, setManualAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [manualAddressDropdownOpen, setManualAddressDropdownOpen] = useState(false);

  useEffect(() => {
    if (SOS_ENABLED) return;
    if (mode === "sos") setMode("life");
  }, [SOS_ENABLED, mode]);
  const [manualAddressActiveIndex, setManualAddressActiveIndex] = useState<number>(-1);
  const manualAddressSearchAbortRef = useRef<AbortController | null>(null);
  const manualAddressDebounceRef = useRef<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"error" | "success">("error");
  const [timelineReportOpen, setTimelineReportOpen] = useState(false);
  const [timelineReportTime, setTimelineReportTime] = useState("");
  const [timelineReportText, setTimelineReportText] = useState("");
  const [timelineReportImageUrl, setTimelineReportImageUrl] = useState("");
  const [isTimelineLightboxOpen, setIsTimelineLightboxOpen] = useState(false);
  const [timelineLightboxImageUrl, setTimelineLightboxImageUrl] = useState("");
  const [isSubmittingTimelineReport, setIsSubmittingTimelineReport] = useState(false);
  const [showScamWarningModal, setShowScamWarningModal] = useState(false);
  const [warningCountdown, setWarningCountdown] = useState(3);
  const [pendingContactHref, setPendingContactHref] = useState("");
  const [pendingContactKind, setPendingContactKind] = useState<"whatsapp" | "tel" | null>(null);
  const [followDistricts, setFollowDistricts] = useState<SubscriptionDistrict[]>([ALL_DISTRICTS_TOKEN]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState<DistrictNotification[]>([]);
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([]);
  const [liveNotification, setLiveNotification] = useState<DistrictNotification | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isStartingGoogleAuth, setIsStartingGoogleAuth] = useState(false);
  const [notificationPermissionState, setNotificationPermissionState] = useState<NotificationPermission | "unsupported">("default");
  const [notificationHelpModalOpen, setNotificationHelpModalOpen] = useState(false);
  const [showDesktopPermissionHint, setShowDesktopPermissionHint] = useState(false);
  const [savedPushDistricts, setSavedPushDistricts] = useState<SubscriptionDistrict[]>([]);
  const [guideIconByPlaceId, setGuideIconByPlaceId] = useState<Map<string, DivIcon>>(new Map());
  const [focusedGuidePlaceId, setFocusedGuidePlaceId] = useState("");
  const districtChannelRefs = useRef<RealtimeChannel[]>([]);
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null);
  const [mobileHeaderHeight, setMobileHeaderHeight] = useState(0);
  const pendingReportSyncingRef = useRef(false);
  const didAutoFocusRemoteCasesRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
  const lastPushDistrictSyncRef = useRef<string | null>(null);
  const scamWarningIntervalRef = useRef<number | null>(null);
  const sosListContainerRef = useRef<HTMLDivElement | null>(null);
  const mobileListContainerRef = useRef<HTMLDivElement | null>(null);
  const sosCardRefMap = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const guideCardRefMap = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const reportTimeParts = useMemo(() => {
    return parseIsoToLocalParts(reportForm.lostTime) ?? parseIsoToLocalParts(new Date().toISOString())!;
  }, [reportForm.lostTime]);

  const filteredPetBreedOptions = useMemo(() => {
    if (reportForm.petType !== "cat" && reportForm.petType !== "dog" && reportForm.petType !== "bird") return [];
    return petBreedOptions.filter((item) => item.pet_type === reportForm.petType);
  }, [petBreedOptions, reportForm.petType]);

  const filteredSosBreedOptions = useMemo(() => {
    if (sosSpeciesFilter !== "cat" && sosSpeciesFilter !== "dog" && sosSpeciesFilter !== "bird") return [];
    return petBreedOptions.filter((item) => item.pet_type === sosSpeciesFilter);
  }, [petBreedOptions, sosSpeciesFilter]);

  const selectedGuideCategory = useMemo(() => {
    if (!lifeGuideCategory) return null;
    return guideCategories.find((item) => item.name === lifeGuideCategory) ?? null;
  }, [guideCategories, lifeGuideCategory]);

  const allGuideSubcategories = useMemo(
    () => guideCategories.flatMap((item) => item.subcategories.map((sub) => ({ ...sub, category_name: item.name, category_icon: item.icon }))),
    [guideCategories],
  );

  const guideCategoryMap = useMemo(() => new Map(guideCategories.map((item) => [item.id, item])), [guideCategories]);
  const guideSubcategoryMap = useMemo(() => new Map(allGuideSubcategories.map((item) => [item.id, item])), [allGuideSubcategories]);

  const filteredGuideSubcategories = useMemo(() => {
    return selectedGuideCategory?.subcategories ?? [];
  }, [selectedGuideCategory]);

  const filteredGuideItems = useMemo(() => {
    if (!selectedGuideCategory) return [];
    const selected = String(selectedDistrict || "").trim() || "全部";
    return guidePlaces
      .map((item) => {
        const category = guideCategoryMap.get(item.category_id);
        const subcategoryNames = (Array.isArray(item.subcategory_ids) && item.subcategory_ids.length > 0
          ? item.subcategory_ids
          : [item.subcategory_id]
        )
          .map((id) => guideSubcategoryMap.get(id)?.name ?? null)
          .filter(Boolean) as string[];
        const lat = parseLeafletCoordinate(item.latitude);
        const lng = parseLeafletCoordinate(item.longitude);
        const position = lat != null && lng != null ? ([lat, lng] as [number, number]) : null;
        const distance_meters =
          myLocation && position ? haversineMeters([myLocation.lat, myLocation.lng], position) : null;
        return {
          ...item,
          title: item.name,
          category_name: category?.name ?? "未分類",
          category_icon: category?.icon ?? "📍",
          subcategory_name: subcategoryNames[0] ?? "未分類",
          subcategory_names: subcategoryNames,
          position,
          featureBadges: getGuidePlaceFeatureBadges(item, facilityTags),
          distance_meters,
        } satisfies LifeGuideItem;
      })
      .filter((item) => {
        if (item.category_id !== selectedGuideCategory.id) return false;
        if (lifeGuideSubcategory !== "all" && !guideItemMatchesTag(item, lifeGuideSubcategory)) return false;
        if (selected === "全部") return true;
        return item.district === selected;
      });
  }, [
    facilityTags,
    guideCategoryMap,
    guidePlaces,
    guideSubcategoryMap,
    lifeGuideSubcategory,
    myLocation,
    selectedDistrict,
    selectedGuideCategory,
  ]);

  useEffect(() => {
    setSosBreedFilter("all");
  }, [sosSpeciesFilter]);

  useEffect(() => {
    setLifeGuideSubcategory("all");
  }, [lifeGuideCategory]);

  useEffect(() => {
    if (!reportModalOpen) return;
    if (reportForm.lostTime.trim()) return;
    const iso = buildIsoFromLocalParts(reportTimeParts.date, reportTimeParts.hour, reportTimeParts.minute);
    if (!iso) return;
    setReportForm((prev) => ({ ...prev, lostTime: iso }));
  }, [reportModalOpen, reportForm.lostTime, reportTimeParts.date, reportTimeParts.hour, reportTimeParts.minute]);

  useEffect(() => {
    let cancelled = false;

    const loadPetBreeds = async () => {
      setIsLoadingPetBreeds(true);
      try {
        const res = await fetch("/api/pet-breeds", { method: "GET", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { items?: PetBreedOption[]; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "讀取品種資料失敗");
        if (!cancelled) {
          setPetBreedOptions(Array.isArray(json?.items) ? json.items : []);
        }
      } catch {
        if (!cancelled) {
          setPetBreedOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPetBreeds(false);
        }
      }
    };

    void loadPetBreeds();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadGuideCategories = async () => {
      setIsLoadingGuideCategories(true);
      try {
        const res = await fetch("/api/guide-categories", { method: "GET", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { items?: GuideCategoryOption[]; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "讀取指南分類失敗");
        if (!cancelled) {
          setGuideCategories(Array.isArray(json?.items) ? json.items : []);
        }
      } catch {
        if (!cancelled) {
          setGuideCategories([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGuideCategories(false);
        }
      }
    };

    void loadGuideCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadGuidePlaces = async () => {
      setIsLoadingGuidePlaces(true);
      try {
        const res = await fetch("/api/guide-places", { method: "GET", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { items?: GuidePlaceRow[]; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "讀取指南地點失敗");
        if (!cancelled) {
          setGuidePlaces(Array.isArray(json?.items) ? json.items : []);
        }
      } catch {
        if (!cancelled) {
          setGuidePlaces([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGuidePlaces(false);
        }
      }
    };

    void loadGuidePlaces();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadFacilityTags = async () => {
      setIsLoadingFacilityTags(true);
      try {
        const res = await fetch("/api/facility-tags", { method: "GET", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { items?: FacilityTagOption[]; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "讀取設施標籤失敗");
        if (!cancelled) {
          setFacilityTags(Array.isArray(json?.items) ? json.items : []);
        }
      } catch {
        if (!cancelled) {
          setFacilityTags([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingFacilityTags(false);
        }
      }
    };

    void loadFacilityTags();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (guideCategories.length === 0) {
      if (lifeGuideCategory) setLifeGuideCategory("");
      return;
    }
    if (guideCategories.some((item) => item.name === lifeGuideCategory)) return;
    setLifeGuideCategory(guideCategories[0].name);
  }, [guideCategories, lifeGuideCategory]);

  const mapVisualClassName = useMemo(() => {
    if (mode === "sos") return "filter-none md:filter md:brightness-75 md:contrast-110 md:saturate-75";
    return "filter-none";
  }, [mode]);

  const isLoggedIn = Boolean(session?.user?.id);
  const unreadDistrictCount = useMemo(
    () => notifications.reduce((acc, n) => acc + (n.unread ? 1 : 0), 0),
    [notifications],
  );
  const unreadAppCount = useMemo(
    () => appNotifications.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0),
    [appNotifications],
  );
  const unreadCount = unreadDistrictCount + unreadAppCount;
  const currentUserLabel = useMemo(() => {
    const email = currentUser?.email?.trim();
    if (email) return email.split("@")[0] || email;
    const fullName =
      typeof currentUser?.user_metadata?.full_name === "string"
        ? currentUser.user_metadata.full_name.trim()
        : "";
    if (fullName) return fullName;
    return "會員";
  }, [currentUser]);
  const currentUserAvatar =
    typeof currentUser?.user_metadata?.avatar_url === "string"
      ? currentUser.user_metadata.avatar_url
      : typeof currentUser?.user_metadata?.picture === "string"
        ? currentUser.user_metadata.picture
        : "";
  const followDistrictSummary = useMemo(
    () => getSubscriptionDistrictSummary(followDistricts),
    [followDistricts],
  );
  const navbarNotificationControlLabel = useMemo(() => {
    if (followDistricts.includes(ALL_DISTRICTS_TOKEN)) return "接收通知：全港守護中";
    const labels = getSubscriptionDistrictLabels(followDistricts);
    if (labels.length === 0) return "接收搜救通知：未選地區";
    if (labels.length <= 2) return `接收通知：${labels.join("、")}`;
    return `接收通知：${labels.slice(0, 2).join("、")}等`;
  }, [followDistricts]);
  const districtNotificationCtaLabel = `🔔 開啟【${followDistrictSummary}】即時搜救通知`;
  const notificationBadge = useMemo(() => {
    if (notificationPermissionState === "denied") {
      return {
        tone: "bg-red-50 text-red-700 ring-red-200",
        label: "🔴 已封鎖通知權限",
        hint: "請點擊下方教學，3 秒重新開啟通知。",
      };
    }
    if (notificationPermissionState === "granted" && savedPushDistricts.length > 0) {
      const isSynced =
        JSON.stringify(savedPushDistricts) === JSON.stringify(followDistricts);
      const savedSummary = getSubscriptionDistrictSummary(savedPushDistricts);
      return {
        tone: isSynced
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-amber-50 text-amber-700 ring-amber-200",
        label: isSynced
          ? `🟢 已啟用：【${followDistrictSummary}】推播`
          : `🟢 已啟用：【${savedSummary}】推播`,
        hint: isSynced
          ? "目前關注區域已同步到最新設定。"
          : `你已切換關注區域，請點擊下方按鈕更新至【${followDistrictSummary}】。`,
      };
    }
    return {
      tone: "bg-slate-100 text-slate-600 ring-slate-200",
      label: "⚪ 尚未開啟接收",
      hint: "允許通知後，即可接收你關注分區的緊急推播。",
    };
  }, [followDistrictSummary, followDistricts, notificationPermissionState, savedPushDistricts]);
  const isDesktopViewport = useMemo(() => {
    if (!isMounted) return false;
    return window.innerWidth >= 1024;
  }, [isMounted]);
  const selectableDistricts = useMemo(() => getDistrictCheckboxOptions(), []);
  const mapLegendItems = useMemo<
    Array<{
      key: CaseIdentityCategory;
      label: string;
      emoji: string;
      colorClass: string;
      activeTone: string;
    }>
  >(
    () => [
      {
        key: "seeking",
        label: "主人尋寵",
        emoji: "🔴",
        colorClass: "bg-red-500",
        activeTone: "border-red-200 bg-red-50 text-red-700",
      },
      {
        key: "sighting",
        label: "路上目擊",
        emoji: "🔵",
        colorClass: "bg-blue-500",
        activeTone: "border-blue-200 bg-blue-50 text-blue-700",
      },
      {
        key: "rescued",
        label: "已救起搵主人",
        emoji: "🟢",
        colorClass: "bg-emerald-500",
        activeTone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      },
    ],
    [],
  );

  const formatNowHHMM = () => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `${yyyy}年${month}月${day}日 ${hh}:${mm}`;
  };

  const formatTimelineTimeForDisplay = (raw: string) => {
    const value = String(raw || "").trim();
    if (!value) return "";
    const isoMatch = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
    if (isoMatch) {
      const d = new Date(value);
      if (Number.isFinite(d.getTime())) {
        const yyyy = String(d.getFullYear());
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${yyyy}年${month}月${day}日 ${hh}:${mm}`;
      }
    }
    const ymdHm = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (ymdHm) {
      return `${ymdHm[1]}年${ymdHm[2]}月${ymdHm[3]}日 ${ymdHm[4]}:${ymdHm[5]}`;
    }
    const mdHm = value.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (mdHm) {
      const now = new Date();
      const yyyy = String(now.getFullYear());
      return `${yyyy}年${mdHm[1]}月${mdHm[2]}日 ${mdHm[3]}:${mdHm[4]}`;
    }
    const ymdHmZh = value.match(/^(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})$/);
    if (ymdHmZh) {
      return `${ymdHmZh[1]}年${ymdHmZh[2]}月${ymdHmZh[3]}日 ${ymdHmZh[4]}:${ymdHmZh[5]}`;
    }
    return value;
  };

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  const resetReportForm = useCallback(() => {
    setReportForm(defaultCitizenReportForm());
    setReportMapFocus(null);
  }, []);

  const showToast = useCallback((message: string, tone: "error" | "success" = "error") => {
    setToastMessage(message);
    setToastTone(tone);
    window.clearTimeout((showToast as typeof showToast & { timer?: number }).timer);
    (showToast as typeof showToast & { timer?: number }).timer = window.setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  const fetchAppNotifications = useCallback(async () => {
    if (!isLoggedIn) {
      setAppNotifications([]);
      return;
    }
    try {
      const res = await fetch("/api/notifications", { method: "GET", cache: "no-store" });
      const data = (await res.json()) as { notifications?: AppNotification[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "讀取站內通知失敗");
      }
      setAppNotifications(Array.isArray(data.notifications) ? data.notifications : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "讀取站內通知失敗";
      console.error(message);
    }
  }, [isLoggedIn]);

  const markAppNotificationsRead = useCallback(
    async (notificationId?: string) => {
      if (!isLoggedIn) return;
      try {
        const body = notificationId ? { notificationId } : { markAll: true };
        const res = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) {
          throw new Error(data.error || "標記通知已讀失敗");
        }
        setAppNotifications((prev) =>
          prev.map((item) =>
            !notificationId || item.id === notificationId ? { ...item, isRead: true } : item,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "標記通知已讀失敗";
        showToast(message);
      }
    },
    [isLoggedIn],
  );

  const closeReportModal = useCallback(() => {
    setReportModalOpen(false);
    setIsPickLocationMode(false);
  }, []);

  const openTimelineLightbox = useCallback((imageUrl: string | null | undefined) => {
    const nextUrl = String(imageUrl || "").trim();
    if (!nextUrl) return;
    setTimelineLightboxImageUrl(nextUrl);
    setIsTimelineLightboxOpen(true);
  }, []);

  const closeTimelineLightbox = useCallback(() => {
    setIsTimelineLightboxOpen(false);
    setTimelineLightboxImageUrl("");
  }, []);

  const openScamWarningModal = useCallback((href: string, kind: "whatsapp" | "tel") => {
    const nextHref = href.trim();
    if (!nextHref) return;
    setPendingContactHref(nextHref);
    setPendingContactKind(kind);
    setWarningCountdown(3);
    setShowScamWarningModal(true);
  }, []);

  const closeScamWarningModal = useCallback(() => {
    setShowScamWarningModal(false);
    setWarningCountdown(3);
    setPendingContactHref("");
    setPendingContactKind(null);
    if (scamWarningIntervalRef.current) {
      window.clearInterval(scamWarningIntervalRef.current);
      scamWarningIntervalRef.current = null;
    }
  }, []);

  const confirmScamWarningContact = useCallback(() => {
    if (!pendingContactHref || warningCountdown > 0) return;

    const href = pendingContactHref;
    const kind = pendingContactKind;
    closeScamWarningModal();

    if (kind === "whatsapp") {
      const openedWindow = window.open(href, "_blank");
      if (!openedWindow) {
        window.location.href = href;
      }
      return;
    }

    window.location.href = href;
  }, [closeScamWarningModal, pendingContactHref, pendingContactKind, warningCountdown]);

  useEffect(() => {
    if (!showScamWarningModal) {
      if (scamWarningIntervalRef.current) {
        window.clearInterval(scamWarningIntervalRef.current);
        scamWarningIntervalRef.current = null;
      }
      return;
    }

    setWarningCountdown(3);
    scamWarningIntervalRef.current = window.setInterval(() => {
      setWarningCountdown((prev) => {
        if (prev <= 1) {
          if (scamWarningIntervalRef.current) {
            window.clearInterval(scamWarningIntervalRef.current);
            scamWarningIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (scamWarningIntervalRef.current) {
        window.clearInterval(scamWarningIntervalRef.current);
        scamWarningIntervalRef.current = null;
      }
    };
  }, [showScamWarningModal]);

  useEffect(() => {
    const storedDistricts = window.localStorage.getItem(FOLLOW_DISTRICTS_STORAGE_KEY);
    if (storedDistricts) {
      try {
        const parsed = JSON.parse(storedDistricts);
        const normalized = normalizeSubscriptionDistricts(parsed);
        if (normalized.length > 0) setFollowDistricts(normalized);
      } catch {}
    }
    const storedSubscribedDistricts = window.localStorage.getItem(PUSH_SUBSCRIBED_DISTRICTS_STORAGE_KEY);
    if (storedSubscribedDistricts) {
      try {
        const parsed = JSON.parse(storedSubscribedDistricts);
        setSavedPushDistricts(normalizeSubscriptionDistricts(parsed));
      } catch {}
    }
    const storedNotifs = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (storedNotifs) {
      try {
        const parsed = JSON.parse(storedNotifs) as DistrictNotification[];
        if (Array.isArray(parsed)) {
          setNotifications(
            parsed
              .filter((n) => n && typeof n === "object" && typeof (n as any).id === "string")
              .slice(0, 30),
          );
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FOLLOW_DISTRICTS_STORAGE_KEY, JSON.stringify(followDistricts));
  }, [followDistricts]);

  useEffect(() => {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications.slice(0, 30)));
  }, [notifications]);

  useEffect(() => {
    if (savedPushDistricts.length > 0) {
      window.localStorage.setItem(
        PUSH_SUBSCRIBED_DISTRICTS_STORAGE_KEY,
        JSON.stringify(savedPushDistricts),
      );
      return;
    }
    window.localStorage.removeItem(PUSH_SUBSCRIBED_DISTRICTS_STORAGE_KEY);
  }, [savedPushDistricts]);

  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
  }, [currentUser?.id]);

  useEffect(() => {
    if (!isLoggedIn) {
      setAppNotifications([]);
      return;
    }
    void fetchAppNotifications();
    const timer = window.setInterval(() => {
      void fetchAppNotifications();
    }, 30000);
    return () => {
      window.clearInterval(timer);
    };
  }, [fetchAppNotifications, isLoggedIn]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsMdUp(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted || isMdUp) {
      setMobileHeaderHeight(0);
      return;
    }
    const el = mobileHeaderRef.current;
    if (!el) return;
    const update = () => setMobileHeaderHeight(el.getBoundingClientRect().height);
    update();
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    observer?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [isMounted, isMdUp, mode, notificationPermissionState, sosSpeciesFilter, sosBreedFilter, lifeGuideCategory]);

  useEffect(() => {
    const target = String(selectedDistrict || "").trim() || "全部";
    const found = HONG_KONG_DISTRICTS[target] ?? null;
    if (!found) return;
    setReportMapFocus(null);
    if (mode === "sos") {
      setSosMapFocus({ center: found.center, zoom: found.zoom });
      setFocusedPetId("");
      setSelectedPetId("");
    } else {
      setGuideMapFocus({ center: found.center, zoom: found.zoom });
      setFocusedGuidePlaceId("");
    }
    if (!isMdUp) {
      setIsMobileExpanded(false);
    }
  }, [isMdUp, mode, selectedDistrict]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermissionState("unsupported");
      return;
    }
    setNotificationPermissionState(Notification.permission);
  }, [isMounted]);

  useEffect(() => {
    if (!notificationHelpModalOpen || !isDesktopViewport) {
      setShowDesktopPermissionHint(false);
      return;
    }
    setShowDesktopPermissionHint(true);
  }, [notificationHelpModalOpen, isDesktopViewport]);

  useEffect(() => {
    if (!isMounted) return;
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return;

    if (notificationPermissionState !== "granted") {
      setSavedPushDistricts((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    let active = true;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (!active) return;
        if (!subscription) {
          setSavedPushDistricts((prev) => (prev.length === 0 ? prev : []));
          return;
        }
        const storedDistricts = window.localStorage.getItem(PUSH_SUBSCRIBED_DISTRICTS_STORAGE_KEY);
        if (storedDistricts) {
          const normalized = normalizeSubscriptionDistricts(JSON.parse(storedDistricts));
          setSavedPushDistricts((prev) =>
            JSON.stringify(prev) === JSON.stringify(normalized) ? prev : normalized,
          );
          return;
        }
        setSavedPushDistricts((prev) => prev);
      } catch {
        if (!active) return;
        setSavedPushDistricts((prev) => prev);
      }
    })();

    return () => {
      active = false;
    };
  }, [isMounted, notificationPermissionState]);

  useEffect(() => {
    if (isLoggedIn) {
      setAuthModalOpen(false);
    }
  }, [isLoggedIn]);

  const requestBrowserNotificationPermission = async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    try {
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        setNotificationPermissionState(result);
        return result;
      }
      setNotificationPermissionState(Notification.permission);
      return Notification.permission;
    } catch {
      setNotificationPermissionState(Notification.permission);
      return Notification.permission;
    }
  };

  const showLiveNotificationCard = (n: DistrictNotification) => {
    setLiveNotification(n);
    window.clearTimeout((showLiveNotificationCard as typeof showLiveNotificationCard & { timer?: number }).timer);
    (showLiveNotificationCard as typeof showLiveNotificationCard & { timer?: number }).timer =
      window.setTimeout(() => {
        setLiveNotification(null);
      }, 5200);
  };

  const pushBrowserNotification = async (n: DistrictNotification) => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const notif = new Notification(n.title, {
      body: n.message,
      icon: n.imageUrl || undefined,
    });
    notif.onclick = () => {
      window.focus();
    };
  };

  const registerPushServiceWorker = async () => {
    if (typeof window === "undefined") return null;
    if (!("serviceWorker" in navigator)) return null;
    if (!("PushManager" in window)) return null;
    if (!window.isSecureContext) return null;
    try {
      const existing = await navigator.serviceWorker.getRegistration("/");
      if (existing) return existing;
      return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch {
      return null;
    }
  };

  const isPushSupportedInBrowser = () => {
    if (typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator)) return false;
    if (!("PushManager" in window)) return false;
    if (!("Notification" in window)) return false;
    if (!window.isSecureContext) return false;
    if (typeof ServiceWorkerRegistration === "undefined") return false;
    if (!("showNotification" in ServiceWorkerRegistration.prototype)) return false;
    return true;
  };

  const getBrowserPushSubscription = async (
    preferredRegistration?: ServiceWorkerRegistration | null,
  ): Promise<PushSubscriptionJson | null> => {
    if (!isPushSupportedInBrowser()) {
      throw new Error("Push service not available in this browser context.");
    }
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    if (!vapidPublicKey) {
      console.error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY. Web Push subscription aborted.");
      return null;
    }
    const initialRegistration = preferredRegistration ?? (await registerPushServiceWorker());
    if (!initialRegistration) return null;
    const registration =
      preferredRegistration ?? ("serviceWorker" in navigator ? await navigator.serviceWorker.ready : null);
    if (!registration) return null;

    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    return sub.toJSON() as PushSubscriptionJson;
  };

  const syncOfflinePushSubscription = useCallback(async ({
    districts,
    showSuccessToast,
  }: {
    districts: SubscriptionDistrict[];
    showSuccessToast: boolean;
  }) => {
    if (typeof window === "undefined") return;
    if (!isPushSupportedInBrowser()) {
      if (showSuccessToast) {
        showToast("此瀏覽器或目前環境不支援離線推播通知，你仍可接收站內即時通知。");
      }
      return;
    }
    if (Notification.permission !== "granted") {
      if (showSuccessToast) showToast("你尚未允許通知權限，無法啟用離線推播。");
      return;
    }
    if (districts.length === 0) {
      if (showSuccessToast) showToast("請先選擇至少一個關注區域。");
      return;
    }
    let subscriptionJson: PushSubscriptionJson | null = null;
    try {
      subscriptionJson = await getBrowserPushSubscription();
    } catch (error) {
      console.error("Push subscription failed when converting or subscribing with VAPID key.", error);
      if (showSuccessToast) showToast(getPushSubscriptionErrorMessage(error));
      return;
    }
    const endpoint = String(subscriptionJson?.endpoint || "").trim();
    if (!endpoint) {
      if (showSuccessToast) showToast("Push Subscription 無效，請重新整理後再試。");
      return;
    }
    try {
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ districts, subscription: subscriptionJson }),
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => ({}))) as { districts?: string[] };
      const normalized = normalizeSubscriptionDistricts(json?.districts ?? districts);
      lastPushDistrictSyncRef.current = JSON.stringify(normalized);
      setSavedPushDistricts(normalized);
      if (showSuccessToast) {
        showToast(
          isLoggedIn
            ? "✅ 已啟用離線推播，並已綁定到你的會員帳號"
            : "✅ 已啟用離線推播，暫以訪客裝置身份接收通知",
          "success",
        );
      }
    } catch {}
  }, [isLoggedIn, notificationPermissionState, showToast, supabase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (followDistricts.length === 0) return;
    const nextKey = JSON.stringify(followDistricts);
    if (lastPushDistrictSyncRef.current === nextKey) return;
    void syncOfflinePushSubscription({ districts: followDistricts, showSuccessToast: false });
  }, [followDistricts, isLoggedIn, savedPushDistricts, syncOfflinePushSubscription]);

  const startGoogleAuth = async () => {
    if (isStartingGoogleAuth) return;
    setIsStartingGoogleAuth(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "Google 登入啟動失敗";
      showToast(msg);
      setIsStartingGoogleAuth(false);
      return;
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setAccountMenuOpen(false);
    showToast("已安全登出帳號。", "success");
  };

  const openNotificationHelpModal = () => {
    setNotificationHelpModalOpen(true);
  };

  const toggleFollowDistrict = (district: SubscriptionDistrict) => {
    setFollowDistricts((prev) => {
      if (district === ALL_DISTRICTS_TOKEN) {
        return prev.includes(ALL_DISTRICTS_TOKEN) ? [] : [ALL_DISTRICTS_TOKEN];
      }
      const base = prev.filter((item) => item !== ALL_DISTRICTS_TOKEN);
      const hasDistrict = base.includes(district);
      if (hasDistrict) {
        return base.filter((item) => item !== district);
      }
      return [...base, district];
    });
  };

  const handleEnableDistrictNotifications = async () => {
    if (!isPushSupportedInBrowser()) {
      setNotificationPermissionState("unsupported");
      showToast("此瀏覽器或目前環境未提供離線推播服務，你仍可接收站內即時通知。");
      return;
    }
    const registration = await registerPushServiceWorker();
    if (!registration) {
      showToast("Service Worker 註冊失敗，請確認使用 https 或 localhost。");
      return;
    }
    await navigator.serviceWorker.ready;
    const permission = await requestBrowserNotificationPermission();
    if (permission === "granted") {
      setNotificationHelpModalOpen(false);
      await syncOfflinePushSubscription({ districts: followDistricts, showSuccessToast: true });
      return;
    }
    if (permission === "denied") {
      setNotificationPermissionState("denied");
      openNotificationHelpModal();
      return;
    }
    showToast("尚未取得通知權限，請再按一次允許通知。");
  };

  const focusOnPet = async (petId: string, lat?: number, lng?: number) => {
    if (!SOS_ENABLED) {
      showToast("🚧 SOS尋寵地圖暫時維護中");
      return;
    }
    setMode("sos");
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setSosMapFocus({ center: [lat as number, lng as number], zoom: 16 });
    }
    await fetchApprovedPets();
    setSelectedPetId(petId);
    setFocusedPetId(petId);
    setIsMobileExpanded(false);
    setIsListCollapsed(false);
    setNotificationPanelOpen(false);
    setNotifications((prev) => prev.map((n) => (n.petId === petId ? { ...n, unread: false } : n)));
  };

  useEffect(() => {
    const petId = new URLSearchParams(window.location.search).get("petId");
    if (!petId) return;
    if (!isUuid(petId)) return;
    void focusOnPet(petId);
  }, []);

  const handleIncomingNotification = async (n: DistrictNotification) => {
    setNotifications((prev) => [n, ...prev].slice(0, 30));
    showLiveNotificationCard(n);
    await pushBrowserNotification(n);
  };

  const ensureChannelSubscribed = async (channelName: string) => {
    const ch = supabase.channel(channelName);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Realtime subscribe timeout")), 2200);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(timer);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          window.clearTimeout(timer);
          reject(new Error(`Realtime subscribe failed: ${status}`));
        }
      });
    });
    return ch;
  };

  const broadcastDistrictEvent = async (
    district: string | null | undefined,
    event: DistrictNotificationKind,
    payload: Record<string, unknown>,
  ) => {
    const resolved = (district || "").trim() || "全港";
    const targets = new Set<string>(["district:all"]);
    if (resolved !== "全港") targets.add(`district:${resolved}`);
    const channels: Awaited<ReturnType<typeof ensureChannelSubscribed>>[] = [];
    try {
      for (const name of targets) {
        const ch = await ensureChannelSubscribed(name);
        channels.push(ch);
        await ch.send({ type: "broadcast", event, payload });
      }
    } finally {
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    }
  };

  useEffect(() => {
    for (const existing of districtChannelRefs.current) {
      void supabase.removeChannel(existing);
    }
    districtChannelRefs.current = [];

    const channelNames = getRealtimeChannelNames(followDistricts);
    if (channelNames.length === 0) return;

    const createdChannels = channelNames.map((channelName) =>
      supabase
        .channel(channelName)
        .on("broadcast", { event: "NEW_CASE" }, ({ payload }) => {
          const p = payload as any;
          const petId = String(p?.petId || "");
          if (!petId) return;
          if (typeof p?.actorId === "string" && p.actorId && p.actorId === currentUserIdRef.current) return;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          void handleIncomingNotification({
            id,
            kind: "NEW_CASE",
            district: String(p?.district || "全港"),
            title: "叮！你附近有毛孩需要救援！",
            message: `剛剛：${String(p?.district || "全港")} 有「${String(p?.petName || "毛孩")}」需要協助`,
            petId,
            imageUrl: typeof p?.imageUrl === "string" ? p.imageUrl : undefined,
            latitude: typeof p?.latitude === "number" ? p.latitude : undefined,
            longitude: typeof p?.longitude === "number" ? p.longitude : undefined,
            createdAt: Date.now(),
            unread: true,
          });
        })
        .on("broadcast", { event: "NEW_SIGHTING" }, ({ payload }) => {
          const p = payload as any;
          const petId = String(p?.petId || "");
          if (!petId) return;
          if (typeof p?.actorId === "string" && p.actorId && p.actorId === currentUserIdRef.current) return;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          void handleIncomingNotification({
            id,
            kind: "NEW_SIGHTING",
            district: String(p?.district || "全港"),
            title: "有最新目擊回報！",
            message: `${String(p?.time || "剛剛")}：${String(p?.text || "收到新情報")}`,
            petId,
            imageUrl: typeof p?.imageUrl === "string" ? p.imageUrl : undefined,
            latitude: typeof p?.latitude === "number" ? p.latitude : undefined,
            longitude: typeof p?.longitude === "number" ? p.longitude : undefined,
            createdAt: Date.now(),
            unread: true,
          });
        })
        .subscribe(),
    );
    districtChannelRefs.current = createdChannels;

    return () => {
      for (const channel of createdChannels) {
        void supabase.removeChannel(channel);
      }
      districtChannelRefs.current = districtChannelRefs.current.filter(
        (channel) => !createdChannels.includes(channel),
      );
    };
  }, [followDistricts, supabase]);

  useEffect(() => {
    setTimelineReportOpen(false);
    setTimelineReportText("");
    setTimelineReportTime("");
    setTimelineReportImageUrl("");
    setIsTimelineLightboxOpen(false);
    setTimelineLightboxImageUrl("");
    setShowScamWarningModal(false);
    setWarningCountdown(3);
    setPendingContactHref("");
    setPendingContactKind(null);
    if (scamWarningIntervalRef.current) {
      window.clearInterval(scamWarningIntervalRef.current);
      scamWarningIntervalRef.current = null;
    }
  }, [selectedPetId]);

  const fetchApprovedPets = async () => {
    const { data, error } = await supabase
      .from("pets")
      .select("*")
      .eq("status", "approved")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: false });
    if (error) return;
    const items = (data ?? []) as PetRow[];
    const mapped = items.map(toSosCaseFromRow).filter(Boolean) as SosCase[];
    setRemoteCases(mapped);
  };

  const submitCitizenReport = useCallback(async (payload: CitizenReportForm, user: User) => {
    if (!user?.id) {
      throw new Error("未登入用戶不可直接提交，請先完成 Google 登入。");
    }
    const hasCoordinates =
      Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude);
    const manualAddress = payload.manualAddress.trim();
    if (!hasCoordinates && !manualAddress) {
      throw new Error("請提供有效座標，或填寫手動地址作後備。");
    }
    const finalImageUrl =
      payload.imageUrl.startsWith("data:image/")
        ? await uploadPetImage(supabase, payload.imageUrl, { folder: "citizen" })
        : payload.imageUrl || "";
    const identity = normalizeContactIdentity(payload.sourceType, payload.caseType);
    const alignedCaseType = getDefaultCaseTypeForIdentity(identity);
    const sourceLinkTrimmed = payload.sourceLink.trim();
    const sourceUrl =
      needsSourceLink(identity) && sourceLinkTrimmed
        ? sourceLinkTrimmed
        : `daydaypet://citizen-report/${Date.now()}`;
    const insertPayload = {
      user_id: user.id,
      pet_name: payload.petName || "（未命名）",
      pet_type: payload.petType,
      breed: payload.breed || null,
      location: payload.location || manualAddress || "",
      manual_address: manualAddress || null,
      lost_time: payload.lostTime || "",
      features: payload.features || "",
      phone: payload.phone || "",
      enable_privacy: payload.enablePrivacy,
      image_url: finalImageUrl,
      source_url: sourceUrl,
      source_type: identity,
      source_link: needsSourceLink(identity) ? sourceLinkTrimmed || null : null,
      case_type: alignedCaseType,
      status: "pending" as const,
      latitude: hasCoordinates ? payload.latitude : null,
      longitude: hasCoordinates ? payload.longitude : null,
    };
    const res = await fetch("/api/pets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(insertPayload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || "提交報料失敗");
    }
  }, [supabase]);

  const getFreshSignedInUser = useCallback(
    async ({ allowAuthCodeRetry = false }: { allowAuthCodeRetry?: boolean } = {}) => {
      const hasOAuthCode =
        typeof window !== "undefined" && new URLSearchParams(window.location.search).has("code");
      const retryDelays = allowAuthCodeRetry && hasOAuthCode ? AUTH_REFRESH_RETRY_DELAYS_MS : [0];
      let lastError: Error | null = null;

      for (const delayMs of retryDelays) {
        if (delayMs > 0) {
          await waitForMs(delayMs);
        }

        const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] =
          await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);

        if (userError) {
          lastError = userError;
        }
        if (sessionError) {
          lastError = sessionError;
        }

        const verifiedUser = userData.user ?? null;
        setSession(sessionData.session ?? null);
        setCurrentUser(verifiedUser);

        if (verifiedUser) {
          return verifiedUser;
        }
      }

      if (lastError) {
        throw lastError;
      }

      return null;
    },
    [supabase],
  );

  const consumePendingReportAfterLogin = useCallback(async (user: User) => {
    if (pendingReportSyncingRef.current) return;
    const stored = window.localStorage.getItem(PENDING_REPORT_STORAGE_KEY);
    if (!stored) return;

    pendingReportSyncingRef.current = true;
    window.localStorage.removeItem(PENDING_REPORT_STORAGE_KEY);
    try {
      const parsed = {
        ...defaultCitizenReportForm(),
        ...(JSON.parse(stored) as Partial<CitizenReportForm>),
      } as CitizenReportForm;
      await submitCitizenReport(parsed, user);
      resetReportForm();
      closeReportModal();
      alert(
        "🎉 成功加入會員！您的報料已同步綁定至您的帳戶，並已送往後台審批，管理員核實後會立刻上線！",
      );
    } catch (err) {
      window.localStorage.setItem(PENDING_REPORT_STORAGE_KEY, stored);
      const msg = err instanceof Error && err.message ? err.message : "同步提交失敗";
      alert(msg);
    } finally {
      pendingReportSyncingRef.current = false;
    }
  }, [closeReportModal, resetReportForm, submitCitizenReport]);

  useEffect(() => {
    let cancelled = false;

    const fetchPets = async () => {
      try {
        const { data, error } = await supabase
          .from("pets")
          .select("*")
          .eq("status", "approved")
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("created_at", { ascending: false });
        if (error) return;
        const items = (data ?? []) as PetRow[];
        const mapped = items.map(toSosCaseFromRow).filter(Boolean) as SosCase[];
        if (cancelled) return;
        setRemoteCases(mapped);
      } catch {}
    };

    void fetchPets();
    const t = window.setInterval(fetchPets, 15000);
    const channel = supabase
      .channel("pets-approved-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pets" },
        () => {
          void fetchPets();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      window.clearInterval(t);
       void supabase.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    if (mode !== "sos") return;
    if (!remoteCases || remoteCases.length === 0) return;
    if (didAutoFocusRemoteCasesRef.current) return;
    didAutoFocusRemoteCasesRef.current = true;
    setSosMapFocus({ center: remoteCases[0].position, zoom: 15 });
    showToast("📍 已載入最新案件，地圖已自動跳到該位置。", "success");
  }, [mode, remoteCases]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const user = await getFreshSignedInUser({ allowAuthCodeRetry: true });
        if (!active || !user) return;
        void consumePendingReportAfterLogin(user);
        void syncOfflinePushSubscription({ districts: followDistricts, showSuccessToast: false });
      } catch {}
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      if (!nextSession) {
        setCurrentUser(null);
        return;
      }

      void (async () => {
        try {
          const verifiedUser = await getFreshSignedInUser({ allowAuthCodeRetry: true });
          if (!verifiedUser) return;
          void consumePendingReportAfterLogin(verifiedUser);
          void syncOfflinePushSubscription({ districts: followDistricts, showSuccessToast: false });
        } catch {}
      })();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [consumePendingReportAfterLogin, followDistricts, getFreshSignedInUser, supabase, syncOfflinePushSubscription]);

  const sosCases = useMemo(() => {
    if (remoteCases !== null) return remoteCases;
    return MOCK_SOS_CASES;
  }, [remoteCases]);

  const selectedPet = useMemo(() => {
    return sosCases.find((c) => c.id === selectedPetId) ?? null;
  }, [sosCases, selectedPetId]);

  const selectedGuidePlace = useMemo(() => {
    if (!selectedGuidePlaceId) return null;
    return filteredGuideItems.find((item) => item.id === selectedGuidePlaceId) ?? null;
  }, [filteredGuideItems, selectedGuidePlaceId]);

  useEffect(() => {
    setSelectedGuidePlaceImageIndex(0);
  }, [selectedGuidePlaceId]);

  const visibleSosCases = useMemo(() => {
    if (mode !== "sos") return [];
    return sosCases.filter((c) => {
      const matchesSpecies = sosSpeciesFilter === "all" || c.species === sosSpeciesFilter;
      const matchesBreed =
        sosBreedFilter === "all" ||
        (typeof c.breed === "string" && c.breed.trim() && c.breed.trim() === sosBreedFilter);
      const category = getCaseIdentityCategory(c.contactIdentityType);
      const matchesLegend = mapLegendFilters[category];
      return matchesSpecies && matchesBreed && matchesLegend;
    });
  }, [mapLegendFilters, mode, sosBreedFilter, sosCases, sosSpeciesFilter]);

  const filteredSosCases = useMemo(() => {
    const target = String(selectedDistrict || "").trim();
    if (!target || target === "全部") return visibleSosCases;
    return visibleSosCases.filter((pet) => {
      const district = String((pet as any).district || "").trim();
      const area = typeof (pet as any).area === "string" ? (pet as any).area.trim() : "";
      return district === target || area === target;
    });
  }, [selectedDistrict, visibleSosCases]);

  useEffect(() => {
    if (mode !== "sos") setSelectedPetId("");
  }, [mode]);

  useEffect(() => {
    if (mode !== "life") setFocusedGuidePlaceId("");
  }, [mode]);

  useEffect(() => {
    if (mode !== "life") setSelectedGuidePlaceId("");
  }, [mode]);

  useEffect(() => {
    if (!selectedPetId) return;
    const exists = visibleSosCases.some((c) => c.id === selectedPetId);
    if (!exists) setSelectedPetId("");
  }, [selectedPetId, visibleSosCases]);

  useEffect(() => {
    if (!focusedPetId) return;
    const exists = filteredSosCases.some((c) => c.id === focusedPetId);
    if (!exists) setFocusedPetId("");
  }, [filteredSosCases, focusedPetId]);

  useEffect(() => {
    if (!focusedGuidePlaceId) return;
    const exists = filteredGuideItems.some((item) => item.id === focusedGuidePlaceId);
    if (!exists) setFocusedGuidePlaceId("");
  }, [filteredGuideItems, focusedGuidePlaceId]);

  useEffect(() => {
    import("leaflet").then((m) => setLeafletModule(m));
  }, []);

  useEffect(() => {
    if (mode !== "sos") {
      setIconByCaseId(new Map());
      return;
    }
    if (!leafletModule) return;
    const next = new Map<string, DivIcon>();
    for (const c of sosCases) {
      next.set(c.id, buildDivIcon(leafletModule, c.avatarUrl, c.pulseColor));
    }
    setIconByCaseId(next);
  }, [mode, leafletModule, sosCases]);

  useEffect(() => {
    if (mode !== "life") {
      setGuideIconByPlaceId(new Map());
      return;
    }
    if (!leafletModule) return;
    const next = new Map<string, DivIcon>();
    for (const place of filteredGuideItems) {
      next.set(place.id, buildGuidePlaceIcon(leafletModule));
    }
    setGuideIconByPlaceId(next);
  }, [filteredGuideItems, leafletModule, mode]);

  const reportLocationIcon = useMemo(() => {
    if (!leafletModule) return undefined;
    return buildReportLocationIcon(leafletModule);
  }, [leafletModule]);

  const myLocationIcon = useMemo(() => {
    if (!leafletModule) return undefined;
    return buildMyLocationIcon(leafletModule);
  }, [leafletModule]);

  const mainMapCases = useMemo<SosMapCanvasProps["cases"]>(() => {
    if (mode !== "sos") return [];
    return filteredSosCases.map((c) => ({
      id: c.id,
      position: c.position,
      enablePrivacy: c.enablePrivacy !== false,
      pulseColor: c.pulseColor,
    }));
  }, [filteredSosCases, mode]);

  const mainMapGuidePlaces = useMemo<SosMapCanvasProps["guidePlaces"]>(
    () => {
      if (mode !== "life") return [];
      const groupedPositionCount = new Map<string, number>();
      const groupedPositionIndex = new Map<string, number>();

      for (const item of filteredGuideItems) {
        if (!item.position) continue;
        const key = buildCoordinateKey(item.position);
        groupedPositionCount.set(key, (groupedPositionCount.get(key) ?? 0) + 1);
      }

      return filteredGuideItems
        .filter((item) => item.position !== null)
        .map((item) => {
          const originalPosition = item.position!;
          const key = buildCoordinateKey(originalPosition);
          const duplicateCount = groupedPositionCount.get(key) ?? 1;
          const duplicateIndex = groupedPositionIndex.get(key) ?? 0;
          groupedPositionIndex.set(key, duplicateIndex + 1);

          return {
            id: item.id,
            position: offsetOverlappingPosition(originalPosition, duplicateIndex, duplicateCount),
            title: item.title,
            address: item.address,
            district: item.district,
            openingHours: item.opening_hours,
            imageUrl: Array.isArray(item.image_urls) && item.image_urls.length > 0 ? item.image_urls[0] : item.image_url,
            categoryLabel: `${item.category_icon} ${item.category_name}`,
            subcategoryLabel: item.subcategory_name,
            featureBadges: item.featureBadges.map((badge) => badge.label),
          };
        });
    },
    [filteredGuideItems, mode],
  );

  const mainMapFocusCenter = reportMapFocus?.center ?? (mode === "sos" ? sosMapFocus?.center ?? null : guideMapFocus?.center ?? null);
  const mainMapFocusZoom = reportMapFocus?.zoom ?? (mode === "sos" ? sosMapFocus?.zoom : guideMapFocus?.zoom);

  const handleMapMarkerClick = useCallback(
    (itemId: string) => {
      setReportMapFocus(null);
      if (mode === "life") {
        const hit = filteredGuideItems.find((item) => item.id === itemId) || null;
        if (hit?.position) {
          setGuideMapFocus({ center: hit.position, zoom: 16 });
        }
        setSelectedGuidePlaceId(itemId);
        setFocusedGuidePlaceId(itemId);
        setIsListCollapsed(false);
        setIsMobileExpanded(false);
        return;
      }

      const hit = filteredSosCases.find((c) => c.id === itemId) || null;
      if (hit) {
        setSosMapFocus({ center: hit.position, zoom: 16 });
      }
      setFocusedPetId(itemId);
      setSelectedPetId(itemId);
      setIsListCollapsed(false);
      setIsMobileExpanded(false);
    },
    [filteredGuideItems, filteredSosCases, mode, setFocusedPetId],
  );

  const handleLocateMyLocation = () => {
    if (isLocatingMyLocation) return;
    if (!navigator.geolocation) {
      showToast("你的裝置不支援定位。");
      return;
    }
    setIsLocatingMyLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy =
          typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy });
        setReportMapFocus(null);
        if (mode === "life") {
          setGuideMapFocus({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 16 });
        } else {
          setSosMapFocus({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 16 });
        }
        setIsLocatingMyLocation(false);
        showToast("📍 已定位到我的位置", "success");
      },
      (err) => {
        setIsLocatingMyLocation(false);
        const code = typeof err?.code === "number" ? err.code : 0;
        if (code === 1) {
          showToast("已拒絕定位權限，請到瀏覽器設定允許位置存取。");
          return;
        }
        showToast("無法取得目前定位，請稍後再試。");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 },
    );
  };

  const handleListCaseClick = useCallback((c: SosCase) => {
    setReportMapFocus(null);
    setSosMapFocus({ center: c.position, zoom: 16 });
    setFocusedPetId(c.id);
    setIsMobileExpanded(false);
    setSelectedPetId("");
  }, []);

  const handleGuidePlaceClick = useCallback((item: LifeGuideItem) => {
    setReportMapFocus(null);
    if (item.position) {
      setGuideMapFocus({ center: item.position, zoom: 16 });
    }
    setFocusedGuidePlaceId(item.id);
    setSelectedGuidePlaceId(item.id);
    setSelectedPetId("");
    setIsMobileExpanded(false);
  }, []);

  const mobileListHintLabel = useMemo(() => {
    if (mode === "life") {
      const count = filteredGuideItems.length;
      if (count <= 0) return "📖 附近暫無設施列表";
      return `📖 附近有 ${count} 個設施列表`;
    }
    const count = filteredSosCases.length;
    if (count <= 0) return "🐾 附近暫無毛孩列表";
    return `🐾 附近有 ${count} 隻毛孩列表`;
  }, [filteredGuideItems.length, filteredSosCases.length, mode]);

  const shouldShowMobileBottomControls = isMdUp
    ? true
    : !(isMobileExpanded && (mode === "sos" || mode === "life"));
  const mobileOverlayTop = useMemo(() => {
    if (isMdUp) return "5rem";
    return `calc(env(safe-area-inset-top) + ${Math.max(mobileHeaderHeight + 12, 88)}px)`;
  }, [isMdUp, mobileHeaderHeight]);
  const mobileMapInsetsStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMdUp) return undefined;
    return undefined;
  }, [isMdUp]);
  const mobileLegendBottom = useMemo(() => {
    if (isMdUp) return "1.5rem";
    return `calc(env(safe-area-inset-bottom) + ${shouldShowMobileBottomControls ? 156 : 76}px)`;
  }, [isMdUp, shouldShowMobileBottomControls]);
  const mobileFabBottom = useMemo(() => {
    if (isMdUp) return "1.5rem";
    return `calc(env(safe-area-inset-bottom) + ${shouldShowMobileBottomControls ? 84 : 20}px)`;
  }, [isMdUp, shouldShowMobileBottomControls]);
  const myLocationFabBottom = useMemo(() => {
    if (isMdUp) return "1.5rem";
    return `calc(${mobileFabBottom} + 64px)`;
  }, [isMdUp, mobileFabBottom]);

  useEffect(() => {
    if (mode !== "sos") return;
    if (!focusedPetId) return;
    const el = sosCardRefMap.current.get(focusedPetId);
    if (!el) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }, [focusedPetId, isListCollapsed, isMobileExpanded, mode]);

  useEffect(() => {
    if (mode !== "life") return;
    if (!focusedGuidePlaceId) return;
    const el = guideCardRefMap.current.get(focusedGuidePlaceId);
    if (!el) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }, [focusedGuidePlaceId, isListCollapsed, isMobileExpanded, mode]);

  const reportMarkerPosition = useMemo<[number, number] | null>(() => {
    const lat = reportForm.latitude;
    const lng = reportForm.longitude;
    if (lat == null || lng == null) {
      return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return [lat, lng];
  }, [reportForm.latitude, reportForm.longitude]);

  const quickDownloadPoster = async () => {
    if (!selectedPet) return;
    if (isQuickDownloading) return;
    setIsQuickDownloading(true);
    try {
      await downloadPosterPdf(toPosterValuesFromCase(selectedPet));
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "生成失敗，請稍後再試。";
      alert(msg);
    } finally {
      setIsQuickDownloading(false);
    }
  };

  const updateReportForm = <K extends keyof CitizenReportForm>(
    key: K,
    value: CitizenReportForm[K],
  ) => {
    setReportForm((prev) => ({ ...prev, [key]: value }));
  };

  const openReportModal = () => {
    setReportModalOpen(true);
    setIsPickLocationMode(false);
  };

  const handleMapPick = ({ lat, lng }: { lat: number; lng: number }) => {
    setReportForm((prev) => ({ ...prev, latitude: lat, longitude: lng }));
    setReportMapFocus({ center: [lat, lng], zoom: 17 });
    setIsPickLocationMode(false);
    setReportModalOpen(true);
    if (!reportForm.manualAddress.trim()) {
      void (async () => {
        const name = await reverseGeocodeHongKong(lat, lng).catch(() => null);
        if (name) {
          updateReportForm("manualAddress", name);
        }
      })();
    }
    showToast("📍 已成功在地圖上落針", "success");
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("你的裝置不支援定位。");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setReportForm((prev) => ({
          ...prev,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }));
        setReportMapFocus({
          center: [pos.coords.latitude, pos.coords.longitude],
          zoom: 17,
        });
        showToast("📍 已帶入目前定位", "success");
      },
      () => {
        showToast("無法取得目前定位，請改用地圖選點或手動輸入地址。");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  useEffect(() => {
    if (!reportModalOpen) return;
    const query = reportForm.manualAddress.trim();
    if (manualAddressDebounceRef.current) {
      window.clearTimeout(manualAddressDebounceRef.current);
    }
    if (manualAddressSearchAbortRef.current) {
      manualAddressSearchAbortRef.current.abort();
      manualAddressSearchAbortRef.current = null;
    }
    if (query.length < 2) {
      setManualAddressSuggestions([]);
      setManualAddressDropdownOpen(false);
      setManualAddressActiveIndex(-1);
      return;
    }

    manualAddressDebounceRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      manualAddressSearchAbortRef.current = controller;
      setIsSearchingManualAddress(true);
      void (async () => {
        try {
          const results = await searchHongKongAddresses(query, { limit: 6, signal: controller.signal });
          const suggestions = results.map((r) => ({
            ...r,
            id: `${r.lat}-${r.lng}-${r.label}`,
          }));
          setManualAddressSuggestions(suggestions);
          setManualAddressDropdownOpen(suggestions.length > 0);
          setManualAddressActiveIndex(suggestions.length > 0 ? 0 : -1);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error("Manual address autocomplete error:", err);
          const msg =
            err instanceof Error && err.message ? err.message : "地址搜尋失敗（請查看 console / 伺服器日誌）";
          showToast(msg);
          setManualAddressSuggestions([]);
          setManualAddressDropdownOpen(false);
          setManualAddressActiveIndex(-1);
        } finally {
          setIsSearchingManualAddress(false);
        }
      })();
    }, 500);

    return () => {
      if (manualAddressDebounceRef.current) {
        window.clearTimeout(manualAddressDebounceRef.current);
        manualAddressDebounceRef.current = null;
      }
    };
  }, [reportForm.manualAddress, reportModalOpen]);

  const selectManualAddressSuggestion = (s: AddressSuggestion) => {
    updateReportForm("manualAddress", s.label);
    setReportForm((prev) => ({ ...prev, latitude: s.lat, longitude: s.lng }));
    setReportMapFocus({ center: [s.lat, s.lng], zoom: 17 });
    setManualAddressDropdownOpen(false);
    setManualAddressSuggestions([]);
    setManualAddressActiveIndex(-1);
    showToast("📍 地址已定位，已自動移動地圖並落針。", "success");
  };

  const handleManualAddressSearch = async () => {
    const query = reportForm.manualAddress.trim();
    if (!query) {
      showToast("請先輸入具體地址。");
      return;
    }
    try {
      setIsSearchingManualAddress(true);
      if (manualAddressSuggestions.length > 0) {
        selectManualAddressSuggestion(manualAddressSuggestions[0]);
        return;
      }
      const result = await geocodeHongKongAddress(query);
      if (!result) {
        showToast("找不到該地址，系統會保留此文字地址作後備提交。");
        return;
      }
      setReportForm((prev) => ({
        ...prev,
        latitude: result.lat,
        longitude: result.lng,
      }));
      setReportMapFocus({ center: [result.lat, result.lng], zoom: 17 });
      setManualAddressDropdownOpen(false);
      showToast("📍 地址搜尋成功，已自動移動地圖並落針。", "success");
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "地址搜尋失敗，系統會保留此文字地址作後備提交。";
      showToast(msg);
    } finally {
      setIsSearchingManualAddress(false);
    }
  };

  const handleCitizenImageFile = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      updateReportForm("imageUrl", dataUrl);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "圖片處理失敗";
      showToast(msg);
    }
  };

  const handleTimelineImageFile = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setTimelineReportImageUrl(dataUrl);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "圖片處理失敗";
      showToast(msg);
    }
  };

  const validateReportForm = () => {
    if (
      !reportForm.petName ||
      !reportForm.phone ||
      (!reportForm.location.trim() && !reportForm.manualAddress.trim()) ||
      !reportForm.lostTime
    ) {
      throw new Error("請先填寫：寵物名字、聯絡電話、地點或手動地址、時間。");
    }
    if (!reportForm.features) {
      throw new Error("請填寫毛孩特徵。");
    }
    if (!reportForm.petType) {
      throw new Error("請選擇寵物種類。");
    }
    if ((reportForm.petType === "cat" || reportForm.petType === "dog" || reportForm.petType === "bird") && !reportForm.breed.trim()) {
      throw new Error("請選擇詳細品種。");
    }
    if (!reportForm.sourceType) {
      throw new Error("請選擇聯絡人身份。");
    }
    if (needsSourceLink(reportForm.sourceType) && !reportForm.sourceLink.trim()) {
      throw new Error("社交媒體轉貼案件請輸入原帖連結。");
    }
    if (
      (!Number.isFinite(reportForm.latitude) || !Number.isFinite(reportForm.longitude)) &&
      !reportForm.manualAddress.trim()
    ) {
      throw new Error("請先提供座標，或填寫手動地址作後備。");
    }
    if (!isLoggedIn && !reportForm.email.trim()) {
      throw new Error("未登入市民請先填寫電郵，以便傳送安全登入連結到電郵。");
    }
  };

  const handleDirectCitizenSubmit = async () => {
    try {
      validateReportForm();
      const freshUser = await getFreshSignedInUser();
      if (!freshUser) {
        await persistPendingReportAndStartAuth("google");
        return;
      }
      if (isSubmittingReport) return;
      setIsSubmittingReport(true);
      await submitCitizenReport(reportForm, freshUser);
      resetReportForm();
      closeReportModal();
      showToast("🎉 報料已成功送往後台審批，管理員核實後會立刻上線！", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "提交失敗";
      showToast(msg);
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const openTimelineReport = async () => {
    try {
      if (!selectedPet) return;
      if (!isUuid(selectedPet.id)) {
        showToast("此為示範案件，暫不支援提交目擊情報。");
        return;
      }
      const freshUser = await getFreshSignedInUser({ allowAuthCodeRetry: true });
      if (!freshUser) {
        showToast("請先登入以提供可靠的搜救情報。");
        await startGoogleAuth();
        return;
      }
      setTimelineReportTime(formatNowHHMM());
      setTimelineReportText("");
      setTimelineReportImageUrl("");
      setTimelineReportOpen(true);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "登入狀態同步失敗，請再試一次。";
      showToast(msg);
    }
  };

  const submitTimelineReport = async () => {
    if (!selectedPet) return;
    if (isSubmittingTimelineReport) return;
    if (!isUuid(selectedPet.id)) {
      showToast("此為示範案件，暫不支援提交目擊情報。");
      return;
    }
    const time = timelineReportTime.trim();
    const text = timelineReportText.trim();
    if (!time || !text) {
      showToast("請填寫目擊時間與情報內容。");
      return;
    }
    try {
      const freshUser = await getFreshSignedInUser({ allowAuthCodeRetry: true });
      if (!freshUser) {
        showToast("請先登入以提供可靠的搜救情報。");
        await startGoogleAuth();
        return;
      }
      setIsSubmittingTimelineReport(true);
      const res = await fetch(`/api/pets/${selectedPet.id}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time, text, imageDataUrl: timelineReportImageUrl || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (res.status === 401) {
        showToast("請先登入以提供可靠的搜救情報。");
        await startGoogleAuth();
        return;
      }
      if (!res.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "提交失敗");
      }
      const nextTimeline = Array.isArray(json.timeline) ? (json.timeline as PetTimelineItem[]) : [];
      setRemoteCases((prev) =>
        prev ? prev.map((c) => (c.id === selectedPet.id ? { ...c, timeline: nextTimeline } : c)) : prev,
      );
      setTimelineReportOpen(false);
      setTimelineReportImageUrl("");
      showToast("✅ 情報已提交，感謝你協助搜救！", "success");
      try {
        const district = typeof json?.district === "string" ? json.district : selectedPet.district;
        const imageUrl =
          typeof json?.imageUrl === "string" && json.imageUrl ? json.imageUrl : selectedPet.photoUrl;
        const latitude =
          typeof json?.latitude === "number"
            ? json.latitude
            : Number.isFinite(selectedPet.position?.[0])
              ? selectedPet.position[0]
              : undefined;
        const longitude =
          typeof json?.longitude === "number"
            ? json.longitude
            : Number.isFinite(selectedPet.position?.[1])
              ? selectedPet.position[1]
              : undefined;
        await broadcastDistrictEvent(district, "NEW_SIGHTING", {
          petId: selectedPet.id,
          district: district || "全港",
          time,
          text,
          petName: typeof json?.petName === "string" ? json.petName : selectedPet.title,
          imageUrl,
          address: typeof json?.address === "string" ? json.address : selectedPet.locationName,
          latitude,
          longitude,
          actorId: currentUserIdRef.current,
        });
      } catch {}
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "提交失敗";
      showToast(msg);
    } finally {
      setIsSubmittingTimelineReport(false);
    }
  };

  const persistPendingReportAndStartAuth = async (mode: "google" | "magic") => {
    if (isSubmittingReport) return;
    try {
      validateReportForm();
      setIsSubmittingReport(true);
      window.localStorage.setItem(PENDING_REPORT_STORAGE_KEY, JSON.stringify(reportForm));
      if (mode === "google") {
        await startGoogleAuth();
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: reportForm.email.trim().toLowerCase(),
        options: {
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      showToast("✉️ 安全登入連結已寄出，完成登入後會自動綁定並提交這筆報料。", "success");
      setIsSubmittingReport(false);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "啟動登入失敗";
      showToast(msg);
      setIsSubmittingReport(false);
    }
  };

  if (!isMounted) {
    return (
      <div className="flex h-[100svh] w-full items-center justify-center bg-black p-8 text-center text-sm font-semibold text-white">
        地圖載入中...
      </div>
    );
  }

  return (
    <div suppressHydrationWarning={true} className="relative h-[100svh] w-full overflow-hidden bg-black">
      <AppToast message={toastMessage} tone={toastTone} onClose={() => setToastMessage(null)} />

      <div className="relative h-full w-full md:flex">
        <div
          className={[
            "hidden h-full flex-col bg-white md:flex",
            "transition-all duration-300 ease-in-out",
            "overflow-hidden",
            isListCollapsed ? "w-0" : "w-[320px]",
          ].join(" ")}
        >
          <div className="flex h-full flex-col border-r border-slate-200">
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
              <div className="text-lg font-black text-slate-900">
                {mode === "sos" ? "🐾 附近毛孩列表" : "📖 香港寵物指南列表"}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                {mode === "sos"
                  ? `共 ${filteredSosCases.length} 宗案件`
                  : `共 ${filteredGuideItems.length} 個設施`}
              </div>
              <div className="mt-3">
                <div className="text-[11px] font-black tracking-wide text-slate-500">分區篩選</div>
                <select
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  className={[
                    "mt-2 w-full rounded-2xl border px-3 py-2.5 text-sm font-black shadow-sm outline-none transition",
                    "bg-white text-slate-900 border-slate-200 ring-1 ring-black/5",
                    "hover:bg-slate-50 focus:ring-2 focus:ring-slate-300",
                  ].join(" ")}
                >
                  {Object.keys(HONG_KONG_DISTRICTS).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              {mode !== "sos" && SOS_ENABLED ? (
                <button
                  type="button"
                  onClick={() => setMode("sos")}
                  className="mt-3 rounded-2xl bg-red-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-red-700"
                >
                  🚨 切換到 SOS尋寵地圖
                </button>
              ) : null}
            </div>

            <div ref={sosListContainerRef} className="flex-1 overflow-y-auto px-5 py-4">
              {mode === "sos" ? (
                filteredSosCases.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                    附近暫無案件
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredSosCases.map((c) => (
                      <div key={c.id} ref={(el) => void sosCardRefMap.current.set(c.id, el)}>
                        <SosPetListCard
                          c={c}
                          active={focusedPetId === c.id}
                          onClick={() => handleListCaseClick(c)}
                        />
                      </div>
                    ))}
                  </div>
                )
              ) : isLoadingGuidePlaces && guidePlaces.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                  正在載入指南設施資料…
                </div>
              ) : filteredGuideItems.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                  目前未有對應設施資料
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredGuideItems.map((item) => (
                    <div key={item.id} ref={(el) => void guideCardRefMap.current.set(item.id, el)}>
                      <GuidePlaceListCard
                        item={item}
                        active={focusedGuidePlaceId === item.id}
                        onClick={() => handleGuidePlaceClick(item)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative h-full w-full flex-1">
          {isMdUp ? (
            <button
              type="button"
              onClick={() => setIsListCollapsed((p) => !p)}
              aria-label={
                isListCollapsed
                  ? mode === "sos"
                    ? "展開毛孩列表"
                    : "展開寵物指南"
                  : mode === "sos"
                    ? "收起毛孩列表"
                    : "收起寵物指南"
              }
              className={`absolute top-[38%] -translate-y-1/2 z-[999] bg-white border border-slate-200 shadow-md hover:bg-slate-50 transition-all duration-300 rounded-full w-8 py-4 flex flex-col items-center justify-center gap-1 text-[13px] font-bold text-slate-700 cursor-pointer ${isListCollapsed ? "left-3" : "left-0 -translate-x-1/2"}`}
            >
              {isListCollapsed ? (
                <>
                  <span>打</span>
                  <span>開</span>
                  <span className="my-0.5">{mode === "sos" ? "🐾" : "📖"}</span>
                  {(mode === "sos" ? ["毛", "孩", "列", "表"] : ["寵", "物", "指", "南"]).map((ch, idx) => (
                    <span key={`${ch}-${idx}`}>{ch}</span>
                  ))}
                  <span className="mt-0.5">▶</span>
                </>
              ) : (
                <>
                  <span className="mb-0.5">◀</span>
                  <span>收</span>
                  <span>起</span>
                  <span className="my-0.5">{mode === "sos" ? "🐾" : "📖"}</span>
                  {(mode === "sos" ? ["毛", "孩", "列", "表"] : ["寵", "物", "指", "南"]).map((ch, idx) => (
                    <span key={`${ch}-${idx}`}>{ch}</span>
                  ))}
                </>
              )}
            </button>
          ) : null}

          {liveNotification ? (
            <div className="pointer-events-none fixed inset-x-0 z-[1250] px-4 md:absolute md:top-20" style={{ top: mobileOverlayTop }}>
          <button
            type="button"
            onClick={() =>
              void focusOnPet(liveNotification.petId, liveNotification.latitude, liveNotification.longitude)
            }
            className="pointer-events-auto w-full rounded-2xl bg-red-600 p-3 text-left shadow-2xl ring-1 ring-black/10"
          >
            <div className="flex items-center gap-3">
              {liveNotification.imageUrl ? (
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-2 ring-white/60">
                  <img
                    src={liveNotification.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <PhotoWatermarkOverlay />
                </div>
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg font-black text-white">
                  🚨
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-white">{liveNotification.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs font-semibold text-white/90">
                  {liveNotification.message}
                </div>
              </div>
              <div className="shrink-0 rounded-xl bg-white/15 px-3 py-2 text-xs font-black text-white">
                查看
              </div>
            </div>
          </button>
        </div>
      ) : null}

      {notificationPanelOpen ? (
        <div
          className="fixed inset-x-3 z-[1240] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 md:absolute md:left-auto md:right-4 md:w-[min(92vw,360px)]"
          style={{ top: mobileOverlayTop }}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-black text-slate-900">🔔 街坊搜救推播設定</div>
            <button
              type="button"
              onClick={() => setNotificationPanelOpen(false)}
              className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-black text-slate-900"
            >
              關閉
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <div className="space-y-4 border-b border-slate-100 p-4">
              <div>
                <div className="text-sm font-semibold leading-relaxed text-slate-700">
                  當您關注的地區有毛孩走失或被目擊時，即使關閉網頁，手機或電腦也能第一時間收到緊急推播！
                </div>
              </div>

              <div className={["rounded-2xl px-4 py-3 ring-1", notificationBadge.tone].join(" ")}>
                <div className="text-sm font-black">{notificationBadge.label}</div>
                <div className="mt-1 text-xs font-semibold leading-relaxed">{notificationBadge.hint}</div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-xs font-black tracking-wide text-slate-500">關注區域</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFollowDistrict(ALL_DISTRICTS_TOKEN)}
                    className={[
                      "rounded-full px-3 py-2 text-xs font-black ring-1 transition",
                      followDistricts.includes(ALL_DISTRICTS_TOKEN)
                        ? "bg-red-600 text-white ring-red-600"
                        : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {followDistricts.includes(ALL_DISTRICTS_TOKEN) ? "☑" : "☐"} 全港
                  </button>
                  {selectableDistricts.map((district) => {
                    const checked = followDistricts.includes(district);
                    const disabled = followDistricts.includes(ALL_DISTRICTS_TOKEN);
                    return (
                      <button
                        key={district}
                        type="button"
                        onClick={() => toggleFollowDistrict(district)}
                        disabled={disabled}
                        className={[
                          "rounded-full px-3 py-2 text-xs font-black ring-1 transition",
                          checked
                            ? "bg-red-50 text-red-700 ring-red-200"
                            : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100",
                          disabled ? "cursor-not-allowed opacity-45" : "",
                        ].join(" ")}
                      >
                        {checked ? "☑" : "☐"} {district}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">
                  你目前關注的是「{followDistrictSummary}」，這裡的選擇會與 Navbar 同步更新。
                </div>
              </div>

              {notificationPermissionState === "denied" ? (
                <button
                  type="button"
                  onClick={openNotificationHelpModal}
                  className="w-full rounded-2xl bg-black/85 px-4 py-3 text-left text-sm font-black text-white shadow-lg ring-1 ring-black/30"
                >
                  🐾 哎呀，您的瀏覽器關閉了通知權限！點擊此處查看 3 秒開啟教學 ➔
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleEnableDistrictNotifications()}
                  disabled={followDistricts.length === 0}
                  className={[
                    "w-full rounded-2xl px-4 py-3 text-sm font-black text-white shadow-lg ring-1",
                    followDistricts.length === 0
                      ? "cursor-not-allowed bg-slate-300 ring-slate-300"
                      : "bg-red-600 ring-red-700/40",
                  ].join(" ")}
                >
                  {districtNotificationCtaLabel}
                </button>
              )}
            </div>
            <div className="border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-900">站內通知</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    有人新增目擊情報時，主人會在這裡收到提醒。
                  </div>
                </div>
                {isLoggedIn && unreadAppCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markAppNotificationsRead()}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-700 ring-1 ring-slate-200"
                  >
                    全部標記已讀
                  </button>
                ) : null}
              </div>
              {!isLoggedIn ? (
                <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                  登入後即可查看屬於你的站內通知。
                </div>
              ) : appNotifications.length === 0 ? (
                <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                  暫無站內通知
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {appNotifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (!item.isRead) {
                          void markAppNotificationsRead(item.id);
                        }
                        if (item.petId) {
                          void focusOnPet(item.petId);
                        }
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        item.isRead
                          ? "border-slate-200 bg-white"
                          : "border-amber-200 bg-amber-50/70",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-base">
                          {item.isRead ? "🔔" : "🟠"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-black text-slate-900">{item.title}</div>
                            {!item.isRead ? (
                              <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                                NEW
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">
                            {item.content}
                          </div>
                          <div className="mt-1 text-[11px] font-bold text-slate-500">
                            {new Date(item.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="px-4 pt-4 text-sm font-black text-slate-900">地區速報</div>
              {notifications.length === 0 ? (
                <div className="p-4 text-sm font-semibold text-slate-600">暫無地區速報</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => void focusOnPet(n.petId, n.latitude, n.longitude)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      {n.imageUrl ? (
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl">
                          <img
                            src={n.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <PhotoWatermarkOverlay />
                        </div>
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-base">
                          🔔
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-slate-900">{n.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-600">
                          {n.message}
                        </div>
                        <div className="mt-1 text-[11px] font-bold text-slate-500">
                          {n.district} · {new Date(n.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className={`absolute inset-0 text-white ${mapVisualClassName}`} style={mobileMapInsetsStyle}>
        {isMounted ? (
          <SosMapCanvas
            key={mode}
            center={[22.3193, 114.1694]}
            zoom={15}
            className="h-full w-full"
            focusCenter={mainMapFocusCenter}
            focusZoom={mainMapFocusZoom}
            isPickLocationMode={isPickLocationMode}
            onPick={handleMapPick}
            cases={mainMapCases}
            iconByCaseId={iconByCaseId}
            guidePlaces={mainMapGuidePlaces}
            guideIconByPlaceId={guideIconByPlaceId}
            onMarkerClick={handleMapMarkerClick}
            reportMarkerPosition={reportMarkerPosition}
            reportLocationIcon={reportLocationIcon ?? null}
            myLocationPosition={myLocation ? ([myLocation.lat, myLocation.lng] as [number, number]) : null}
            myLocationAccuracyMeters={myLocation?.accuracy ?? null}
            myLocationIcon={myLocationIcon ?? null}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-200/70 text-sm font-black text-slate-700">
            地圖載入中...
          </div>
        )}

        <div
          className="pointer-events-none absolute right-4 z-[975] flex flex-col items-end gap-2 md:right-6"
          style={{ bottom: myLocationFabBottom }}
        >
          <button
            type="button"
            onClick={handleLocateMyLocation}
            disabled={isLocatingMyLocation}
            aria-label="定位到我的位置"
            className={[
              "pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl shadow-xl ring-1 ring-black/10 backdrop-blur-md transition",
              "bg-white/90 text-slate-800 hover:bg-white",
              "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white/90",
            ].join(" ")}
          >
            {isLocatingMyLocation ? (
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 animate-spin text-slate-700"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 2v3m0 14v3M2 12h3m14 0h3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" opacity="0.35" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>

        {shouldShowMobileBottomControls && !isMdUp ? (
          <div
            className="pointer-events-none absolute inset-x-4 z-[970] flex flex-col gap-2 bg-transparent md:hidden"
            style={{ bottom: mobileFabBottom }}
          >
            <div className="flex gap-2 bg-transparent">
              <div className="flex-1 bg-transparent">
                <button
                  type="button"
                  onClick={() => {
                    if (mode !== "sos") {
                      setMode("sos");
                      setIsLegendExpanded(true);
                      return;
                    }
                    setIsLegendExpanded((prev) => !prev);
                  }}
                  className="pointer-events-auto inline-flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl bg-white/80 px-4 py-3 text-sm font-black text-slate-900 shadow-xl ring-1 ring-black/10 backdrop-blur-md"
                >
                  <span className="inline-flex items-center gap-2">
                    <span>🗺️</span>
                    <span>{mode === "sos" && isLegendExpanded ? "收合圖例" : "查看圖例"}</span>
                  </span>
                  {mode === "sos" && isLegendExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </button>
              </div>

              {SOS_ENABLED ? (
                <div className="flex-1 bg-transparent">
                  <button
                    type="button"
                    onClick={openReportModal}
                    className="pointer-events-auto inline-flex min-h-12 w-full items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-2xl ring-1 ring-emerald-300/60"
                  >
                    <span>➕</span>
                    <span>報料尋寵</span>
                  </button>
                </div>
              ) : null}
            </div>

            <div className="pointer-events-auto w-full rounded-3xl bg-white/95 p-1 shadow-2xl ring-1 ring-black/5">
              <div className={["grid gap-1", SOS_ENABLED ? "grid-cols-2" : "grid-cols-1"].join(" ")}>
                <button
                  type="button"
                  onClick={() => setMode("life")}
                  className={[
                    "rounded-3xl px-4 py-3 text-center text-sm font-black",
                    mode === "life"
                      ? "bg-emerald-600 text-white shadow"
                      : "bg-transparent text-zinc-800",
                  ].join(" ")}
                >
                  🐾 香港寵物全指南
                </button>

                {SOS_ENABLED ? (
                  <button
                    type="button"
                    onClick={() => setMode("sos")}
                    className={[
                      "rounded-3xl px-4 py-3 text-center text-sm font-black",
                      mode === "sos"
                        ? "bg-red-600 text-white shadow"
                        : "bg-transparent text-zinc-800",
                    ].join(" ")}
                  >
                    🚨 SOS尋寵地圖
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {mode === "sos" && (isMdUp || !isMobileExpanded) ? (
        <div
          className="pointer-events-none fixed inset-x-4 z-[980] md:absolute md:left-6 md:right-auto md:inset-x-auto"
          style={{ bottom: mobileLegendBottom }}
        >
          {isLegendExpanded ? (
            <div className="pointer-events-auto mx-auto w-full max-w-sm max-h-[240px] overflow-y-auto rounded-3xl bg-white/92 p-3 shadow-2xl ring-1 ring-black/10 backdrop-blur-md md:mx-0 md:w-[280px] md:max-h-[300px]">
              <div className="flex items-start justify-between gap-3 px-1">
                <div>
                  <div className="text-sm font-black text-slate-900">地圖圖例</div>
                  <div className="text-[11px] font-semibold text-slate-500">點擊下方類別即可隱藏 / 顯示對應 Pin</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMapLegendFilters(DEFAULT_MAP_LEGEND_FILTERS)}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                  >
                    全部顯示
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsLegendExpanded(false)}
                    aria-label="收合地圖圖例"
                    className="rounded-full bg-white/90 p-2 text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {mapLegendItems.map((item) => {
                  const active = mapLegendFilters[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        setMapLegendFilters((prev) => ({
                          ...prev,
                          [item.key]: !prev[item.key],
                        }))
                      }
                      className={[
                        "flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition",
                        active
                          ? item.activeTone
                          : "border-slate-200 bg-white text-slate-400 opacity-70",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-base">{item.emoji}</span>
                        <div>
                          <div className="text-sm font-black">{item.label}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold">
                            <span className={`h-2.5 w-2.5 rounded-full ${item.colorClass}`} />
                            <span>{active ? "目前顯示中" : "目前已隱藏"}</span>
                          </div>
                        </div>
                      </div>
                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-[11px] font-black ring-1",
                          active
                            ? "bg-white/80 text-slate-700 ring-current/10"
                            : "bg-slate-100 text-slate-500 ring-slate-200",
                        ].join(" ")}
                      >
                        {active ? "隱藏" : "顯示"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : isMdUp ? (
            <button
              type="button"
              onClick={() => setIsLegendExpanded(true)}
              className="pointer-events-auto mx-auto inline-flex items-center gap-2 rounded-full bg-white/92 px-4 py-3 text-sm font-black text-slate-800 shadow-2xl ring-1 ring-black/10 backdrop-blur-md md:mx-0"
            >
              <span>🗺️ 查看圖例</span>
              <ChevronUp className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="hidden">
        <div className="animate-ping bg-red-500 bg-blue-500 bg-emerald-500 opacity-40" />
      </div>

      {isPickLocationMode ? (
        <div className="pointer-events-none fixed inset-x-0 z-[980] px-4 md:absolute md:top-24" style={{ top: mobileOverlayTop }}>
          <div className="rounded-2xl bg-black/75 px-4 py-3 text-sm font-black text-white shadow-xl backdrop-blur">
            📍 請直接點擊地圖選擇報料位置
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 top-0 z-[900] px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:absolute md:px-4 md:pt-4">
        <div ref={mobileHeaderRef} className="pointer-events-auto">
          {mode === "life" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {guideCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setLifeGuideCategory(category.name)}
                    className={[
                      "rounded-full px-3 py-2 text-sm font-extrabold text-white shadow-lg",
                      "ring-1 ring-black/10 transition",
                      lifeGuideCategory === category.name
                        ? "bg-orange-600"
                        : "bg-orange-500/90 opacity-80 hover:opacity-100",
                    ].join(" ")}
                  >
                    {category.icon} {category.name}
                  </button>
                ))}
              </div>

              {isLoadingGuideCategories && guideCategories.length === 0 ? (
                <div className="rounded-2xl bg-white/85 px-3 py-2 text-xs font-black text-slate-700 shadow ring-1 ring-black/10 backdrop-blur">
                  正在載入指南分類…
                </div>
              ) : filteredGuideSubcategories.length > 0 ? (
                <div className="mt-2 flex w-full flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLifeGuideSubcategory("all")}
                    className={[
                      "rounded-full px-3 py-2 text-xs font-black shadow-lg ring-1 transition",
                      lifeGuideSubcategory === "all"
                        ? "bg-white text-orange-700 ring-orange-200"
                        : "bg-white/85 text-slate-700 ring-black/10 hover:bg-white",
                    ].join(" ")}
                  >
                    全部
                  </button>
                  {filteredGuideSubcategories.map((subcategory) => (
                    <button
                      key={subcategory.id}
                      type="button"
                      onClick={() => setLifeGuideSubcategory(subcategory.name)}
                      className={[
                        "rounded-full px-3 py-2 text-xs font-black shadow-lg ring-1 transition",
                        lifeGuideSubcategory === subcategory.name
                          ? "bg-white text-orange-700 ring-orange-200"
                          : "bg-white/85 text-slate-700 ring-black/10 hover:bg-white",
                      ].join(" ")}
                    >
                      {subcategory.name}
                    </button>
                  ))}
                </div>
              ) : guideCategories.length === 0 ? (
                <div className="rounded-2xl bg-white/85 px-3 py-2 text-xs font-black text-slate-700 shadow ring-1 ring-black/10 backdrop-blur">
                  暫時未有指南分類，請先到後台新增。
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-2xl bg-red-600 px-3 py-2.5 shadow-lg ring-1 ring-black/10 md:px-4 md:py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 md:flex md:justify-between md:gap-3">
                  <div className="min-w-0 text-xs font-black tracking-tight text-white md:text-sm">
                    🐾 日日寵 尋寵地圖
                  </div>
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationPanelOpen((p) => !p);
                        setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
                        if (isLoggedIn) {
                          void fetchAppNotifications();
                        }
                      }}
                      className="relative flex items-center gap-2 rounded-xl bg-white/15 px-2.5 py-2 ring-1 ring-white/20 md:max-w-[240px] md:px-3"
                    >
                      <span className="text-base">🔔</span>
                      <span className="hidden truncate text-xs font-black text-white md:inline">
                        {navbarNotificationControlLabel} <span className="text-white/70">▼</span>
                      </span>
                      {unreadCount > 0 ? (
                        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-black text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : null}
                    </button>

                    {!isLoggedIn ? (
                      <button
                        type="button"
                        onClick={() => setAuthModalOpen(true)}
                        className="rounded-xl bg-white px-2.5 py-2 text-sm font-black text-red-600 shadow ring-1 ring-white/60 md:px-3"
                        aria-label="登入或註冊"
                      >
                        <span className="md:hidden">👤</span>
                        <span className="hidden md:inline">👤 登入 / 註冊</span>
                      </button>
                    ) : (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setAccountMenuOpen((prev) => !prev)}
                          className="flex items-center gap-2 rounded-xl bg-white/15 px-2 py-1.5 text-sm font-black text-white ring-1 ring-white/20"
                        >
                          {currentUserAvatar ? (
                            <img
                              src={currentUserAvatar}
                              alt={currentUserLabel}
                              className="h-8 w-8 rounded-full object-cover ring-2 ring-white/70"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-black text-red-600">
                              {currentUserLabel.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span className="hidden max-w-[84px] truncate text-xs font-black text-white sm:inline">
                            {currentUserLabel}
                          </span>
                        </button>
                        {accountMenuOpen ? (
                          <div className="absolute right-0 top-12 w-48 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
                            <div className="border-b border-slate-100 px-4 py-3">
                              <div className="text-xs font-black text-slate-900">{currentUserLabel}</div>
                              <div className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                                {currentUser?.email || "已登入會員"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleSignOut()}
                              className="w-full px-4 py-3 text-left text-sm font-black text-slate-900 hover:bg-slate-50"
                            >
                              🚪 登出帳號
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {notificationPermissionState === "denied" ? (
                <button
                  type="button"
                  onClick={openNotificationHelpModal}
                  className="w-full rounded-2xl bg-black/80 px-3 py-2.5 text-left text-xs font-black text-white shadow-xl ring-1 ring-white/10 backdrop-blur md:px-4 md:py-3 md:text-sm"
                >
                  🐾 哎呀，您的瀏覽器關閉了通知權限！點擊此處查看 3 秒開啟教學 ➔
                </button>
              ) : null}

              <div className="scrollbar-none flex w-full flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-1">
                <SosSpeciesFilterButton
                  label="全部"
                  active={sosSpeciesFilter === "all"}
                  onClick={() => setSosSpeciesFilter("all")}
                />
                <SosSpeciesFilterButton
                  label="🐱 貓貓"
                  active={sosSpeciesFilter === "cat"}
                  onClick={() => setSosSpeciesFilter("cat")}
                />
                <SosSpeciesFilterButton
                  label="🐶 狗狗"
                  active={sosSpeciesFilter === "dog"}
                  onClick={() => setSosSpeciesFilter("dog")}
                />
                <SosSpeciesFilterButton
                  label="🦜 鸚鵡/雀鳥"
                  active={sosSpeciesFilter === "bird"}
                  onClick={() => setSosSpeciesFilter("bird")}
                />
                <SosSpeciesFilterButton
                  label="🐹 其他"
                  active={sosSpeciesFilter === "other"}
                  onClick={() => setSosSpeciesFilter("other")}
                />
              </div>

              {mode === "sos" && (sosSpeciesFilter === "cat" || sosSpeciesFilter === "dog" || sosSpeciesFilter === "bird") ? (
                <div className="mt-2 flex w-full flex-wrap gap-2">
                  <SosBreedFilterChip
                    label="全部"
                    active={sosBreedFilter === "all"}
                    onClick={() => setSosBreedFilter("all")}
                  />
                  {filteredSosBreedOptions.map((item) => (
                    <SosBreedFilterChip
                      key={item.id}
                      label={item.breed_name}
                      active={sosBreedFilter === item.breed_name}
                      onClick={() => setSosBreedFilter(item.breed_name)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {shouldShowMobileBottomControls ? (
        isMdUp ? (
          <div
            className={[
              "pointer-events-none fixed inset-x-0 z-[950] pb-[env(safe-area-inset-bottom)]",
              mode === "sos"
                ? "bottom-[calc(env(safe-area-inset-bottom)+70px)] md:bottom-0"
                : "bottom-0",
            ].join(" ")}
          >
            <div className="pointer-events-auto px-4 pb-4">
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={openReportModal}
                  className="rounded-full bg-emerald-500 px-5 py-4 text-sm font-black text-white shadow-2xl ring-4 ring-white/70"
                >
                  ➕ 報料尋寵
                </button>
              </div>

              <div className="mt-3 rounded-3xl bg-white/95 p-1 shadow-2xl ring-1 ring-black/5">
                <div className={["grid gap-1", SOS_ENABLED ? "grid-cols-2" : "grid-cols-1"].join(" ")}>
                  <button
                    type="button"
                    onClick={() => setMode("life")}
                    className={[
                      "rounded-3xl px-4 py-3 text-center text-sm font-black",
                      mode === "life"
                        ? "bg-emerald-600 text-white shadow"
                        : "bg-transparent text-zinc-800",
                    ].join(" ")}
                  >
                    🐾 香港寵物全指南
                  </button>
                  {SOS_ENABLED ? (
                    <button
                      type="button"
                      onClick={() => setMode("sos")}
                      className={[
                        "rounded-3xl px-4 py-3 text-center text-sm font-black",
                        mode === "sos"
                          ? "bg-red-600 text-white shadow"
                          : "bg-transparent text-zinc-800",
                      ].join(" ")}
                    >
                      🚨 SOS尋寵地圖
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 text-center text-[11px] font-medium text-white/80 drop-shadow">
                日日寵 · Mobile Web
              </div>
            </div>
          </div>
        ) : null
      ) : null}

      {mode === "sos" || mode === "life" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] pb-[env(safe-area-inset-bottom)] md:hidden">
          <div
            className={[
              "pointer-events-auto mx-auto h-[75svh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-black/10",
              "transition-all duration-300 ease-in-out transform-gpu",
              isMobileExpanded ? "translate-y-0" : "translate-y-[calc(75svh-70px)]",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => setIsMobileExpanded((p) => !p)}
              className="flex h-[70px] w-full flex-col justify-center px-4"
            >
              <div className="mx-auto h-1 w-12 rounded-full bg-slate-300" />
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="truncate text-sm font-black text-slate-900">{mobileListHintLabel}</div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  {isMobileExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </div>
              </div>
            </button>

            <div ref={mobileListContainerRef} className="h-[calc(75svh-70px)] overflow-y-auto px-4 pb-5">
              <div className="pt-3">
                <div className="text-[11px] font-black tracking-wide text-slate-500">分區篩選</div>
                <select
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  className={[
                    "mt-2 w-full rounded-2xl border px-4 py-3 text-sm font-black shadow-sm outline-none transition",
                    "bg-white text-slate-900 border-slate-200 ring-1 ring-black/5",
                    "hover:bg-slate-50 focus:ring-2 focus:ring-slate-300",
                  ].join(" ")}
                >
                  {Object.keys(HONG_KONG_DISTRICTS).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {mode === "sos" ? (
                filteredSosCases.length === 0 ? (
                  <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                    附近暫無案件
                  </div>
                ) : (
                  <div className="space-y-3 pb-4 pt-3">
                    {filteredSosCases.map((c) => (
                      <div key={c.id} ref={(el) => void sosCardRefMap.current.set(c.id, el)}>
                        <SosPetListCard
                          c={c}
                          active={focusedPetId === c.id}
                          onClick={() => handleListCaseClick(c)}
                        />
                      </div>
                    ))}
                  </div>
                )
              ) : isLoadingGuidePlaces && guidePlaces.length === 0 ? (
                <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                  正在載入指南設施資料…
                </div>
              ) : filteredGuideItems.length === 0 ? (
                <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                  目前未有對應設施資料
                </div>
              ) : (
                <div className="space-y-3 pb-4 pt-3">
                  {filteredGuideItems.map((item) => (
                    <div key={item.id} ref={(el) => void guideCardRefMap.current.set(item.id, el)}>
                      <GuidePlaceListCard
                        item={item}
                        active={focusedGuidePlaceId === item.id}
                        onClick={() => handleGuidePlaceClick(item)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1200]">
        <div
          className={[
            "pointer-events-auto relative mx-auto w-full max-h-[90svh] overflow-hidden rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 md:max-w-5xl md:rounded-3xl",
            selectedGuidePlace ? "translate-y-0" : "translate-y-full",
          ].join(" ")}
        >
          {selectedGuidePlace ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedGuidePlaceId("")}
                aria-label="關閉彈窗"
                className="absolute right-4 top-4 z-50 rounded-full bg-gray-50 p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>

              <div className="max-h-[90svh] overflow-y-auto">
                <div className="px-4 pb-6 pt-6 md:px-6">
                  <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-white p-1">
                        <div className="mb-4 pr-14 text-[2.2rem] font-black leading-tight text-gray-900">
                          {selectedGuidePlace.title}
                        </div>

                        <div className="space-y-3">
                          <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                            <div className="text-base font-medium text-slate-800">
                              <span className="font-black">🏷️ 分類：</span>
                              {selectedGuidePlace.category_icon} {selectedGuidePlace.category_name} ·{" "}
                              {(selectedGuidePlace.subcategory_names.length > 0
                                ? selectedGuidePlace.subcategory_names
                                : [selectedGuidePlace.subcategory_name]
                              ).join(" / ")}
                            </div>
                            <div className="text-base font-medium text-slate-800">
                              <span className="font-black">📍 詳細地址：</span>
                              {selectedGuidePlace.address}
                            </div>
                            <div className="text-base font-medium text-slate-800">
                              <span className="font-black">📏 距離：</span>
                              {myLocation && selectedGuidePlace.position
                                ? formatDistanceMeters(selectedGuidePlace.distance_meters ?? null) || "—"
                                : "允許定位以顯示距離"}
                            </div>
                            <div className="text-base font-medium text-slate-800">
                              <span className="font-black">⏰ 開放時間：</span>
                              {selectedGuidePlace.opening_hours?.trim() ? selectedGuidePlace.opening_hours : "營業時間待補"}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-gray-50 p-4 text-lg font-medium leading-relaxed text-gray-700">
                            <div className="mb-2 text-sm font-bold text-slate-600">🏷️ 設施標籤</div>
                            <div className="flex flex-wrap gap-2">
                              {selectedGuidePlace.featureBadges.length > 0 ? (
                                selectedGuidePlace.featureBadges.map((badge) => (
                                  <span
                                    key={`${selectedGuidePlace.id}-detail-${badge.key}`}
                                    className={`rounded-full px-3 py-2 text-sm font-black ring-1 ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                ))
                              ) : (
                                <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-black text-slate-500 ring-1 ring-slate-200">
                                  暫未提供設施標籤
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      {(() => {
                        const imageUrls =
                          Array.isArray(selectedGuidePlace.image_urls) && selectedGuidePlace.image_urls.length > 0
                            ? selectedGuidePlace.image_urls
                            : selectedGuidePlace.image_url
                              ? [selectedGuidePlace.image_url]
                              : [];
                        const safeSelectedIndex =
                          imageUrls.length === 0 ? 0 : Math.min(selectedGuidePlaceImageIndex, imageUrls.length - 1);
                        const primaryImageUrl = imageUrls[safeSelectedIndex] ?? "";

                        return primaryImageUrl ? (
                          <div className="space-y-3">
                            <div className="relative rounded-2xl bg-slate-100 shadow-sm ring-1 ring-black/5" style={{ position: "relative" }}>
                              <img
                                src={primaryImageUrl}
                                alt={selectedGuidePlace.title}
                                className="aspect-[4/3] w-full object-cover md:aspect-square"
                                loading="lazy"
                              />
                            </div>
                            {imageUrls.length > 1 ? (
                              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-black/5">
                                <div className="mb-2 text-xs font-black text-slate-500">相片集</div>
                                <div className="grid grid-cols-4 gap-2">
                                  {imageUrls.map((url, index) => (
                                    <button
                                      key={`${selectedGuidePlace.id}-gallery-${index}`}
                                      type="button"
                                      onClick={() => setSelectedGuidePlaceImageIndex(index)}
                                      className={[
                                        "overflow-hidden rounded-xl border bg-slate-50 transition",
                                        safeSelectedIndex === index
                                          ? "border-emerald-500 ring-2 ring-emerald-200"
                                          : "border-slate-200 hover:border-slate-300",
                                      ].join(" ")}
                                      aria-label={`查看第 ${index + 1} 張相片`}
                                      aria-pressed={safeSelectedIndex === index}
                                    >
                                      <img
                                        src={url}
                                        alt={`${selectedGuidePlace.title} 相片 ${index + 1}`}
                                        className="aspect-square w-full object-cover"
                                        loading="lazy"
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500 shadow-sm ring-1 ring-black/5 md:aspect-square">
                            暫無相片
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div
          className={[
            "pointer-events-auto relative mx-auto w-full max-h-[90svh] overflow-hidden rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 md:max-w-5xl md:rounded-3xl",
            selectedPet ? "translate-y-0" : "translate-y-full",
          ].join(" ")}
        >
          {selectedPet ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedPetId("")}
                aria-label="關閉彈窗"
                className="absolute right-4 top-4 z-50 rounded-full bg-gray-50 p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>

              <div className="max-h-[90svh] overflow-y-auto">
                <div className="px-4 pb-6 pt-6 md:px-6">
                  {(() => {
                    const raw = String(selectedPet.phone || "").trim();
                    const digits = raw.replace(/\D/g, "");
                    const telHref = digits ? (digits.startsWith("852") ? `tel:+${digits}` : `tel:${digits}`) : "";
                    const hk = digits ? (digits.startsWith("852") ? digits : `852${digits}`) : "";
                    const contactTarget = getContactActionTarget(selectedPet.contactIdentityType);
                    const msg = `你好，我在【日日寵 尋寵地圖】看到你走失/目擊毛孩【${selectedPet.title}】的個案，想了解/提供消息...`;
                    const whatsappHref = hk ? `https://wa.me/${hk}?text=${encodeURIComponent(msg)}` : "";
                    const sourceHref = String(selectedPet.sourceUrl || "").trim();
                    const canOpenSourceHref = /^https?:\/\//i.test(sourceHref);
                    const shareUrl = (() => {
                      const url = new URL(`/sos/${encodeURIComponent(selectedPet.id)}`, window.location.origin);
                      return url.toString();
                    })();
                    const isPrivacyProtectionEnabled = selectedPet.enablePrivacy !== false;
                    const featureText = (() => {
                      const t = String(selectedPet.features || "").trim();
                      if (!t) return "暫無描述";
                      if (/^(na|n\/a|null|nil|無|未知)$/i.test(t)) return "暫無描述";
                      return t;
                    })();

                    return (
                      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                          <div className="rounded-2xl bg-white p-1">
                            <div className="mb-4 pr-14 text-[2.2rem] font-black leading-tight text-gray-900">
                              {selectedPet.title}
                            </div>
                            <div className="space-y-3">
                              <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                                <div className="text-base font-medium text-slate-800">
                                  <span className="font-black">👤 聯絡人身份：</span>
                                  {selectedPet.contactIdentity}
                                </div>
                                <div className="text-base font-medium text-slate-800">
                                  <span className="font-black">📍 詳細地點：</span>
                                  {selectedPet.locationName}
                                </div>
                                <div className="text-base font-medium text-slate-800">
                                  <span className="font-black">⏰ 發生時間：</span>
                                  {formatHongKongDateTime(selectedPet.lostTime)}
                                </div>
                              </div>
                              <div className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-100">
                                <div className="text-sm font-bold text-slate-600">📞 聯絡電話</div>
                                <div className="mt-2 text-xl font-bold text-red-600">
                                  {isPrivacyProtectionEnabled
                                    ? "聯絡電話：【已啟用防騙隱私保護，請使用下方綠色按鈕聯絡主人】"
                                    : `聯絡電話：${selectedPet.phone || "91234567"}`}
                                </div>
                              </div>
                              <div className="rounded-2xl bg-gray-50 p-4 text-lg font-medium leading-relaxed text-gray-700">
                                <div className="mb-2 text-sm font-bold text-slate-600">🐾 毛孩特徵</div>
                                <div>{featureText}</div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3 pb-2">
                            <a
                              href={whatsappHref || "#"}
                              target={whatsappHref ? "_blank" : undefined}
                              rel={whatsappHref ? "noopener noreferrer" : undefined}
                              className={[
                                "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-center text-base font-black text-white shadow-lg",
                                whatsappHref ? "bg-[#25D366] hover:bg-[#20ba5a]" : "bg-slate-300",
                              ].join(" ")}
                              aria-disabled={!whatsappHref}
                              onClick={(e) => {
                                e.preventDefault();
                                if (!whatsappHref) return;
                                if (isPrivacyProtectionEnabled) {
                                  openScamWarningModal(whatsappHref, "whatsapp");
                                  return;
                                }
                                window.open(whatsappHref, "_blank");
                              }}
                            >
                              <svg viewBox="0 0 32 32" width="20" height="20" fill="currentColor" aria-hidden="true">
                                <path d="M16 3C9.383 3 4 8.383 4 15c0 2.27.634 4.468 1.84 6.385L4.5 29l7.805-1.297A11.93 11.93 0 0 0 16 27c6.617 0 12-5.383 12-12S22.617 3 16 3zm0 21.6c-1.97 0-3.9-.527-5.58-1.523l-.4-.236-4.63.77.78-4.515-.257-.416A9.552 9.552 0 0 1 6.4 15C6.4 9.706 10.706 5.4 16 5.4S25.6 9.706 25.6 15 21.294 24.6 16 24.6zm5.513-7.208c-.302-.152-1.785-.88-2.062-.98-.277-.1-.479-.152-.68.152-.202.303-.781.98-.959 1.183-.176.202-.353.227-.655.076-.302-.152-1.274-.469-2.426-1.495-.896-.798-1.5-1.784-1.676-2.087-.176-.303-.019-.466.133-.618.136-.135.303-.353.454-.53.152-.176.202-.303.303-.505.101-.202.05-.379-.025-.53-.076-.152-.68-1.637-.932-2.24-.245-.589-.494-.509-.68-.519l-.58-.01c-.202 0-.53.076-.807.379-.277.303-1.06 1.036-1.06 2.526 0 1.49 1.086 2.93 1.237 3.132.152.202 2.14 3.269 5.183 4.585.724.312 1.288.499 1.728.639.726.231 1.386.198 1.907.12.582-.087 1.785-.73 2.037-1.434.252-.705.252-1.309.176-1.434-.075-.126-.277-.202-.579-.354z" />
                              </svg>
                              {`WhatsApp 聯絡${contactTarget}`}
                            </a>

                            <div className="grid grid-cols-2 gap-3">
                              <a
                                href={telHref || "#"}
                                className={[
                                  "rounded-2xl border px-4 py-4 text-center text-sm font-black shadow-sm",
                                  telHref
                                    ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
                                    : "border-slate-200 bg-slate-50 text-slate-400",
                                ].join(" ")}
                                aria-disabled={!telHref}
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (!telHref) return;
                                  if (isPrivacyProtectionEnabled) {
                                    openScamWarningModal(telHref, "tel");
                                    return;
                                  }
                                  window.location.href = telHref;
                                }}
                              >
                                {`📞 致電${contactTarget}`}
                              </a>
                              <button
                                type="button"
                                disabled={isSharing}
                                className={[
                                  "rounded-2xl bg-sky-500 px-4 py-4 text-center text-sm font-black text-white shadow-sm",
                                  isSharing ? "opacity-70" : "hover:bg-sky-600",
                                ].join(" ")}
                                onClick={async () => {
                                  if (isSharing) return;
                                  setIsSharing(true);
                                  const title = `[走失寵物尋求協助] ${selectedPet.title}`;
                                  const text = `請幫忙分享！在${selectedPet.locationName}走失的${selectedPet.title}，尋求各界協助，點擊連結查看詳情：${shareUrl}`;
                                  try {
                                    if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
                                      await navigator.share({ title, text, url: shareUrl });
                                      return;
                                    }
                                    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                                      await navigator.clipboard.writeText(shareUrl);
                                      showToast("✅ 已複製連結", "success");
                                      return;
                                    }
                                    const body = document.body;
                                    if (!body) {
                                      throw new Error("此瀏覽器無法複製連結，請手動複製網址。");
                                    }
                                    const el = document.createElement("textarea");
                                    el.value = shareUrl;
                                    el.setAttribute("readonly", "true");
                                    el.style.position = "fixed";
                                    el.style.left = "-9999px";
                                    body.appendChild(el);
                                    el.select();
                                    document.execCommand("copy");
                                    body.removeChild(el);
                                    showToast("✅ 已複製連結", "success");
                                  } catch (err) {
                                    const msg = err instanceof Error && err.message ? err.message : "分享失敗";
                                    showToast(msg);
                                  } finally {
                                    setIsSharing(false);
                                  }
                                }}
                              >
                                {isSharing ? "分享中..." : "🔗 分享"}
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={quickDownloadPoster}
                              disabled={isQuickDownloading}
                              className={[
                                "w-full rounded-2xl bg-orange-500 px-5 py-5 text-center text-base font-black text-white shadow-sm",
                                isQuickDownloading ? "opacity-60" : "hover:bg-orange-600",
                              ].join(" ")}
                            >
                              {isQuickDownloading ? "⏳ 生成中…" : "📊 生成尋寵街招 PDF"}
                            </button>

                            <button
                              type="button"
                              disabled={!canOpenSourceHref}
                              onClick={() => {
                                if (!canOpenSourceHref) return;
                                window.open(sourceHref, "_blank", "noopener,noreferrer");
                              }}
                              className={[
                                "w-full rounded-2xl border px-4 py-4 text-center text-sm font-black shadow-sm",
                                canOpenSourceHref
                                  ? "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                                  : "border-slate-200 bg-slate-50 text-slate-400",
                              ].join(" ")}
                            >
                              🧾 主 post / 原貼文連結
                            </button>
                          </div>
                        </div>

                        <div>
                          {selectedPet.photoUrl ? (
                            <div
                              className="relative rounded-2xl bg-slate-100 shadow-sm ring-1 ring-black/5"
                              style={{ position: "relative" }}
                            >
                              <img
                                src={selectedPet.photoUrl}
                                alt={selectedPet.title}
                                className="aspect-[4/3] w-full object-cover md:aspect-square"
                                loading="lazy"
                              />
                              <div
                                style={{
                                  position: "absolute",
                                  right: "0px",
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  zIndex: 99999,
                                  backgroundColor: "white",
                                  color: "#0f172a",
                                  padding: "11px 18px",
                                  borderRadius: "6px 0 0 6px",
                                  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                                  fontWeight: 900,
                                  fontSize: "15px",
                                  letterSpacing: "0.2em",
                                  whiteSpace: "nowrap",
                                  borderLeft: "1px solid #e2e8f0",
                                  borderTop: "1px solid #e2e8f0",
                                  borderBottom: "1px solid #e2e8f0",
                                  pointerEvents: "none",
                                  userSelect: "none",
                                  display: "flex",
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    letterSpacing: "normal",
                                    marginRight: "6px",
                                    fontSize: "16px",
                                  }}
                                >
                                  🐾
                                </span>
                                日日寵 尋寵地圖
                              </div>
                            </div>
                          ) : (
                            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500 shadow-sm ring-1 ring-black/5 md:aspect-square">
                              暫無相片
                            </div>
                          )}
                        </div>

                        <div className="md:col-span-2">
                          <div className="mt-1 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black text-slate-900">實時目擊時間軸</div>
                              <button
                                type="button"
                                onClick={() => void openTimelineReport()}
                                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"
                              >
                                ➕ 報告最新目擊
                              </button>
                            </div>

                {timelineReportOpen ? (
                  <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                    <label className="block">
                      <div className="text-xs font-black text-slate-700">目擊時間</div>
                      <input
                        value={timelineReportTime}
                        onChange={(e) => setTimelineReportTime(e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        placeholder="2026年06月15日 16:30"
                      />
                    </label>

                    <label className="mt-3 block">
                      <div className="text-xs font-black text-slate-700">情報內容描述</div>
                      <textarea
                        value={timelineReportText}
                        onChange={(e) => setTimelineReportText(e.target.value)}
                        className="mt-2 min-h-[84px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        placeholder="例：在太安樓地下街看見一隻橙色貓貓往港鐵站方向跑去"
                      />
                    </label>

                    <div className="mt-3">
                      <div className="text-xs font-black text-slate-700">📸 上傳現場相片 (選填)</div>
                      <label
                        htmlFor="timeline-sighting-image"
                        className="mt-2 flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center"
                      >
                        <div>
                          <div className="text-sm font-black text-slate-900">
                            {timelineReportImageUrl ? "重新選擇現場相片" : "點擊上傳現場相片"}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            支援 JPG / PNG / WEBP，大小上限 5MB
                          </div>
                        </div>
                      </label>
                      <input
                        id="timeline-sighting-image"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => void handleTimelineImageFile(e.target.files?.[0])}
                      />

                      {timelineReportImageUrl ? (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                          <div className="relative overflow-hidden rounded-xl">
                            <img
                              src={timelineReportImageUrl}
                              alt="最新目擊現場相片預覽"
                              className="h-32 w-full object-cover"
                            />
                            <PhotoWatermarkOverlay />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <label
                              htmlFor="timeline-sighting-image"
                              className="cursor-pointer rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-900 ring-1 ring-slate-200"
                            >
                              重選圖片
                            </label>
                            <button
                              type="button"
                              onClick={() => setTimelineReportImageUrl("")}
                              className="rounded-xl bg-white px-3 py-2 text-xs font-black text-red-600 ring-1 ring-slate-200"
                            >
                              刪除圖片
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void submitTimelineReport()}
                        disabled={isSubmittingTimelineReport}
                        className={[
                          "rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white",
                          isSubmittingTimelineReport ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        {isSubmittingTimelineReport ? "⏳ 提交中…" : "📤 提交情報"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTimelineReportOpen(false);
                          setTimelineReportImageUrl("");
                        }}
                        className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-900"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 space-y-3">
                  {selectedPet.timeline.length === 0 ? (
                    <div className="text-sm font-semibold text-slate-600">暫無目擊紀錄更新</div>
                  ) : (
                    selectedPet.timeline.map((t, idx) => (
                      <div key={`${t.time}-${idx}`} className="relative pl-6">
                        <div className="absolute left-2 top-0 h-full border-l-2 border-slate-200" />
                        <div className="absolute left-[7px] top-1 h-3 w-3 rounded-full bg-slate-900" />
                        <div className="text-sm font-bold text-slate-900">
                          {formatTimelineTimeForDisplay(t.time)}{" "}
                          <span className="font-medium text-slate-700">{t.text}</span>
                        </div>
                        {t.imageUrl ? (
                          <button
                            type="button"
                            onClick={() => openTimelineLightbox(t.imageUrl)}
                            className="relative z-10 mt-2 inline-flex w-fit cursor-pointer overflow-hidden rounded-xl ring-1 ring-slate-200 transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-slate-400 pointer-events-auto"
                            aria-label="放大查看目擊現場相片"
                          >
                            <img
                              src={t.imageUrl}
                              alt="最新目擊現場相片"
                              className="pointer-events-none block h-28 w-auto max-w-xs object-cover"
                              loading="lazy"
                            />
                            <PhotoWatermarkOverlay />
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
        </div>
      </div>

      {reportModalOpen ? (
        <div className="fixed inset-0 z-[1300] bg-black/50 backdrop-blur-sm">
          <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-6">
            <div className="relative z-50 w-full max-w-2xl max-h-[90svh] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xl font-black text-slate-900">市民報料</div>
                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    免登入可先填表，表單末尾一鍵綁定會員並送審
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeReportModal}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900"
                >
                  關閉
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="text-sm font-bold text-slate-700">案件類型</div>
                  <select
                    value={reportForm.caseType}
                    onChange={(e) =>
                      (() => {
                        const nextCaseType =
                          e.target.value === "found_rescued"
                            ? "found_rescued"
                            : e.target.value === "spotted_unrescued"
                              ? "spotted_unrescued"
                              : "lost";
                        updateReportForm("caseType", nextCaseType);
                        updateReportForm("sourceType", syncIdentityWithCaseType(reportForm.sourceType, nextCaseType));
                      })()
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  >
                    <option value="lost">走失</option>
                    <option value="spotted_unrescued">發現（未救起）</option>
                    <option value="found_rescued">發現（救起）</option>
                  </select>
                </label>

                <label className="block">
                  <div className="text-sm font-bold text-slate-700">寵物大類</div>
                  <select
                    value={reportForm.petType}
                    onChange={(e) => {
                      const nextPetType =
                        e.target.value === "dog"
                          ? "dog"
                          : e.target.value === "bird"
                            ? "bird"
                            : e.target.value === "other"
                              ? "other"
                              : "cat";
                      setReportForm((prev) => ({
                        ...prev,
                        petType: nextPetType,
                        breed:
                          nextPetType === prev.petType
                            ? prev.breed
                            : nextPetType === "other"
                              ? "其他 / 不確定品種"
                              : "",
                      }));
                    }}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  >
                    <option value="cat">貓</option>
                    <option value="dog">狗</option>
                    <option value="bird">雀鳥</option>
                    <option value="other">其他</option>
                  </select>
                </label>

                <label className="block">
                  <div className="text-sm font-bold text-slate-700">詳細品種</div>
                  <select
                    value={reportForm.breed}
                    onChange={(e) => updateReportForm("breed", e.target.value)}
                    disabled={reportForm.petType !== "cat" && reportForm.petType !== "dog" && reportForm.petType !== "bird"}
                    className={[
                      "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900",
                      reportForm.petType !== "cat" && reportForm.petType !== "dog" && reportForm.petType !== "bird"
                        ? "cursor-not-allowed opacity-60"
                        : "",
                    ].join(" ")}
                  >
                    {reportForm.petType !== "cat" && reportForm.petType !== "dog" && reportForm.petType !== "bird" ? (
                      <option value="其他 / 不確定品種">其他 / 不確定品種</option>
                    ) : (
                      <option value="">
                        {isLoadingPetBreeds ? "載入品種中..." : "請選擇詳細品種"}
                      </option>
                    )}
                    {filteredPetBreedOptions.map((breed) => (
                      <option key={breed.id} value={breed.breed_name}>
                        {breed.breed_name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {reportForm.petType === "cat" || reportForm.petType === "dog" || reportForm.petType === "bird"
                      ? "如無法判斷，請選擇「其他 / 不確定品種」。"
                      : "其他類型會先以「其他 / 不確定品種」提交，後台可再補充。"}
                  </div>
                </label>

                <label className="block">
                  <div className="text-sm font-bold text-slate-700">寵物名字</div>
                  <input
                    value={reportForm.petName}
                    onChange={(e) => updateReportForm("petName", e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="豆豉 / 目擊小花貓"
                  />
                </label>

                <label className="block">
                  <div className="text-sm font-bold text-slate-700">聯絡電話</div>
                  <input
                    value={reportForm.phone}
                    onChange={(e) => updateReportForm("phone", e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="9123 4567"
                  />
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <input
                      type="checkbox"
                      id="formPrivacyToggle"
                      checked={reportForm.enablePrivacy}
                      onChange={(e) => updateReportForm("enablePrivacy", e.target.checked)}
                      className="h-4 w-4 rounded text-blue-600"
                    />
                    <label htmlFor="formPrivacyToggle" className="cursor-pointer text-sm font-medium text-blue-800">
                      🛡️ 啟用防騙隱私保護 (隱藏電話號碼，聯絡時跳出防騙倒數彈窗)
                    </label>
                  </div>
                </label>

                <label className="block">
                  <div className="text-sm font-bold text-slate-700">時間</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      type="date"
                      value={reportTimeParts.date}
                      onChange={(e) => {
                        const next = buildIsoFromLocalParts(e.target.value, reportTimeParts.hour, reportTimeParts.minute);
                        updateReportForm("lostTime", next);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    />
                    <select
                      value={reportTimeParts.hour}
                      onChange={(e) => {
                        const next = buildIsoFromLocalParts(reportTimeParts.date, e.target.value, reportTimeParts.minute);
                        updateReportForm("lostTime", next);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    >
                      {Array.from({ length: 24 }).map((_, i) => {
                        const v = pad2(i);
                        return (
                          <option key={v} value={v}>
                            {v} 時
                          </option>
                        );
                      })}
                    </select>
                    <select
                      value={reportTimeParts.minute}
                      onChange={(e) => {
                        const next = buildIsoFromLocalParts(reportTimeParts.date, reportTimeParts.hour, e.target.value);
                        updateReportForm("lostTime", next);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    >
                      {Array.from({ length: 60 }).map((_, i) => {
                        const v = pad2(i);
                        return (
                          <option key={v} value={v}>
                            {v} 分
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </label>
              </div>

              <label className="mt-4 block">
                <div className="text-sm font-bold text-slate-700">地點文字描述</div>
                <input
                  value={reportForm.location}
                  onChange={(e) => updateReportForm("location", e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="大角咀埃華街附近"
                />
              </label>

              <label className="mt-4 block">
                <div className="text-sm font-bold text-slate-700">毛孩特徵</div>
                <textarea
                  value={reportForm.features}
                  onChange={(e) => updateReportForm("features", e.target.value)}
                  className="mt-2 min-h-[100px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="左耳已剪、親人、有晶片。"
                />
              </label>

              <div className="mt-4">
                <div className="text-sm font-bold text-slate-700">上傳毛孩照片</div>
                <label
                  htmlFor="citizen-pet-image"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleCitizenImageFile(e.dataTransfer.files?.[0]);
                  }}
                  className="mt-2 flex min-h-[148px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center"
                >
                  {reportForm.imageUrl ? (
                    <div className="w-full">
                      <div className="relative overflow-hidden rounded-2xl shadow-md">
                        <img
                          src={reportForm.imageUrl}
                          alt="預覽"
                          className="mx-auto h-40 w-full object-cover"
                        />
                        <PhotoWatermarkOverlay />
                      </div>
                      <div className="mt-3 text-xs font-bold text-slate-600">
                        已選取圖片，可再次點擊或拖曳覆蓋
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-3xl">📸</div>
                      <div className="mt-2 text-sm font-black text-slate-900">
                        點擊或拖曳圖片到這裡上傳
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        支援 JPG / PNG / WEBP，大小上限 5MB
                      </div>
                    </>
                  )}
                </label>
                <input
                  id="citizen-pet-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void handleCitizenImageFile(e.target.files?.[0])}
                />
              </div>

              <label className="mt-4 block">
                <div className="text-sm font-bold text-slate-700">聯絡人身份 / 發佈方式</div>
                <select
                  value={reportForm.sourceType}
                  onChange={(e) =>
                    (() => {
                      const nextIdentity = normalizeContactIdentity(e.target.value, reportForm.caseType);
                      updateReportForm("sourceType", nextIdentity);
                      updateReportForm("caseType", getDefaultCaseTypeForIdentity(nextIdentity));
                    })()
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                >
                  {CONTACT_IDENTITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  {getCaseIdentityCategory(reportForm.sourceType) === "seeking"
                    ? "目前會歸類為：尋寵案件"
                    : getCaseIdentityCategory(reportForm.sourceType) === "rescued"
                      ? "目前會歸類為：已救起案件"
                      : "目前會歸類為：目擊案件"}
                </div>
              </label>

              {needsSourceLink(reportForm.sourceType) ? (
                <label className="mt-4 block">
                  <div className="text-sm font-bold text-slate-700">社交媒體原帖連結</div>
                  <input
                    value={reportForm.sourceLink}
                    onChange={(e) => updateReportForm("sourceLink", e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="https://www.facebook.com/... 或 https://www.threads.net/..."
                  />
                </label>
              ) : null}

              {!isLoggedIn ? (
                <label className="mt-4 block">
                  <div className="text-sm font-bold text-slate-700">傳送安全登入連結到電郵</div>
                  <input
                    value={reportForm.email}
                    onChange={(e) => updateReportForm("email", e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="傳送安全登入連結到電郵"
                  />
                  <span className="mt-1.5 block text-xs leading-relaxed text-gray-500">
                    * 為了保障您的帳戶安全，系統會向該電郵發送一條一次性的特殊確認連結。必須由您本人打開電郵收件箱並點擊連結才能成功登入，其他人絕對無法冒名登入。
                  </span>
                </label>
              ) : null}

              <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-sm font-black text-slate-900">座標與定位</div>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  {Number.isFinite(reportForm.latitude) && Number.isFinite(reportForm.longitude)
                    ? `已選座標：${reportForm.latitude?.toFixed(5)}, ${reportForm.longitude?.toFixed(5)}`
                    : reportForm.manualAddress.trim()
                      ? "目前未有座標，將以手動地址作後備提交"
                      : "尚未選擇座標"}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPickLocationMode(true);
                      setReportModalOpen(false);
                    }}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
                  >
                    🗺️ 地圖點擊選點
                  </button>
                  <button
                    type="button"
                    onClick={handleUseCurrentLocation}
                    className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-black text-white"
                  >
                    📍 獲取目前手機定位
                  </button>
                </div>
                <div className="mt-4 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                  <div className="text-sm font-bold text-slate-700">手動地址 / 地址搜尋</div>
                  <div className="relative mt-2">
                    <input
                      value={reportForm.manualAddress}
                      onChange={(e) => updateReportForm("manualAddress", e.target.value)}
                      onFocus={() => {
                        if (manualAddressSuggestions.length > 0) setManualAddressDropdownOpen(true);
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setManualAddressDropdownOpen(false), 120);
                      }}
                      onKeyDown={(e) => {
                        if (!manualAddressDropdownOpen || manualAddressSuggestions.length === 0) return;
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setManualAddressActiveIndex((prev) =>
                            prev < manualAddressSuggestions.length - 1 ? prev + 1 : prev,
                          );
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setManualAddressActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const idx = manualAddressActiveIndex >= 0 ? manualAddressActiveIndex : 0;
                          const picked = manualAddressSuggestions[idx];
                          if (picked) selectManualAddressSuggestion(picked);
                        }
                        if (e.key === "Escape") {
                          setManualAddressDropdownOpen(false);
                        }
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="找不到座標？請輸入具體地址（例如：尖沙咀海港城正門）"
                    />
                    {manualAddressDropdownOpen ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[9999] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
                        {manualAddressSuggestions.map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => selectManualAddressSuggestion(s)}
                            className={[
                              "w-full px-4 py-3 text-left",
                              idx === manualAddressActiveIndex
                                ? "bg-red-50"
                                : "bg-white hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <div className="text-sm font-black text-slate-900">{s.label}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleManualAddressSearch()}
                      disabled={isSearchingManualAddress}
                      className={[
                        "rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white",
                        isSearchingManualAddress ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      {isSearchingManualAddress ? "搜尋中…" : "搜尋 / 確認"}
                    </button>
                    <div className="flex items-center text-xs font-semibold leading-relaxed text-slate-500">
                      搜尋成功會自動帶入經緯度；找不到位置也會保留此地址文字，仍可提交。
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 border-t border-slate-200 pt-5">
                {isLoggedIn ? (
                  <button
                    type="button"
                    onClick={handleDirectCitizenSubmit}
                    disabled={isSubmittingReport}
                    className={[
                      "w-full rounded-2xl bg-red-600 px-4 py-4 text-base font-black text-white shadow-lg",
                      isSubmittingReport ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    {isSubmittingReport ? "提交中…" : "確認提交報料"}
                  </button>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void persistPendingReportAndStartAuth("google")}
                      disabled={isSubmittingReport}
                      className={[
                        "rounded-2xl bg-emerald-500 px-4 py-4 text-sm font-black text-white shadow-lg",
                        isSubmittingReport ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      🟢 使用 Google 一鍵登入並發佈
                    </button>
                    <button
                      type="button"
                      onClick={() => void persistPendingReportAndStartAuth("magic")}
                      disabled={isSubmittingReport}
                      className={[
                        "rounded-2xl bg-slate-900 px-4 py-4 text-sm font-black text-white shadow-lg",
                        isSubmittingReport ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      ✉️ 傳送安全登入連結到電郵並發佈
                    </button>
                  </div>
                )}
                <div className="mt-3 text-xs font-semibold leading-relaxed text-slate-500">
                  所有市民報料都會先以 pending 進後台審批，核實後才會於 🚨 SOS尋寵地圖 公開上線。
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {authModalOpen ? (
        <div className="fixed inset-0 z-[1450] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
          <div className="max-h-[90svh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-black text-slate-900">登入 / 註冊會員</div>
                <div className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">
                  用 Google 一鍵登入，即可綁定通知裝置、同步報料身份與會員資料。
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-900"
              >
                關閉
              </button>
            </div>

            <div className="mt-5 rounded-2xl bg-red-50 p-4 ring-1 ring-red-100">
              <div className="text-sm font-black text-red-700">無縫升級機制</div>
              <div className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
                若你已先以訪客身份開啟推播通知，登入成功後系統會自動把目前這台裝置的通知資格綁定到你的會員帳號。
              </div>
            </div>

            <button
              type="button"
              onClick={() => void startGoogleAuth()}
              disabled={isStartingGoogleAuth}
              className={[
                "mt-5 w-full rounded-2xl bg-red-600 px-4 py-4 text-base font-black text-white shadow-lg",
                isStartingGoogleAuth ? "opacity-70" : "",
              ].join(" ")}
            >
              {isStartingGoogleAuth ? "啟動中…" : "🔑 使用 Google 帳號一鍵登入 / 註冊"}
            </button>
          </div>
        </div>
      ) : null}

      {notificationHelpModalOpen ? (
        <div className="fixed inset-0 z-[1460] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-black/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-black text-slate-900">開通通知，黃金24小時全速搜救！</div>
                <div className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">
                  跟住以下 3 步做，之後你的關注分區一有突發案件，就能第一時間收到提醒。
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNotificationHelpModalOpen(false)}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-900"
              >
                關閉
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-lg">
                    🔒
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">步驟 1</div>
                    <div className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">
                      看向瀏覽器最上方網址列左側，點擊 [鎖頭 🔒] 或 [調整] 圖標。
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-lg">
                    🔔
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">步驟 2</div>
                    <div className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">
                      找到「通知」選項，將它切換為 [允許]。
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-400 text-lg">
                    🔄
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">步驟 3</div>
                    <div className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">
                      重新整理網頁，即可開始接收關注分區的突發案件！
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setNotificationHelpModalOpen(false)}
              className="mt-5 w-full rounded-2xl bg-red-600 px-4 py-4 text-base font-black text-white shadow-lg"
            >
              知道了，我去開啟
            </button>
          </div>
        </div>
      ) : null}

      {showDesktopPermissionHint ? (
        <div className="pointer-events-none fixed left-3 top-2 z-[1470] hidden lg:block">
          <div className="mb-1 ml-8 text-xs font-black text-amber-300 animate-bounce">▲</div>
          <div className="rounded-2xl bg-yellow-300 px-4 py-3 text-sm font-black text-slate-900 shadow-2xl ring-1 ring-amber-400">
            點擊上方鎖頭開啟 👆
          </div>
        </div>
      ) : null}

      {isTimelineLightboxOpen && timelineLightboxImageUrl ? (
        <TimelineImageLightbox
          src={timelineLightboxImageUrl}
          onClose={closeTimelineLightbox}
        />
      ) : null}

      {showScamWarningModal ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999999,
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-red-100 sm:p-7">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-3xl">
                ⚠️
              </div>
              <div className="flex-1">
                <div className="text-xl font-black text-slate-900">聯絡主人前，請先閱讀防騙提示</div>
                <div className="mt-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-100">
                  <p className="text-base leading-relaxed text-gray-700">
                    <span className="mb-2 block text-lg font-bold text-red-600">⚠️ 警惕騙徒：</span>
                    無論任何情況，在
                    <span className="bg-yellow-50 px-1 font-bold text-red-600 underline">親眼見到寵物</span>
                    前，
                    <span className="bg-yellow-50 px-1 font-bold text-red-600">切勿轉賬</span>
                    任何費用。
                    <br className="my-2" />
                    <span className="font-bold text-red-600">不要</span>
                    因對方的藉口（如
                    <span className="font-bold text-gray-900">車資</span>、
                    <span className="font-bold text-gray-900">急需醫藥費</span>、
                    <span className="font-bold text-gray-900">報酬</span>
                    等）而
                    <span className="font-bold text-red-600">先轉賬任何錢財</span>。
                  </p>
                </div>
                <div className="mt-3 text-sm font-semibold leading-relaxed text-slate-600">
                  請先冷靜閱讀以上提示，倒數結束後再決定是否正式聯絡。
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeScamWarningModal}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-black text-slate-700 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmScamWarningContact}
                disabled={warningCountdown > 0}
                className={[
                  "rounded-2xl px-5 py-3 text-base font-black text-white shadow-lg transition",
                  warningCountdown > 0 ? "cursor-not-allowed bg-slate-400" : "bg-red-600 hover:bg-red-700",
                ].join(" ")}
              >
                {warningCountdown > 0 ? `請閱讀提示 (${warningCountdown}s)` : "已了解風險，繼續聯絡"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
