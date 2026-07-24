"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DivIcon } from "leaflet";

import AppToast from "@/components/AppToast";
import {
  CONTACT_IDENTITY_OPTIONS,
  getCaseIdentityCategoryLabel,
  getDefaultCaseTypeForIdentity,
  getContactIdentityLabel,
  needsSourceLink,
  normalizeContactIdentity,
  syncIdentityWithCaseType,
} from "@/lib/pets/contact-identity";
import { getDisplayAddress, isInvalidLocationText } from "@/lib/pets/display";
import { DISTRICTS_HK, reverseGeocodeDistrict } from "@/lib/pets/district";
import { geocodeAddressWithNominatim, geocodeHongKongAddress } from "@/lib/pets/geocoding";
import { uploadPetImage, validatePetImageFile } from "@/lib/pets/image-upload";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { PetInsert, PetRow, PetStatus, PetTimelineItem } from "@/lib/pets/db";

type TabKey = PetStatus;
type AdminMapFocus = {
  center: [number, number];
  zoom?: number;
};
type BoardItems = Record<TabKey, PetRow[]>;
type WhatsAppBridgeStatus = {
  enabled: boolean;
  state: string;
  qrDataUrl: string | null;
  accountLabel: string | null;
  lastError: string | null;
  notice: string | null;
  updatedAt: string | null;
};
type WhatsAppBridgeQrResponse = {
  qr?: string;
  error?: string;
};
type SystemSettingsForm = {
  admin_whatsapp_number: string;
  template_admin_notification: string;
  template_citizen_approved: string;
};

type BreedPetType = "cat" | "dog" | "bird";
type PetBreedAdminRow = {
  id: string;
  pet_type: BreedPetType;
  breed_name: string;
  sort_order: number;
};

type GuideCategoryAdminRow = {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
};

type GuideSubcategoryAdminRow = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
};

type GuidePlaceAdminRow = {
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
};

type StagedPlaceStatus = "pending" | "approved" | "rejected";
type StagedPlaceAdminRow = GuidePlaceAdminRow & {
  status: StagedPlaceStatus;
  source: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type GuidePlaceFormState = {
  category_id: string;
  subcategory_ids: string[];
  name: string;
  district: string;
  address: string;
  opening_hours: string;
  latitude: string;
  longitude: string;
  image_url: string;
  image_urls: string[];
  facility_tag_ids: string[];
  has_grass: boolean;
  has_wash_station: boolean;
  has_fencing: boolean;
  has_parking: boolean;
};

type VetScraperRunResult = {
  imported: number;
  validPlaces: number;
  candidates: number;
  district: string;
  keyword: string;
  query?: string;
  mode?: string;
  queryAttempts?: Array<{ query: string; candidates: number }>;
  failures: Array<Record<string, unknown>>;
  languageWarnings: Array<Record<string, unknown>>;
};

type FacilityTagAdminRow = {
  id: string;
  name: string;
  icon: string;
  legacy_key: string | null;
  match_keywords: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type GuidePlaceFacilityTagOption = Pick<FacilityTagAdminRow, "id" | "name" | "icon" | "legacy_key" | "is_active" | "sort_order">;

type DashboardViewTab =
  | "board"
  | "sos-breeds"
  | "guide-categories"
  | "facility-tags"
  | "staged-places"
  | "scraper-jobs"
  | "guide-places"
  | "system";

const DEFAULT_SYSTEM_SETTINGS: SystemSettingsForm = {
  admin_whatsapp_number: "你的管理員預設電話",
  template_admin_notification:
    "【日日寵】有新報料喇！毛孩：${pet_name}，特徵：${description}。請即入後台審批：${admin_url}",
  template_citizen_approved:
    "【日日寵】好消息！您提交的報料（${pet_name}）已通過審核並正式上架！感謝您的熱心幫忙。查看連結：${pet_url}",
};

const GUIDE_CATEGORY_ICON_OPTIONS = ["🩺", "🌳", "🛒", "✂️", "🌈", "🎓", "🍴", "📖", "🐾"];
const HONG_KONG_18_DISTRICTS = [
  "中西區",
  "灣仔區",
  "東區",
  "南區",
  "油尖旺區",
  "深水埗區",
  "九龍城區",
  "黃大仙區",
  "觀塘區",
  "荃灣區",
  "葵青區",
  "沙田區",
  "西貢區",
  "大埔區",
  "北區",
  "元朗區",
  "屯門區",
  "離島區",
] as const;
const VET_SCRAPER_KEYWORD_OPTIONS = [
  { value: "veterinary clinic", label: "veterinary clinic", hint: "獸醫診所" },
  { value: "animal hospital", label: "animal hospital", hint: "動物醫院" },
  { value: "24 hour emergency vet", label: "24 hour emergency vet", hint: "24小時急診" },
  { value: "cat clinic", label: "cat clinic", hint: "貓科專科" },
  { value: "__custom__", label: "自訂", hint: "Custom" },
] as const;
const GUIDE_PLACE_DISTRICTS = DISTRICTS_HK.filter((district) => district !== "全港");
const PUBLIC_WHATSAPP_BRIDGE_URL = (() => {
  const raw = String(
    process.env.NEXT_PUBLIC_WHATSAPP_BRIDGE_URL || process.env.NEXT_PUBLIC_WHATSAPP_SERVICE_URL || "",
  ).trim();
  return raw.replace(/\/+$/, "");
})();

const createEmptyGuidePlaceForm = (): GuidePlaceFormState => ({
  category_id: "",
  subcategory_ids: [],
  name: "",
  district: GUIDE_PLACE_DISTRICTS[0] || "西貢區",
  address: "",
  opening_hours: "",
  latitude: "",
  longitude: "",
  image_url: "",
  image_urls: [],
  facility_tag_ids: [],
  has_grass: false,
  has_wash_station: false,
  has_fencing: false,
  has_parking: false,
});

const normalizeGuideSubcategoryIds = (value: unknown): string[] => {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return Array.from(new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean)));
};

const resolveGuideSubcategoryIds = (selectedIds: string[], options: GuideSubcategoryAdminRow[]) => {
  const optionIdSet = new Set(options.map((row) => row.id));
  const filtered = normalizeGuideSubcategoryIds(selectedIds).filter((id) => optionIdSet.has(id));
  if (filtered.length > 0) return filtered;
  return options[0]?.id ? [options[0].id] : [];
};

const normalizeTimelineItems = (input: unknown): PetTimelineItem[] => {
  if (!Array.isArray(input)) return [];
  return (input as any[])
    .map((t) => ({
      time: typeof t?.time === "string" ? t.time : "",
      text: typeof t?.text === "string" ? t.text : "",
    }))
    .filter((t) => t.time.trim() && t.text.trim());
};

function normalizeImageUrlList(value: unknown) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,，、|]/g) : [];
  return items
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function getPrimaryImageUrl(image_urls: string[]) {
  return image_urls.find(Boolean) || "";
}

const AdminMiniMap = dynamic(() => import("@/components/AdminMiniMap"), {
  ssr: false,
});

function parseOptionalCoordinate(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCsvList(value: string) {
  return value
    .split(/[,，、|/]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLeafletCoordinate(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function formatHongKongDateTime(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function buildAdminEditIcon(Lmod: typeof import("leaflet")): DivIcon {
  return Lmod.divIcon({
    className: "dp-div-icon",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;background:#dc2626;border:3px solid #ffffff;box-shadow:0 10px 24px rgba(220,38,38,0.35);color:#ffffff;font-size:16px;line-height:1;">
        📍
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

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
    event: "NEW_CASE" | "NEW_SIGHTING",
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

  const [tab, setTab] = useState<TabKey>("approved");
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardViewTab>("board");
  const [showManualEntryForm, setShowManualEntryForm] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [boardItems, setBoardItems] = useState<BoardItems>({
    approved: [],
    pending: [],
    resolved: [],
  });
  const [form, setForm] = useState<PetInsert>({
    user_id: null,
    pet_name: "",
    pet_type: "cat",
    breed: null,
    location: "",
    manual_address: null,
    district: null,
    lost_time: new Date().toISOString(),
    features: "",
    phone: "",
    enable_privacy: true,
    image_url: "",
    source_url: `daydaypet://admin/${Date.now()}`,
    source_type: "owner",
    source_link: null,
    case_type: "lost",
    status: "approved",
    latitude: 22.3193,
    longitude: 114.1694,
  });
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [editingPet, setEditingPet] = useState<PetRow | null>(null);
  const [editingTimeline, setEditingTimeline] = useState<PetTimelineItem[]>([]);
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingUploadingImage, setEditingUploadingImage] = useState(false);
  const [editingSearchingAddress, setEditingSearchingAddress] = useState(false);
  const [editingAddressSearchQuery, setEditingAddressSearchQuery] = useState("");
  const [editingMapFocus, setEditingMapFocus] = useState<AdminMapFocus | null>(null);
  const [leafletModule, setLeafletModule] = useState<typeof import("leaflet") | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"error" | "success">("error");
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppBridgeStatus | null>(null);
  const [petBreeds, setPetBreeds] = useState<PetBreedAdminRow[]>([]);
  const [petBreedsFilter, setPetBreedsFilter] = useState<"all" | BreedPetType>("all");
  const [loadingPetBreeds, setLoadingPetBreeds] = useState(false);
  const [addingPetBreed, setAddingPetBreed] = useState(false);
  const [deletingPetBreedId, setDeletingPetBreedId] = useState("");
  const [editingPetBreedId, setEditingPetBreedId] = useState("");
  const [savingPetBreedId, setSavingPetBreedId] = useState("");
  const [petBreedForm, setPetBreedForm] = useState<{ pet_type: BreedPetType; breed_name: string; sort_order: string }>(
    {
      pet_type: "dog",
      breed_name: "",
      sort_order: "100",
    },
  );
  const [petBreedEditForm, setPetBreedEditForm] = useState<{ breed_name: string }>({
    breed_name: "",
  });
  const [guideCategories, setGuideCategories] = useState<GuideCategoryAdminRow[]>([]);
  const [guideSubcategories, setGuideSubcategories] = useState<GuideSubcategoryAdminRow[]>([]);
  const [loadingGuideCategories, setLoadingGuideCategories] = useState(false);
  const [loadingGuideSubcategories, setLoadingGuideSubcategories] = useState(false);
  const [addingGuideCategory, setAddingGuideCategory] = useState(false);
  const [addingGuideSubcategory, setAddingGuideSubcategory] = useState(false);
  const [deletingGuideCategoryId, setDeletingGuideCategoryId] = useState("");
  const [deletingGuideSubcategoryId, setDeletingGuideSubcategoryId] = useState("");
  const [editingGuideCategoryId, setEditingGuideCategoryId] = useState("");
  const [editingGuideSubcategoryId, setEditingGuideSubcategoryId] = useState("");
  const [savingGuideCategoryId, setSavingGuideCategoryId] = useState("");
  const [savingGuideSubcategoryId, setSavingGuideSubcategoryId] = useState("");
  const [guideCategoryForm, setGuideCategoryForm] = useState<{ name: string; icon: string; sort_order: string }>({
    name: "",
    icon: "🩺",
    sort_order: "100",
  });
  const [guideSubcategoryForm, setGuideSubcategoryForm] = useState<{ category_id: string; name: string; sort_order: string }>({
    category_id: "",
    name: "",
    sort_order: "100",
  });
  const [guideCategoryEditForm, setGuideCategoryEditForm] = useState<{ name: string; icon: string }>({
    name: "",
    icon: "🩺",
  });
  const [guideSubcategoryEditForm, setGuideSubcategoryEditForm] = useState<{ category_id: string; name: string }>({
    category_id: "",
    name: "",
  });
  const [facilityTags, setFacilityTags] = useState<FacilityTagAdminRow[]>([]);
  const [loadingFacilityTags, setLoadingFacilityTags] = useState(false);
  const [addingFacilityTag, setAddingFacilityTag] = useState(false);
  const [deletingFacilityTagId, setDeletingFacilityTagId] = useState("");
  const [editingFacilityTagId, setEditingFacilityTagId] = useState("");
  const [savingFacilityTagId, setSavingFacilityTagId] = useState("");
  const [facilityTagForm, setFacilityTagForm] = useState<{ name: string; icon: string; sort_order: string; match_keywords: string }>({
    name: "",
    icon: "🏷️",
    sort_order: "100",
    match_keywords: "",
  });
  const [facilityTagEditForm, setFacilityTagEditForm] = useState<{
    name: string;
    icon: string;
    sort_order: string;
    match_keywords: string;
    is_active: boolean;
  }>({
    name: "",
    icon: "🏷️",
    sort_order: "100",
    match_keywords: "",
    is_active: true,
  });
  const [guidePlaces, setGuidePlaces] = useState<GuidePlaceAdminRow[]>([]);
  const [loadingGuidePlaces, setLoadingGuidePlaces] = useState(false);
  const [guidePlaceSearchInput, setGuidePlaceSearchInput] = useState("");
  const [guidePlaceSearch, setGuidePlaceSearch] = useState("");
  const [guidePlacePage, setGuidePlacePage] = useState(1);
  const [guidePlaceTotal, setGuidePlaceTotal] = useState(0);
  const [stagedPlaces, setStagedPlaces] = useState<StagedPlaceAdminRow[]>([]);
  const [loadingStagedPlaces, setLoadingStagedPlaces] = useState(false);
  const [stagedPlaceSearchInput, setStagedPlaceSearchInput] = useState("");
  const [stagedPlaceSearch, setStagedPlaceSearch] = useState("");
  const [stagedPlacePage, setStagedPlacePage] = useState(1);
  const [stagedPlaceTotal, setStagedPlaceTotal] = useState(0);
  const [approvingStagedPlaceId, setApprovingStagedPlaceId] = useState("");
  const [rejectingStagedPlaceId, setRejectingStagedPlaceId] = useState("");
  const [editingStagedPlaceId, setEditingStagedPlaceId] = useState("");
  const [savingStagedPlaceId, setSavingStagedPlaceId] = useState("");
  const [addingGuidePlace, setAddingGuidePlace] = useState(false);
  const [deletingGuidePlaceId, setDeletingGuidePlaceId] = useState("");
  const [editingGuidePlaceId, setEditingGuidePlaceId] = useState("");
  const [savingGuidePlaceId, setSavingGuidePlaceId] = useState("");
  const [uploadingGuidePlaceImage, setUploadingGuidePlaceImage] = useState(false);
  const [uploadingGuidePlaceEditImage, setUploadingGuidePlaceEditImage] = useState(false);
  const [uploadingStagedPlaceImage, setUploadingStagedPlaceImage] = useState(false);
  const [guidePlaceCreateModalOpen, setGuidePlaceCreateModalOpen] = useState(false);
  const [guidePlaceCreateModalNonce, setGuidePlaceCreateModalNonce] = useState(0);
  const [locatingGuidePlaceForm, setLocatingGuidePlaceForm] = useState(false);
  const [locatingGuidePlaceEditForm, setLocatingGuidePlaceEditForm] = useState(false);
  const [locatingStagedPlaceEditForm, setLocatingStagedPlaceEditForm] = useState(false);
  const [searchingGuidePlaceFormAddress, setSearchingGuidePlaceFormAddress] = useState(false);
  const [searchingGuidePlaceEditFormAddress, setSearchingGuidePlaceEditFormAddress] = useState(false);
  const [searchingStagedPlaceEditFormAddress, setSearchingStagedPlaceEditFormAddress] = useState(false);
  const [guidePlaceFormAddressSearchQuery, setGuidePlaceFormAddressSearchQuery] = useState("");
  const [guidePlaceEditFormAddressSearchQuery, setGuidePlaceEditFormAddressSearchQuery] = useState("");
  const [stagedPlaceEditFormAddressSearchQuery, setStagedPlaceEditFormAddressSearchQuery] = useState("");
  const [guidePlaceFormMapFocus, setGuidePlaceFormMapFocus] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [guidePlaceEditFormMapFocus, setGuidePlaceEditFormMapFocus] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [stagedPlaceEditFormMapFocus, setStagedPlaceEditFormMapFocus] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [importingGuideParks, setImportingGuideParks] = useState(false);
  const [runningVetScraper, setRunningVetScraper] = useState(false);
  const [vetScraperForm, setVetScraperForm] = useState({
    district: "灣仔區",
    keyword: "veterinary clinic",
    customKeyword: "",
  });
  const [vetScraperResult, setVetScraperResult] = useState<VetScraperRunResult | null>(null);
  const [selectedGuidePlaceIds, setSelectedGuidePlaceIds] = useState<string[]>([]);
  const [bulkDeletingGuidePlaces, setBulkDeletingGuidePlaces] = useState(false);
  const [guidePlaceForm, setGuidePlaceForm] = useState<GuidePlaceFormState>(createEmptyGuidePlaceForm());
  const [guidePlaceEditForm, setGuidePlaceEditForm] = useState<GuidePlaceFormState>(createEmptyGuidePlaceForm());
  const [guidePlaceFacilityTagQuickAddForm, setGuidePlaceFacilityTagQuickAddForm] = useState<{
    name: string;
    icon: string;
    sort_order: string;
    match_keywords: string;
  }>({ name: "", icon: "🏷️", sort_order: "100", match_keywords: "" });
  const [addingGuidePlaceFacilityTagQuickAdd, setAddingGuidePlaceFacilityTagQuickAdd] = useState(false);
  const [stagedPlaceEditForm, setStagedPlaceEditForm] = useState<GuidePlaceFormState>(createEmptyGuidePlaceForm());
  const [stagedPlaceVetMetaForm, setStagedPlaceVetMetaForm] = useState<{
    is_24h_emergency: boolean;
    specialist_services: string;
    booking_url: string;
    pet_types_supported: string;
  }>({
    is_24h_emergency: false,
    specialist_services: "",
    booking_url: "",
    pet_types_supported: "",
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettingsForm>(DEFAULT_SYSTEM_SETTINGS);
  const [loadingSystemSettings, setLoadingSystemSettings] = useState(false);
  const [savingSystemSettings, setSavingSystemSettings] = useState(false);
  const formTimeParts = useMemo(() => {
    return parseIsoToLocalParts(form.lost_time) ?? parseIsoToLocalParts(new Date().toISOString())!;
  }, [form.lost_time]);

  const editingTimeParts = useMemo(() => {
    if (!editingPet) return null;
    return parseIsoToLocalParts(editingPet.lost_time) ?? parseIsoToLocalParts(new Date().toISOString())!;
  }, [editingPet?.lost_time]);

  const safeEditingTimeParts = editingTimeParts ?? { date: "", hour: "00", minute: "00" };
  const showToast = (message: string, tone: "error" | "success" = "error") => {
    setToastMessage(message);
    setToastTone(tone);
    window.clearTimeout((showToast as typeof showToast & { timer?: number }).timer);
    (showToast as typeof showToast & { timer?: number }).timer = window.setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const items = boardItems[tab];

  const GUIDE_PLACES_PAGE_SIZE = 20;
  const STAGED_PLACES_PAGE_SIZE = 20;

  const fetchListByStatus = async (status: TabKey) => {
    const { data, error } = await supabase
      .from("pets")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as PetRow[];
  };

  const loadList = async (nextTab = tab) => {
    setLoadingList(true);
    try {
      const data = await fetchListByStatus(nextTab);
      setBoardItems((prev) => ({ ...prev, [nextTab]: data }));
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取資料失敗";
      showToast(msg);
    } finally {
      setLoadingList(false);
    }
  };

  const refreshAllBoards = async (nextActiveTab: TabKey = tab) => {
    setLoadingList(true);
    try {
      const [approved, pending, resolved] = await Promise.all([
        fetchListByStatus("approved"),
        fetchListByStatus("pending"),
        fetchListByStatus("resolved"),
      ]);
      setBoardItems({ approved, pending, resolved });
      setTab(nextActiveTab);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "刷新資料失敗";
      showToast(msg);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void refreshAllBoards("approved");
  }, []);

  useEffect(() => {
    let active = true;
    const loadWhatsappStatus = async () => {
      try {
        if (!PUBLIC_WHATSAPP_BRIDGE_URL) {
          console.log("[AdminDashboard][WhatsApp] 未讀取到 NEXT_PUBLIC_WHATSAPP_BRIDGE_URL");
          throw new Error("未設定 NEXT_PUBLIC_WHATSAPP_BRIDGE_URL，前端無法直接連線 Railway WhatsApp Bridge");
        }

        const statusUrl = `${PUBLIC_WHATSAPP_BRIDGE_URL}/api/status`;
        console.log("[AdminDashboard][WhatsApp] 準備發出請求");
        console.log("[AdminDashboard][WhatsApp] 讀取到的 URL：", PUBLIC_WHATSAPP_BRIDGE_URL);
        console.log("[AdminDashboard][WhatsApp] 狀態請求 URL：", statusUrl);

        const res = await fetch(statusUrl, { method: "GET", cache: "no-store" });
        const data = (await res.json()) as WhatsAppBridgeStatus & { error?: string };
        console.log("[AdminDashboard][WhatsApp] 狀態請求已發出，HTTP：", res.status, data);
        if (!res.ok) throw new Error(data.error || "讀取 WhatsApp 狀態失敗");

        if (!data.qrDataUrl && data.state === "qr_ready") {
          const qrUrl = `${PUBLIC_WHATSAPP_BRIDGE_URL}/api/qr`;
          console.log("[AdminDashboard][WhatsApp] 狀態未附 qrDataUrl，改為請求：", qrUrl);
          const qrRes = await fetch(qrUrl, { method: "GET", cache: "no-store" });
          const qrJson = (await qrRes.json()) as WhatsAppBridgeQrResponse;
          console.log("[AdminDashboard][WhatsApp] QR 請求結果：", qrRes.status, qrJson);
          if (qrRes.ok && typeof qrJson.qr === "string" && qrJson.qr.trim()) {
            data.qrDataUrl = await QRCode.toDataURL(qrJson.qr, { margin: 1, width: 320 });
          }
        }

        if (active) setWhatsappStatus(data);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "讀取 WhatsApp 狀態失敗";
        console.log("[AdminDashboard][WhatsApp] 請求失敗：", message);
        setWhatsappStatus({
          enabled: false,
          state: "error",
          qrDataUrl: null,
          accountLabel: null,
          lastError: message,
          notice: null,
          updatedAt: new Date().toISOString(),
        });
      }
    };
    void loadWhatsappStatus();
    const timer = window.setInterval(() => {
      void loadWhatsappStatus();
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSystemSettings = async () => {
      setLoadingSystemSettings(true);
      try {
        const res = await fetch("/api/admin/system-settings", { method: "GET", cache: "no-store" });
        const data = (await res.json()) as {
          error?: string;
          settings?: Record<keyof SystemSettingsForm, { value: string }>;
        };
        if (!res.ok) throw new Error(data.error || "讀取系統設定失敗");
        if (!active || !data.settings) return;
        setSystemSettings({
          admin_whatsapp_number:
            data.settings.admin_whatsapp_number?.value ?? DEFAULT_SYSTEM_SETTINGS.admin_whatsapp_number,
          template_admin_notification:
            data.settings.template_admin_notification?.value ??
            DEFAULT_SYSTEM_SETTINGS.template_admin_notification,
          template_citizen_approved:
            data.settings.template_citizen_approved?.value ??
            DEFAULT_SYSTEM_SETTINGS.template_citizen_approved,
        });
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "讀取系統設定失敗";
        showToast(message);
      } finally {
        if (active) setLoadingSystemSettings(false);
      }
    };
    void loadSystemSettings();
    return () => {
      active = false;
    };
  }, []);

  const loadPetBreeds = async () => {
    setLoadingPetBreeds(true);
    try {
      const res = await fetch(`/api/admin/pet-breeds`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { items?: PetBreedAdminRow[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "讀取品種資料失敗");
      setPetBreeds(Array.isArray(json?.items) ? json!.items! : []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取品種資料失敗";
      showToast(msg);
      setPetBreeds([]);
    } finally {
      setLoadingPetBreeds(false);
    }
  };

  useEffect(() => {
    void loadPetBreeds();
  }, []);

  const filteredPetBreeds = useMemo(() => {
    if (petBreedsFilter === "all") return petBreeds;
    return petBreeds.filter((row) => row.pet_type === petBreedsFilter);
  }, [petBreeds, petBreedsFilter]);

  const createPetBreed = async () => {
    if (addingPetBreed) return;
    const pet_type = petBreedForm.pet_type;
    const breed_name = petBreedForm.breed_name.trim();
    const sort_order = Number.isFinite(Number(petBreedForm.sort_order)) ? Number(petBreedForm.sort_order) : 100;
    if (!breed_name) {
      showToast("請輸入品種名稱。");
      return;
    }
    setAddingPetBreed(true);
    try {
      const res = await fetch("/api/admin/pet-breeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pet_type, breed_name, sort_order }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: PetBreedAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "新增品種失敗");
      setPetBreedForm((prev) => ({ ...prev, breed_name: "" }));
      await loadPetBreeds();
      showToast("✅ 已新增品種", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "新增品種失敗";
      showToast(msg);
    } finally {
      setAddingPetBreed(false);
    }
  };

  const deletePetBreed = async (row: PetBreedAdminRow) => {
    if (deletingPetBreedId) return;
    const ok = window.confirm(`確定要刪除品種「${row.breed_name}」嗎？此操作不可逆。`);
    if (!ok) return;
    setDeletingPetBreedId(row.id);
    try {
      const res = await fetch(`/api/admin/pet-breeds?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "刪除品種失敗");
      await loadPetBreeds();
      showToast("🗑️ 已刪除品種", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "刪除品種失敗";
      showToast(msg);
    } finally {
      setDeletingPetBreedId("");
    }
  };

  const startEditPetBreed = (row: PetBreedAdminRow) => {
    setEditingPetBreedId(row.id);
    setPetBreedEditForm({ breed_name: row.breed_name });
  };

  const cancelEditPetBreed = () => {
    setEditingPetBreedId("");
    setPetBreedEditForm({ breed_name: "" });
  };

  const savePetBreedEdit = async (row: PetBreedAdminRow) => {
    if (savingPetBreedId) return;
    const breed_name = petBreedEditForm.breed_name.trim();
    if (!breed_name) {
      showToast("請輸入品種名稱。");
      return;
    }
    setSavingPetBreedId(row.id);
    try {
      const res = await fetch("/api/admin/pet-breeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          breed_name,
          pet_type: row.pet_type,
          sort_order: row.sort_order,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: PetBreedAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "更新品種失敗");
      await loadPetBreeds();
      cancelEditPetBreed();
      showToast("✅ 已更新品種名稱", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新品種失敗";
      showToast(msg);
    } finally {
      setSavingPetBreedId("");
    }
  };

  const loadGuideCategories = async () => {
    setLoadingGuideCategories(true);
    try {
      const res = await fetch("/api/admin/guide-categories", { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { items?: GuideCategoryAdminRow[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "讀取指南大分類失敗");
      setGuideCategories(Array.isArray(json?.items) ? json.items : []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取指南大分類失敗";
      showToast(msg);
      setGuideCategories([]);
    } finally {
      setLoadingGuideCategories(false);
    }
  };

  const loadGuideSubcategories = async () => {
    setLoadingGuideSubcategories(true);
    try {
      const res = await fetch("/api/admin/guide-subcategories", { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { items?: GuideSubcategoryAdminRow[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "讀取指南子分類失敗");
      setGuideSubcategories(Array.isArray(json?.items) ? json.items : []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取指南子分類失敗";
      showToast(msg);
      setGuideSubcategories([]);
    } finally {
      setLoadingGuideSubcategories(false);
    }
  };

  const refreshGuideTaxonomy = async () => {
    await Promise.all([loadGuideCategories(), loadGuideSubcategories()]);
  };

  useEffect(() => {
    void refreshGuideTaxonomy();
  }, []);

  const loadFacilityTags = async () => {
    setLoadingFacilityTags(true);
    try {
      const res = await fetch("/api/admin/facility-tags", { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { items?: FacilityTagAdminRow[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "讀取設施標籤失敗");
      setFacilityTags(Array.isArray(json?.items) ? json.items : []);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取設施標籤失敗";
      showToast(msg);
      setFacilityTags([]);
    } finally {
      setLoadingFacilityTags(false);
    }
  };

  useEffect(() => {
    void loadFacilityTags();
  }, []);

  const createFacilityTag = async () => {
    if (addingFacilityTag) return;
    const name = facilityTagForm.name.trim();
    const icon = facilityTagForm.icon.trim();
    const sort_order = Number.isFinite(Number(facilityTagForm.sort_order)) ? Number(facilityTagForm.sort_order) : 100;
    const match_keywords = facilityTagForm.match_keywords;
    if (!name) {
      showToast("請輸入標籤名稱。");
      return;
    }
    setAddingFacilityTag(true);
    try {
      const res = await fetch("/api/admin/facility-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, sort_order, match_keywords, is_active: true }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: FacilityTagAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "新增設施標籤失敗");
      setFacilityTagForm((prev) => ({ ...prev, name: "" }));
      await loadFacilityTags();
      showToast("✅ 已新增設施標籤", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "新增設施標籤失敗";
      showToast(msg);
    } finally {
      setAddingFacilityTag(false);
    }
  };

  const startEditFacilityTag = (row: FacilityTagAdminRow) => {
    setEditingFacilityTagId(row.id);
    setFacilityTagEditForm({
      name: row.name,
      icon: row.icon || "🏷️",
      sort_order: String(row.sort_order),
      match_keywords: Array.isArray(row.match_keywords) ? row.match_keywords.join(",") : "",
      is_active: row.is_active !== false,
    });
  };

  const cancelEditFacilityTag = () => {
    setEditingFacilityTagId("");
    setFacilityTagEditForm({ name: "", icon: "🏷️", sort_order: "100", match_keywords: "", is_active: true });
  };

  const saveFacilityTagEdit = async (row: FacilityTagAdminRow) => {
    if (savingFacilityTagId) return;
    const name = facilityTagEditForm.name.trim();
    const icon = facilityTagEditForm.icon.trim();
    const sort_order = Number.isFinite(Number(facilityTagEditForm.sort_order)) ? Number(facilityTagEditForm.sort_order) : 100;
    const match_keywords = facilityTagEditForm.match_keywords;
    if (!name) {
      showToast("請輸入標籤名稱。");
      return;
    }
    setSavingFacilityTagId(row.id);
    try {
      const res = await fetch("/api/admin/facility-tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          name,
          icon,
          sort_order,
          match_keywords,
          is_active: facilityTagEditForm.is_active,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: FacilityTagAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "更新設施標籤失敗");
      await loadFacilityTags();
      cancelEditFacilityTag();
      showToast("✅ 已更新設施標籤", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新設施標籤失敗";
      showToast(msg);
    } finally {
      setSavingFacilityTagId("");
    }
  };

  const hideFacilityTag = async (row: FacilityTagAdminRow) => {
    if (deletingFacilityTagId) return;
    const ok = window.confirm(`確定要隱藏標籤「${row.icon || "🏷️"} ${row.name}」嗎？`);
    if (!ok) return;
    setDeletingFacilityTagId(row.id);
    try {
      const res = await fetch(`/api/admin/facility-tags?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: FacilityTagAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "隱藏設施標籤失敗");
      await loadFacilityTags();
      showToast("✅ 已隱藏設施標籤", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "隱藏設施標籤失敗";
      showToast(msg);
    } finally {
      setDeletingFacilityTagId("");
    }
  };

  useEffect(() => {
    const next = guidePlaceSearchInput.trim();
    const handle = window.setTimeout(() => {
      setGuidePlaceSearch(next);
      setGuidePlacePage(1);
    }, 350);

    return () => window.clearTimeout(handle);
  }, [guidePlaceSearchInput]);

  useEffect(() => {
    const next = stagedPlaceSearchInput.trim();
    const handle = window.setTimeout(() => {
      setStagedPlaceSearch(next);
      setStagedPlacePage(1);
    }, 350);

    return () => window.clearTimeout(handle);
  }, [stagedPlaceSearchInput]);

  useEffect(() => {
    setGuideSubcategoryForm((prev) => {
      if (guideCategories.length === 0) {
        return prev.category_id ? { ...prev, category_id: "" } : prev;
      }
      if (guideCategories.some((row) => row.id === prev.category_id)) return prev;
      return { ...prev, category_id: guideCategories[0].id };
    });
    setGuidePlaceForm((prev) => {
      if (guideCategories.length === 0) {
        return prev.category_id || prev.subcategory_ids.length > 0 ? { ...prev, category_id: "", subcategory_ids: [] } : prev;
      }
      const resolvedCategoryId =
        guideCategories.some((row) => row.id === prev.category_id) ? prev.category_id : guideCategories[0].id;
      const subcategoryOptions = guideSubcategories.filter((row) => row.category_id === resolvedCategoryId);
      const resolvedSubcategoryIds = resolveGuideSubcategoryIds(prev.subcategory_ids, subcategoryOptions);
      return {
        ...prev,
        category_id: resolvedCategoryId,
        subcategory_ids: resolvedSubcategoryIds,
      };
    });
  }, [guideCategories]);

  useEffect(() => {
    setGuidePlaceForm((prev) => {
      if (!prev.category_id) return prev.subcategory_ids.length > 0 ? { ...prev, subcategory_ids: [] } : prev;
      const options = guideSubcategories.filter((row) => row.category_id === prev.category_id);
      const nextSubcategoryIds = resolveGuideSubcategoryIds(prev.subcategory_ids, options);
      if (JSON.stringify(nextSubcategoryIds) === JSON.stringify(prev.subcategory_ids)) return prev;
      return { ...prev, subcategory_ids: nextSubcategoryIds };
    });
    setGuidePlaceEditForm((prev) => {
      if (!prev.category_id) return prev.subcategory_ids.length > 0 ? { ...prev, subcategory_ids: [] } : prev;
      const options = guideSubcategories.filter((row) => row.category_id === prev.category_id);
      const nextSubcategoryIds = resolveGuideSubcategoryIds(prev.subcategory_ids, options);
      if (JSON.stringify(nextSubcategoryIds) === JSON.stringify(prev.subcategory_ids)) return prev;
      return { ...prev, subcategory_ids: nextSubcategoryIds };
    });
    setStagedPlaceEditForm((prev) => {
      if (!prev.category_id) return prev.subcategory_ids.length > 0 ? { ...prev, subcategory_ids: [] } : prev;
      const options = guideSubcategories.filter((row) => row.category_id === prev.category_id);
      const nextSubcategoryIds = resolveGuideSubcategoryIds(prev.subcategory_ids, options);
      if (JSON.stringify(nextSubcategoryIds) === JSON.stringify(prev.subcategory_ids)) return prev;
      return { ...prev, subcategory_ids: nextSubcategoryIds };
    });
  }, [guideSubcategories]);

  const guideSubcategoriesWithCategory = useMemo(() => {
    return guideSubcategories.map((row) => {
      const parent = guideCategories.find((category) => category.id === row.category_id) ?? null;
      return {
        ...row,
        category_name: parent?.name ?? "未分類",
        category_icon: parent?.icon ?? "📖",
      };
    });
  }, [guideCategories, guideSubcategories]);

  const guidePlaceSubcategoryOptions = useMemo(() => {
    const categoryId = guidePlaceForm.category_id;
    if (!categoryId) return [];
    return guideSubcategories.filter((row) => row.category_id === categoryId);
  }, [guidePlaceForm.category_id, guideSubcategories]);

  const guidePlaceEditSubcategoryOptions = useMemo(() => {
    const categoryId = guidePlaceEditForm.category_id;
    if (!categoryId) return [];
    return guideSubcategories.filter((row) => row.category_id === categoryId);
  }, [guidePlaceEditForm.category_id, guideSubcategories]);

  const guidePlaceFacilityTags = useMemo(() => {
    return facilityTags
      .filter((row) => row.is_active)
      .slice()
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      }) as GuidePlaceFacilityTagOption[];
  }, [facilityTags]);

  const guidePlaceFacilityTagMap = useMemo(() => {
    return new Map(guidePlaceFacilityTags.map((row) => [row.id, row]));
  }, [guidePlaceFacilityTags]);

  const guidePlaceEditFacilityTagIdSet = useMemo(() => {
    return new Set(Array.isArray(guidePlaceEditForm.facility_tag_ids) ? guidePlaceEditForm.facility_tag_ids : []);
  }, [guidePlaceEditForm.facility_tag_ids]);

  const editingGuidePlaceRow = useMemo(() => {
    if (!editingGuidePlaceId) return null;
    return guidePlaces.find((row) => row.id === editingGuidePlaceId) ?? null;
  }, [editingGuidePlaceId, guidePlaces]);

  const stagedPlaceEditSubcategoryOptions = useMemo(() => {
    const categoryId = stagedPlaceEditForm.category_id;
    if (!categoryId) return [];
    return guideSubcategories.filter((row) => row.category_id === categoryId);
  }, [stagedPlaceEditForm.category_id, guideSubcategories]);

  const toggleGuidePlaceFormSubcategory = (subcategoryId: string) => {
    setGuidePlaceForm((prev) => {
      const current = normalizeGuideSubcategoryIds(prev.subcategory_ids);
      const next = current.includes(subcategoryId) ? current.filter((id) => id !== subcategoryId) : [...current, subcategoryId];
      return { ...prev, subcategory_ids: next };
    });
  };

  const toggleGuidePlaceEditSubcategory = (subcategoryId: string) => {
    setGuidePlaceEditForm((prev) => {
      const current = normalizeGuideSubcategoryIds(prev.subcategory_ids);
      const next = current.includes(subcategoryId) ? current.filter((id) => id !== subcategoryId) : [...current, subcategoryId];
      return { ...prev, subcategory_ids: next };
    });
  };

  const toggleStagedPlaceEditSubcategory = (subcategoryId: string) => {
    setStagedPlaceEditForm((prev) => {
      const current = normalizeGuideSubcategoryIds(prev.subcategory_ids);
      const next = current.includes(subcategoryId) ? current.filter((id) => id !== subcategoryId) : [...current, subcategoryId];
      return { ...prev, subcategory_ids: next };
    });
  };

  const selectedGuidePlaceIdSet = useMemo(() => {
    return new Set(selectedGuidePlaceIds);
  }, [selectedGuidePlaceIds]);

  const guidePlaceTotalPages = useMemo(() => {
    const pages = Math.ceil(guidePlaceTotal / GUIDE_PLACES_PAGE_SIZE);
    return pages > 0 ? pages : 1;
  }, [guidePlaceTotal]);

  const stagedPlaceTotalPages = useMemo(() => {
    const pages = Math.ceil(stagedPlaceTotal / STAGED_PLACES_PAGE_SIZE);
    return pages > 0 ? pages : 1;
  }, [stagedPlaceTotal]);

  useEffect(() => {
    if (guidePlacePage <= guidePlaceTotalPages) return;
    setGuidePlacePage(guidePlaceTotalPages);
  }, [guidePlacePage, guidePlaceTotalPages]);

  useEffect(() => {
    if (stagedPlacePage <= stagedPlaceTotalPages) return;
    setStagedPlacePage(stagedPlaceTotalPages);
  }, [stagedPlacePage, stagedPlaceTotalPages]);

  const loadStagedPlaces = async () => {
    setLoadingStagedPlaces(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "pending");
      params.set("page", String(stagedPlacePage));
      params.set("pageSize", String(STAGED_PLACES_PAGE_SIZE));
      if (stagedPlaceSearch) params.set("q", stagedPlaceSearch);

      const res = await fetch(`/api/admin/staged-places?${params.toString()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { items?: StagedPlaceAdminRow[]; total?: number; page?: number; pageSize?: number; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "讀取待審核地點失敗");

      const nextItems = Array.isArray(json?.items) ? json.items : [];
      const nextTotal = typeof json?.total === "number" && Number.isFinite(json.total) ? json.total : nextItems.length;
      setStagedPlaces(nextItems);
      setStagedPlaceTotal(nextTotal);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取待審核地點失敗";
      showToast(msg);
      setStagedPlaces([]);
      setStagedPlaceTotal(0);
    } finally {
      setLoadingStagedPlaces(false);
    }
  };

  const loadGuidePlaces = async () => {
    setLoadingGuidePlaces(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(guidePlacePage));
      params.set("pageSize", String(GUIDE_PLACES_PAGE_SIZE));
      if (guidePlaceSearch) params.set("q", guidePlaceSearch);

      const res = await fetch(`/api/admin/guide-places?${params.toString()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { items?: GuidePlaceAdminRow[]; total?: number; page?: number; pageSize?: number; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "讀取指南地點失敗");
      const nextItems = Array.isArray(json?.items) ? json.items : [];
      const nextTotal = typeof json?.total === "number" && Number.isFinite(json.total) ? json.total : nextItems.length;
      setGuidePlaces(nextItems);
      setGuidePlaceTotal(nextTotal);
      setSelectedGuidePlaceIds((prev) => {
        if (prev.length === 0) return prev;
        const idSet = new Set(nextItems.map((row) => row.id));
        const nextSelected = prev.filter((id) => idSet.has(id));
        return nextSelected.length === prev.length ? prev : nextSelected;
      });
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "讀取指南地點失敗";
      showToast(msg);
      setGuidePlaces([]);
      setGuidePlaceTotal(0);
      setSelectedGuidePlaceIds([]);
    } finally {
      setLoadingGuidePlaces(false);
    }
  };

  useEffect(() => {
    void loadGuidePlaces();
  }, [guidePlaceSearch, guidePlacePage]);

  useEffect(() => {
    void loadStagedPlaces();
  }, [stagedPlaceSearch, stagedPlacePage]);

  const handleGuidePlaceImageUpload = async (files?: FileList | File[]) => {
    const list = Array.from(files ?? []).filter(Boolean);
    if (list.length === 0) return;
    try {
      setUploadingGuidePlaceImage(true);
      const uploaded: string[] = [];
      for (const file of list) {
        validatePetImageFile(file);
        const publicUrl = await uploadPetImage(supabase, file, {
          folder: "guide-places",
          bucket: "guide-photos",
        });
        uploaded.push(publicUrl);
      }
      setGuidePlaceForm((prev) => {
        const image_urls = [...prev.image_urls, ...uploaded];
        return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
      });
      showToast(`📸 已成功上傳 ${uploaded.length} 張指南地點相片`, "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "指南地點相片上傳失敗";
      showToast(msg);
    } finally {
      setUploadingGuidePlaceImage(false);
    }
  };

  const handleGuidePlaceEditImageUpload = async (files?: FileList | File[]) => {
    const list = Array.from(files ?? []).filter(Boolean);
    if (list.length === 0) return;
    try {
      setUploadingGuidePlaceEditImage(true);
      const uploaded: string[] = [];
      for (const file of list) {
        validatePetImageFile(file);
        const publicUrl = await uploadPetImage(supabase, file, {
          folder: "guide-places",
          bucket: "guide-photos",
        });
        uploaded.push(publicUrl);
      }
      setGuidePlaceEditForm((prev) => {
        const image_urls = [...prev.image_urls, ...uploaded];
        return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
      });
      showToast(`📸 已成功更新 ${uploaded.length} 張指南地點相片`, "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "指南地點相片上傳失敗";
      showToast(msg);
    } finally {
      setUploadingGuidePlaceEditImage(false);
    }
  };

  const removeGuidePlaceFormImageAt = (index: number) => {
    setGuidePlaceForm((prev) => {
      const image_urls = prev.image_urls.filter((_, idx) => idx !== index);
      return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
    });
  };

  const removeGuidePlaceEditFormImageAt = (index: number) => {
    setGuidePlaceEditForm((prev) => {
      const image_urls = prev.image_urls.filter((_, idx) => idx !== index);
      return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
    });
  };

  const handleStagedPlaceEditImageUpload = async (files?: FileList | File[]) => {
    const list = Array.from(files ?? []).filter(Boolean);
    if (list.length === 0) return;
    try {
      setUploadingStagedPlaceImage(true);
      const uploaded: string[] = [];
      for (const file of list) {
        validatePetImageFile(file);
        const publicUrl = await uploadPetImage(supabase, file, {
          folder: "guide-places",
          bucket: "guide-photos",
        });
        uploaded.push(publicUrl);
      }
      setStagedPlaceEditForm((prev) => {
        const image_urls = [...prev.image_urls, ...uploaded];
        return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
      });
      showToast(`📸 已為待審核地點上傳 ${uploaded.length} 張相片`, "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "待審核地點相片上傳失敗";
      showToast(msg);
    } finally {
      setUploadingStagedPlaceImage(false);
    }
  };

  const removeStagedPlaceEditFormImageAt = (index: number) => {
    setStagedPlaceEditForm((prev) => {
      const image_urls = prev.image_urls.filter((_, idx) => idx !== index);
      return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
    });
  };

  const handleGuidePlaceFormUseCurrentLocation = () => {
    if (locatingGuidePlaceForm) return;
    if (!navigator.geolocation) {
      showToast("你的裝置不支援定位。");
      return;
    }
    setLocatingGuidePlaceForm(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGuidePlaceForm((prev) => ({
          ...prev,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
        setGuidePlaceFormMapFocus({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 17 });
        setLocatingGuidePlaceForm(false);
        showToast("📍 已帶入目前定位", "success");
      },
      () => {
        setLocatingGuidePlaceForm(false);
        showToast("無法取得目前定位，請改用地圖選點或手動輸入座標。");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleGuidePlaceEditFormUseCurrentLocation = () => {
    if (locatingGuidePlaceEditForm) return;
    if (!navigator.geolocation) {
      showToast("你的裝置不支援定位。");
      return;
    }
    setLocatingGuidePlaceEditForm(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGuidePlaceEditForm((prev) => ({
          ...prev,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
        setGuidePlaceEditFormMapFocus({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 17 });
        setLocatingGuidePlaceEditForm(false);
        showToast("📍 已帶入目前定位", "success");
      },
      () => {
        setLocatingGuidePlaceEditForm(false);
        showToast("無法取得目前定位，請改用地圖選點或手動輸入座標。");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleStagedPlaceEditFormUseCurrentLocation = () => {
    if (locatingStagedPlaceEditForm) return;
    if (!navigator.geolocation) {
      showToast("你的裝置不支援定位。");
      return;
    }
    setLocatingStagedPlaceEditForm(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStagedPlaceEditForm((prev) => ({
          ...prev,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
        setStagedPlaceEditFormMapFocus({ center: [pos.coords.latitude, pos.coords.longitude], zoom: 17 });
        setLocatingStagedPlaceEditForm(false);
        showToast("📍 已帶入目前定位", "success");
      },
      () => {
        setLocatingStagedPlaceEditForm(false);
        showToast("無法取得目前定位，請改用地圖選點或手動輸入座標。");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleGuidePlaceFormAddressSearch = async () => {
    if (searchingGuidePlaceFormAddress) return;
    const query = guidePlaceFormAddressSearchQuery.trim() || guidePlaceForm.address.trim();
    if (!query) {
      showToast("請先輸入要搜尋的地址。");
      return;
    }
    try {
      setSearchingGuidePlaceFormAddress(true);
      const result = await geocodeAddressWithNominatim(query);
      if (!result) {
        showToast("找不到該地址，請改用地圖落針。");
        return;
      }
      setGuidePlaceForm((prev) => ({
        ...prev,
        latitude: result.lat.toFixed(6),
        longitude: result.lng.toFixed(6),
      }));
      setGuidePlaceFormMapFocus({ center: [result.lat, result.lng], zoom: 17 });
      showToast("📍 已根據地址搜尋自動定位", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "地址搜尋失敗，請稍後再試。";
      showToast(msg);
    } finally {
      setSearchingGuidePlaceFormAddress(false);
    }
  };

  const handleGuidePlaceEditFormAddressSearch = async () => {
    if (searchingGuidePlaceEditFormAddress) return;
    const query = guidePlaceEditFormAddressSearchQuery.trim() || guidePlaceEditForm.address.trim();
    if (!query) {
      showToast("請先輸入要搜尋的地址。");
      return;
    }
    try {
      setSearchingGuidePlaceEditFormAddress(true);
      const result = await geocodeAddressWithNominatim(query);
      if (!result) {
        showToast("找不到該地址，請改用地圖落針。");
        return;
      }
      setGuidePlaceEditForm((prev) => ({
        ...prev,
        latitude: result.lat.toFixed(6),
        longitude: result.lng.toFixed(6),
      }));
      setGuidePlaceEditFormMapFocus({ center: [result.lat, result.lng], zoom: 17 });
      showToast("📍 已根據地址搜尋自動定位", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "地址搜尋失敗，請稍後再試。";
      showToast(msg);
    } finally {
      setSearchingGuidePlaceEditFormAddress(false);
    }
  };

  const handleStagedPlaceEditFormAddressSearch = async () => {
    if (searchingStagedPlaceEditFormAddress) return;
    const query = stagedPlaceEditFormAddressSearchQuery.trim() || stagedPlaceEditForm.address.trim();
    if (!query) {
      showToast("請先輸入要搜尋的地址。");
      return;
    }
    try {
      setSearchingStagedPlaceEditFormAddress(true);
      const result = await geocodeAddressWithNominatim(query);
      if (!result) {
        showToast("找不到該地址，請改用地圖落針。");
        return;
      }
      setStagedPlaceEditForm((prev) => ({
        ...prev,
        latitude: result.lat.toFixed(6),
        longitude: result.lng.toFixed(6),
      }));
      setStagedPlaceEditFormMapFocus({ center: [result.lat, result.lng], zoom: 17 });
      showToast("📍 已根據地址搜尋自動定位", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "地址搜尋失敗，請稍後再試。";
      showToast(msg);
    } finally {
      setSearchingStagedPlaceEditFormAddress(false);
    }
  };

  const handleGuidePlaceFormMapPick = ({ lat, lng }: { lat: number; lng: number }) => {
    setGuidePlaceForm((prev) => ({
      ...prev,
      latitude: String(lat),
      longitude: String(lng),
    }));
    setGuidePlaceFormMapFocus({ center: [lat, lng], zoom: 17 });
    showToast("📍 已成功在地圖上落針", "success");
  };

  const handleGuidePlaceEditFormMapPick = ({ lat, lng }: { lat: number; lng: number }) => {
    setGuidePlaceEditForm((prev) => ({
      ...prev,
      latitude: String(lat),
      longitude: String(lng),
    }));
    setGuidePlaceEditFormMapFocus({ center: [lat, lng], zoom: 17 });
    showToast("📍 已成功在地圖上落針", "success");
  };

  const handleStagedPlaceEditFormMapPick = ({ lat, lng }: { lat: number; lng: number }) => {
    setStagedPlaceEditForm((prev) => ({
      ...prev,
      latitude: String(lat),
      longitude: String(lng),
    }));
    setStagedPlaceEditFormMapFocus({ center: [lat, lng], zoom: 17 });
    showToast("📍 已成功在地圖上落針", "success");
  };

  const handleImportParks = async () => {
    if (importingGuideParks) return;
    const ok = window.confirm("確定立即從政府 Open Data 匯入寵物共享公園 / 寵物公園資料到「待審核」嗎？");
    if (!ok) return;
    setImportingGuideParks(true);
    try {
      const res = await fetch("/api/admin/import-parks", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; imported?: number; withImages?: number; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "匯入政府公園失敗");
      await loadStagedPlaces();
      setActiveDashboardTab("staged-places");
      showToast(`🏞️ 已匯入 ${json?.imported ?? 0} 個公園到待審核，當中 ${json?.withImages ?? 0} 個已抓取相片`, "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "匯入政府公園失敗";
      showToast(msg);
    } finally {
      setImportingGuideParks(false);
    }
  };

  const jumpToStagedPlacesReview = async () => {
    setActiveDashboardTab("staged-places");
    setStagedPlacePage(1);
    setStagedPlaceSearchInput("");
    setStagedPlaceSearch("");
    await loadStagedPlaces();
  };

  const handleRunVetScraper = async () => {
    if (runningVetScraper) return;
    const district = vetScraperForm.district.trim();
    const keyword =
      vetScraperForm.keyword === "__custom__" ? vetScraperForm.customKeyword.trim() : vetScraperForm.keyword.trim();
    if (!district) {
      showToast("請輸入地區。");
      return;
    }
    if (!keyword) {
      showToast("請輸入關鍵字。");
      return;
    }

    setRunningVetScraper(true);
    setVetScraperResult(null);

    try {
      const res = await fetch("/api/admin/run-vet-scraper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district, keyword }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            imported?: number;
            validPlaces?: number;
            candidates?: number;
            district?: string;
            keyword?: string;
            query?: string;
            mode?: string;
            queryAttempts?: Array<{ query: string; candidates: number }>;
            failures?: Array<Record<string, unknown>>;
            languageWarnings?: Array<Record<string, unknown>>;
            error?: string;
          }
        | null;
      if (!res.ok) throw new Error(json?.error || "執行獸醫爬蟲失敗");

      const result: VetScraperRunResult = {
        imported: Number(json?.imported ?? 0),
        validPlaces: Number(json?.validPlaces ?? 0),
        candidates: Number(json?.candidates ?? 0),
        district: String(json?.district ?? district),
        keyword: String(json?.keyword ?? keyword),
        query: typeof json?.query === "string" ? json.query : "",
        mode: typeof json?.mode === "string" ? json.mode : "",
        queryAttempts: Array.isArray(json?.queryAttempts) ? json.queryAttempts : [],
        failures: Array.isArray(json?.failures) ? json.failures : [],
        languageWarnings: Array.isArray(json?.languageWarnings) ? json.languageWarnings : [],
      };

      setVetScraperResult(result);
      await loadStagedPlaces();
      showToast(`✅ 已新增 ${result.imported} 筆數據至 staged_places`, "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "執行獸醫爬蟲失敗";
      showToast(msg);
    } finally {
      setRunningVetScraper(false);
    }
  };

  const createGuideCategory = async () => {
    if (addingGuideCategory) return;
    const name = guideCategoryForm.name.trim();
    const icon = guideCategoryForm.icon.trim();
    const sort_order = Number.isFinite(Number(guideCategoryForm.sort_order)) ? Number(guideCategoryForm.sort_order) : 100;
    if (!name) {
      showToast("請輸入指南大分類名稱。");
      return;
    }
    if (!icon) {
      showToast("請選擇 Emoji 圖標。");
      return;
    }
    setAddingGuideCategory(true);
    try {
      const res = await fetch("/api/admin/guide-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, sort_order }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: GuideCategoryAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "新增指南大分類失敗");
      setGuideCategoryForm((prev) => ({ ...prev, name: "" }));
      await refreshGuideTaxonomy();
      showToast("✅ 已新增指南大分類", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "新增指南大分類失敗";
      showToast(msg);
    } finally {
      setAddingGuideCategory(false);
    }
  };

  const deleteGuideCategory = async (row: GuideCategoryAdminRow) => {
    if (deletingGuideCategoryId) return;
    const ok = window.confirm(`確定要刪除大分類「${row.icon} ${row.name}」嗎？其底下子分類亦會一併刪除。`);
    if (!ok) return;
    setDeletingGuideCategoryId(row.id);
    try {
      const res = await fetch(`/api/admin/guide-categories?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "刪除指南大分類失敗");
      await refreshGuideTaxonomy();
      showToast("🗑️ 已刪除指南大分類", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "刪除指南大分類失敗";
      showToast(msg);
    } finally {
      setDeletingGuideCategoryId("");
    }
  };

  const startEditGuideCategory = (row: GuideCategoryAdminRow) => {
    setEditingGuideCategoryId(row.id);
    setGuideCategoryEditForm({ name: row.name, icon: row.icon });
  };

  const cancelEditGuideCategory = () => {
    setEditingGuideCategoryId("");
    setGuideCategoryEditForm({ name: "", icon: "🩺" });
  };

  const saveGuideCategoryEdit = async (row: GuideCategoryAdminRow) => {
    if (savingGuideCategoryId) return;
    const name = guideCategoryEditForm.name.trim();
    const icon = guideCategoryEditForm.icon.trim();
    if (!name) {
      showToast("請輸入指南大分類名稱。");
      return;
    }
    if (!icon) {
      showToast("請選擇 Emoji 圖標。");
      return;
    }
    setSavingGuideCategoryId(row.id);
    try {
      const res = await fetch("/api/admin/guide-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          name,
          icon,
          sort_order: row.sort_order,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; item?: GuideCategoryAdminRow; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "更新指南大分類失敗");
      await refreshGuideTaxonomy();
      cancelEditGuideCategory();
      showToast("✅ 已更新指南大分類", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新指南大分類失敗";
      showToast(msg);
    } finally {
      setSavingGuideCategoryId("");
    }
  };

  const createGuideSubcategory = async () => {
    if (addingGuideSubcategory) return;
    const category_id = guideSubcategoryForm.category_id.trim();
    const name = guideSubcategoryForm.name.trim();
    const sort_order = Number.isFinite(Number(guideSubcategoryForm.sort_order)) ? Number(guideSubcategoryForm.sort_order) : 100;
    if (!category_id) {
      showToast("請先建立至少一個指南大分類。");
      return;
    }
    if (!name) {
      showToast("請輸入指南子分類名稱。");
      return;
    }
    setAddingGuideSubcategory(true);
    try {
      const res = await fetch("/api/admin/guide-subcategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id, name, sort_order }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; item?: GuideSubcategoryAdminRow; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "新增指南子分類失敗");
      setGuideSubcategoryForm((prev) => ({ ...prev, name: "" }));
      await loadGuideSubcategories();
      showToast("✅ 已新增指南子分類", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "新增指南子分類失敗";
      showToast(msg);
    } finally {
      setAddingGuideSubcategory(false);
    }
  };

  const deleteGuideSubcategory = async (row: GuideSubcategoryAdminRow) => {
    if (deletingGuideSubcategoryId) return;
    const parent = guideCategories.find((item) => item.id === row.category_id);
    const ok = window.confirm(
      `確定要刪除子分類「${parent?.icon ?? "📖"} ${parent?.name ?? "未分類"} / ${row.name}」嗎？此操作不可逆。`,
    );
    if (!ok) return;
    setDeletingGuideSubcategoryId(row.id);
    try {
      const res = await fetch(`/api/admin/guide-subcategories?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "刪除指南子分類失敗");
      await loadGuideSubcategories();
      showToast("🗑️ 已刪除指南子分類", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "刪除指南子分類失敗";
      showToast(msg);
    } finally {
      setDeletingGuideSubcategoryId("");
    }
  };

  const startEditGuideSubcategory = (row: GuideSubcategoryAdminRow) => {
    setEditingGuideSubcategoryId(row.id);
    setGuideSubcategoryEditForm({
      category_id: row.category_id,
      name: row.name,
    });
  };

  const cancelEditGuideSubcategory = () => {
    setEditingGuideSubcategoryId("");
    setGuideSubcategoryEditForm({ category_id: "", name: "" });
  };

  const saveGuideSubcategoryEdit = async (row: GuideSubcategoryAdminRow) => {
    if (savingGuideSubcategoryId) return;
    const category_id = guideSubcategoryEditForm.category_id.trim();
    const name = guideSubcategoryEditForm.name.trim();
    if (!category_id) {
      showToast("請選擇所屬大分類。");
      return;
    }
    if (!name) {
      showToast("請輸入子分類名稱。");
      return;
    }
    setSavingGuideSubcategoryId(row.id);
    try {
      const res = await fetch("/api/admin/guide-subcategories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          category_id,
          name,
          sort_order: row.sort_order,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; item?: GuideSubcategoryAdminRow; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "更新指南子分類失敗");
      await refreshGuideTaxonomy();
      cancelEditGuideSubcategory();
      showToast("✅ 已更新指南子分類", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新指南子分類失敗";
      showToast(msg);
    } finally {
      setSavingGuideSubcategoryId("");
    }
  };

  const openGuidePlaceCreateModal = () => {
    setGuidePlaceForm(createEmptyGuidePlaceForm());
    setGuidePlaceFormMapFocus(null);
    setGuidePlaceFormAddressSearchQuery("");
    setSearchingGuidePlaceFormAddress(false);
    setLocatingGuidePlaceForm(false);
    setGuidePlaceCreateModalNonce((prev) => prev + 1);
    setGuidePlaceCreateModalOpen(true);
  };

  const closeGuidePlaceCreateModal = () => {
    if (addingGuidePlace || uploadingGuidePlaceImage || locatingGuidePlaceForm || searchingGuidePlaceFormAddress) return;
    setGuidePlaceCreateModalOpen(false);
  };

  const createGuidePlace = async () => {
    if (addingGuidePlace) return;
    const category_id = guidePlaceForm.category_id.trim();
    const subcategory_ids = normalizeGuideSubcategoryIds(guidePlaceForm.subcategory_ids);
    const name = guidePlaceForm.name.trim();
    const district = guidePlaceForm.district.trim();
    const address = guidePlaceForm.address.trim();
    if (!category_id) {
      showToast("請先選擇指南大分類。");
      return;
    }
    if (subcategory_ids.length === 0) {
      showToast("請至少選擇一個指南子分類。");
      return;
    }
    if (!name) {
      showToast("請輸入地點名稱。");
      return;
    }
    if (!district) {
      showToast("請選擇地區。");
      return;
    }
    if (!address) {
      showToast("請輸入詳細地址。");
      return;
    }
    setAddingGuidePlace(true);
    try {
      const res = await fetch("/api/admin/guide-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id,
          subcategory_ids,
          name,
          district,
          address,
          opening_hours: guidePlaceForm.opening_hours.trim() || null,
          latitude: parseOptionalCoordinate(guidePlaceForm.latitude),
          longitude: parseOptionalCoordinate(guidePlaceForm.longitude),
          image_url: getPrimaryImageUrl(guidePlaceForm.image_urls) || null,
          image_urls: guidePlaceForm.image_urls,
          facility_tag_ids: guidePlaceForm.facility_tag_ids,
          has_grass: guidePlaceForm.has_grass,
          has_wash_station: guidePlaceForm.has_wash_station,
          has_fencing: guidePlaceForm.has_fencing,
          has_parking: guidePlaceForm.has_parking,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: GuidePlaceAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "新增指南地點失敗");
      setGuidePlaceForm(createEmptyGuidePlaceForm());
      setGuidePlaceFormMapFocus(null);
      setGuidePlaceFormAddressSearchQuery("");
      setGuidePlaceCreateModalOpen(false);
      await loadGuidePlaces();
      showToast("✅ 已新增指南地點", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "新增指南地點失敗";
      showToast(msg);
    } finally {
      setAddingGuidePlace(false);
    }
  };

  const deleteGuidePlace = async (row: GuidePlaceAdminRow) => {
    if (deletingGuidePlaceId) return;
    const ok = window.confirm(`確定要刪除指南地點「${row.name}」嗎？此操作不可逆。`);
    if (!ok) return;
    setDeletingGuidePlaceId(row.id);
    try {
      const res = await fetch(`/api/admin/guide-places?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "刪除指南地點失敗");
      await loadGuidePlaces();
      setSelectedGuidePlaceIds((prev) => prev.filter((id) => id !== row.id));
      showToast("🗑️ 已刪除指南地點", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "刪除指南地點失敗";
      showToast(msg);
    } finally {
      setDeletingGuidePlaceId("");
    }
  };

  const toggleSelectAllGuidePlaces = (checked: boolean) => {
    if (!checked) {
      setSelectedGuidePlaceIds([]);
      return;
    }
    setSelectedGuidePlaceIds(guidePlaces.map((row) => row.id));
  };

  const toggleSelectGuidePlace = (id: string, checked: boolean) => {
    setSelectedGuidePlaceIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  const bulkDeleteGuidePlaces = async () => {
    if (bulkDeletingGuidePlaces || deletingGuidePlaceId || savingGuidePlaceId) return;
    if (selectedGuidePlaceIds.length === 0) return;
    const ok = window.confirm(`確定要批量刪除 ${selectedGuidePlaceIds.length} 個指南地點嗎？此操作不可逆。`);
    if (!ok) return;
    setBulkDeletingGuidePlaces(true);
    try {
      const res = await fetch("/api/admin/guide-places", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedGuidePlaceIds }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; deleted?: number; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "批量刪除失敗");
      setSelectedGuidePlaceIds([]);
      await loadGuidePlaces();
      showToast(`🧹 已批量刪除 ${json?.deleted ?? 0} 個指南地點`, "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "批量刪除失敗";
      showToast(msg);
    } finally {
      setBulkDeletingGuidePlaces(false);
    }
  };

  const startEditGuidePlace = (row: GuidePlaceAdminRow) => {
    setEditingGuidePlaceId(row.id);
    setGuidePlaceEditForm({
      category_id: row.category_id,
      subcategory_ids: normalizeGuideSubcategoryIds(row.subcategory_ids?.length ? row.subcategory_ids : [row.subcategory_id]),
      name: row.name,
      district: row.district,
      address: row.address,
      opening_hours: row.opening_hours || "",
      latitude: row.latitude == null ? "" : String(row.latitude),
      longitude: row.longitude == null ? "" : String(row.longitude),
      image_url: row.image_url || "",
      image_urls: normalizeImageUrlList(row.image_urls).length > 0 ? normalizeImageUrlList(row.image_urls) : row.image_url ? [row.image_url] : [],
      facility_tag_ids: Array.isArray(row.facility_tag_ids) ? row.facility_tag_ids : [],
      has_grass: row.has_grass,
      has_wash_station: row.has_wash_station,
      has_fencing: row.has_fencing,
      has_parking: row.has_parking,
    });
  };

  const cancelEditGuidePlace = () => {
    setEditingGuidePlaceId("");
    setGuidePlaceEditForm(createEmptyGuidePlaceForm());
    setGuidePlaceFacilityTagQuickAddForm({ name: "", icon: "🏷️", sort_order: "100", match_keywords: "" });
  };

  const toggleGuidePlaceEditFacilityTag = (tag: GuidePlaceFacilityTagOption) => {
    setGuidePlaceEditForm((prev) => {
      const prevIds = Array.isArray(prev.facility_tag_ids) ? prev.facility_tag_ids : [];
      const nextIds = prevIds.includes(tag.id) ? prevIds.filter((id) => id !== tag.id) : [...prevIds, tag.id];
      const legacyKeys = new Set(
        nextIds
          .map((id) => String(guidePlaceFacilityTagMap.get(id)?.legacy_key || "").trim())
          .filter(Boolean),
      );
      return {
        ...prev,
        facility_tag_ids: nextIds,
        has_grass: legacyKeys.has("has_grass"),
        has_wash_station: legacyKeys.has("has_wash_station"),
        has_fencing: legacyKeys.has("has_fencing"),
        has_parking: legacyKeys.has("has_parking"),
      };
    });
  };

  const createGuidePlaceFacilityTagInline = async () => {
    if (addingGuidePlaceFacilityTagQuickAdd) return;
    const name = guidePlaceFacilityTagQuickAddForm.name.trim();
    const icon = guidePlaceFacilityTagQuickAddForm.icon.trim();
    const sort_order = Number.isFinite(Number(guidePlaceFacilityTagQuickAddForm.sort_order))
      ? Number(guidePlaceFacilityTagQuickAddForm.sort_order)
      : 100;
    const match_keywords = guidePlaceFacilityTagQuickAddForm.match_keywords;
    if (!name) {
      showToast("請輸入標籤名稱。");
      return;
    }
    setAddingGuidePlaceFacilityTagQuickAdd(true);
    try {
      const res = await fetch("/api/admin/facility-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, sort_order, match_keywords, is_active: true }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: FacilityTagAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "新增設施標籤失敗");
      const createdId = json?.item?.id ? String(json.item.id) : "";
      await loadFacilityTags();
      if (createdId) {
        const createdTag: GuidePlaceFacilityTagOption = {
          id: createdId,
          name,
          icon,
          legacy_key: json?.item?.legacy_key ?? null,
          is_active: true,
          sort_order,
        };
        toggleGuidePlaceEditFacilityTag(createdTag);
      }
      setGuidePlaceFacilityTagQuickAddForm({ name: "", icon: "🏷️", sort_order: "100", match_keywords: "" });
      showToast("✅ 已新增設施標籤", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "新增設施標籤失敗";
      showToast(msg);
    } finally {
      setAddingGuidePlaceFacilityTagQuickAdd(false);
    }
  };

  const saveGuidePlaceEdit = async (row: GuidePlaceAdminRow) => {
    if (savingGuidePlaceId) return;
    const category_id = guidePlaceEditForm.category_id.trim();
    const subcategory_ids = normalizeGuideSubcategoryIds(guidePlaceEditForm.subcategory_ids);
    const name = guidePlaceEditForm.name.trim();
    const district = guidePlaceEditForm.district.trim();
    const address = guidePlaceEditForm.address.trim();
    if (!category_id) {
      showToast("請先選擇指南大分類。");
      return;
    }
    if (subcategory_ids.length === 0) {
      showToast("請至少選擇一個指南子分類。");
      return;
    }
    if (!name) {
      showToast("請輸入地點名稱。");
      return;
    }
    if (!district) {
      showToast("請選擇地區。");
      return;
    }
    if (!address) {
      showToast("請輸入詳細地址。");
      return;
    }
    setSavingGuidePlaceId(row.id);
    try {
      const res = await fetch("/api/admin/guide-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          category_id,
          subcategory_ids,
          name,
          district,
          address,
          opening_hours: guidePlaceEditForm.opening_hours.trim() || null,
          latitude: parseOptionalCoordinate(guidePlaceEditForm.latitude),
          longitude: parseOptionalCoordinate(guidePlaceEditForm.longitude),
          image_url: getPrimaryImageUrl(guidePlaceEditForm.image_urls) || null,
          image_urls: guidePlaceEditForm.image_urls,
          facility_tag_ids: guidePlaceEditForm.facility_tag_ids,
          has_grass: guidePlaceEditForm.has_grass,
          has_wash_station: guidePlaceEditForm.has_wash_station,
          has_fencing: guidePlaceEditForm.has_fencing,
          has_parking: guidePlaceEditForm.has_parking,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: GuidePlaceAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "更新指南地點失敗");
      await loadGuidePlaces();
      cancelEditGuidePlace();
      showToast("✅ 已更新指南地點", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新指南地點失敗";
      showToast(msg);
    } finally {
      setSavingGuidePlaceId("");
    }
  };

  const startEditStagedPlace = (row: StagedPlaceAdminRow) => {
    setEditingStagedPlaceId(row.id);
    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : null;
    setStagedPlaceEditForm({
      category_id: row.category_id,
      subcategory_ids: normalizeGuideSubcategoryIds(row.subcategory_ids?.length ? row.subcategory_ids : [row.subcategory_id]),
      name: row.name,
      district: row.district,
      address: row.address,
      opening_hours: row.opening_hours || "",
      latitude: row.latitude == null ? "" : String(row.latitude),
      longitude: row.longitude == null ? "" : String(row.longitude),
      image_url: row.image_url || "",
      image_urls: normalizeImageUrlList(row.image_urls).length > 0 ? normalizeImageUrlList(row.image_urls) : row.image_url ? [row.image_url] : [],
      facility_tag_ids: Array.isArray(row.facility_tag_ids) ? row.facility_tag_ids : [],
      has_grass: row.has_grass,
      has_wash_station: row.has_wash_station,
      has_fencing: row.has_fencing,
      has_parking: row.has_parking,
    });
    setStagedPlaceVetMetaForm({
      is_24h_emergency: meta?.is_24h_emergency === true,
      specialist_services: Array.isArray(meta?.specialist_services)
        ? (meta!.specialist_services as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean).join("、")
        : typeof meta?.specialist_services === "string"
          ? String(meta.specialist_services ?? "").trim()
          : "",
      booking_url: typeof meta?.booking_url === "string" ? String(meta.booking_url ?? "").trim() : "",
      pet_types_supported: Array.isArray(meta?.pet_types_supported)
        ? (meta!.pet_types_supported as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean).join("、")
        : typeof meta?.pet_types_supported === "string"
          ? String(meta.pet_types_supported ?? "").trim()
          : "",
    });
  };

  const cancelEditStagedPlace = () => {
    setEditingStagedPlaceId("");
    setStagedPlaceEditForm(createEmptyGuidePlaceForm());
    setStagedPlaceVetMetaForm({
      is_24h_emergency: false,
      specialist_services: "",
      booking_url: "",
      pet_types_supported: "",
    });
  };

  const saveStagedPlaceEdit = async (row: StagedPlaceAdminRow) => {
    if (savingStagedPlaceId) return;
    const category_id = stagedPlaceEditForm.category_id.trim();
    const subcategory_ids = normalizeGuideSubcategoryIds(stagedPlaceEditForm.subcategory_ids);
    const name = stagedPlaceEditForm.name.trim();
    const district = stagedPlaceEditForm.district.trim();
    const address = stagedPlaceEditForm.address.trim();
    if (!category_id) {
      showToast("請先選擇指南大分類。");
      return;
    }
    if (subcategory_ids.length === 0) {
      showToast("請至少選擇一個指南子分類。");
      return;
    }
    if (!name) {
      showToast("請輸入地點名稱。");
      return;
    }
    if (!district) {
      showToast("請選擇地區。");
      return;
    }
    if (!address) {
      showToast("請輸入詳細地址。");
      return;
    }

    const category = guideCategories.find((item) => item.id === category_id) ?? null;
    const isVetCategory = Boolean(category?.name.includes("獸醫"));
    const baseMeta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? ({ ...(row.metadata as any) } as Record<string, unknown>) : {};
    const metadata = isVetCategory
      ? {
          ...baseMeta,
          is_24h_emergency: stagedPlaceVetMetaForm.is_24h_emergency === true,
          specialist_services: normalizeCsvList(stagedPlaceVetMetaForm.specialist_services),
          booking_url: stagedPlaceVetMetaForm.booking_url.trim(),
          pet_types_supported: normalizeCsvList(stagedPlaceVetMetaForm.pet_types_supported),
        }
      : baseMeta;

    setSavingStagedPlaceId(row.id);
    try {
      const res = await fetch("/api/admin/staged-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          category_id,
          subcategory_ids,
          name,
          district,
          address,
          opening_hours: stagedPlaceEditForm.opening_hours.trim() || null,
          latitude: parseOptionalCoordinate(stagedPlaceEditForm.latitude),
          longitude: parseOptionalCoordinate(stagedPlaceEditForm.longitude),
          image_url: getPrimaryImageUrl(stagedPlaceEditForm.image_urls) || null,
          image_urls: stagedPlaceEditForm.image_urls,
          has_grass: stagedPlaceEditForm.has_grass,
          has_wash_station: stagedPlaceEditForm.has_wash_station,
          has_fencing: stagedPlaceEditForm.has_fencing,
          has_parking: stagedPlaceEditForm.has_parking,
          metadata,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: StagedPlaceAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "更新待審核地點失敗");
      await loadStagedPlaces();
      cancelEditStagedPlace();
      showToast("✅ 已更新待審核地點", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新待審核地點失敗";
      showToast(msg);
    } finally {
      setSavingStagedPlaceId("");
    }
  };

  const approveStagedPlace = async (row: StagedPlaceAdminRow) => {
    if (approvingStagedPlaceId || rejectingStagedPlaceId || savingStagedPlaceId) return;
    const ok = window.confirm(`確定要將「${row.name}」確認入庫嗎？此操作會寫入 guide_places。`);
    if (!ok) return;
    setApprovingStagedPlaceId(row.id);
    try {
      const res = await fetch(`/api/admin/staged-places/approve?id=${encodeURIComponent(row.id)}`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; guide_place_id?: string | null; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "確認入庫失敗");
      await Promise.all([loadStagedPlaces(), loadGuidePlaces()]);
      showToast("✅ 已確認入庫", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "確認入庫失敗";
      showToast(msg);
    } finally {
      setApprovingStagedPlaceId("");
    }
  };

  const rejectStagedPlace = async (row: StagedPlaceAdminRow) => {
    if (rejectingStagedPlaceId || approvingStagedPlaceId || savingStagedPlaceId) return;
    const ok = window.confirm(`確定要拒絕/刪除「${row.name}」嗎？此操作會將狀態標記為 rejected。`);
    if (!ok) return;
    setRejectingStagedPlaceId(row.id);
    try {
      const res = await fetch(`/api/admin/staged-places?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; item?: StagedPlaceAdminRow; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "拒絕失敗");
      await loadStagedPlaces();
      showToast("🗑️ 已拒絕待審核資料", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "拒絕失敗";
      showToast(msg);
    } finally {
      setRejectingStagedPlaceId("");
    }
  };

  useEffect(() => {
    void loadList(tab);
  }, [tab]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-pets-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "pets" }, () => {
        void refreshAllBoards(tab);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, tab]);

  useEffect(() => {
    import("leaflet").then((m) => setLeafletModule(m));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const manualAddress = String(form.manual_address || "").trim();
    const hasCoordinates = Number.isFinite(form.latitude) && Number.isFinite(form.longitude);
    if (!form.pet_name || (!form.location.trim() && !manualAddress) || !form.lost_time) {
      alert("請填寫：寵物名字 / 地點或手動地址 / 時間");
      return;
    }
    if (needsSourceLink(normalizeContactIdentity(form.source_type, form.case_type)) && !String(form.source_link || "").trim()) {
      alert("請填寫：社交媒體原帖連結");
      return;
    }
    if (!hasCoordinates && !manualAddress) {
      alert("請輸入有效的經緯度，或填寫手動地址。");
      return;
    }
    setSaving(true);
    try {
      const identity = normalizeContactIdentity(form.source_type, form.case_type);
      const alignedCaseType = getDefaultCaseTypeForIdentity(identity);
      const sourceLinkTrimmed = String(form.source_link || "").trim();
      const resolvedDistrict =
        hasCoordinates && form.latitude != null && form.longitude != null
          ? await reverseGeocodeDistrict(form.latitude, form.longitude)
          : null;
      const payload: PetInsert = {
        ...form,
        location: form.location.trim() || manualAddress,
        manual_address: manualAddress || null,
        district: resolvedDistrict,
        status: "approved",
        source_url:
          needsSourceLink(identity) && sourceLinkTrimmed
            ? sourceLinkTrimmed
            : `daydaypet://admin/${Date.now()}`,
        source_type: identity,
        source_link: needsSourceLink(identity) ? sourceLinkTrimmed || null : null,
        case_type: alignedCaseType,
        latitude: hasCoordinates ? form.latitude : null,
        longitude: hasCoordinates ? form.longitude : null,
      };
      const { data: created, error } = await supabase
        .from("pets")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      setForm((p) => ({
        ...p,
        pet_name: "",
        pet_type: "cat",
        breed: null,
        location: "",
        manual_address: null,
        district: null,
        lost_time: new Date().toISOString(),
        features: "",
        phone: "",
        image_url: "",
        source_url: `daydaypet://admin/${Date.now()}`,
        source_type: "owner",
        source_link: null,
        user_id: null,
        latitude: 22.3193,
        longitude: 114.1694,
      }));
      await refreshAllBoards("approved");
      showToast("✅ 已成功發佈案件", "success");
      if (created?.latitude != null && created?.longitude != null) {
        await broadcastDistrictEvent(created.district, "NEW_CASE", {
          petId: created.id,
          petName: created.pet_name,
          imageUrl: created.image_url,
          address: created.location,
          district: created.district,
          latitude: created.latitude,
          longitude: created.longitude,
        });
        try {
          await fetch("/api/push/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "NEW_CASE", petId: created.id }),
          });
        } catch {}
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "提交失敗";
      showToast(msg);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    const ok = confirm("確定刪除？");
    if (!ok) return;
    try {
      const { error } = await supabase.from("pets").delete().eq("id", id);
      if (error) throw error;
      await refreshAllBoards(tab);
      showToast("🗑️ 已刪除案件", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "刪除失敗";
      showToast(msg);
    }
  };

  const onApprove = async (pet: PetRow) => {
    if (!Number.isFinite(pet.latitude) || !Number.isFinite(pet.longitude)) {
      showToast("此案件仍未補全座標，請先按「編輯/補全座標」。");
      return;
    }
    try {
      const resolvedDistrict =
        pet.latitude != null && pet.longitude != null
          ? await reverseGeocodeDistrict(pet.latitude, pet.longitude)
          : null;
      const res = await fetch(`/api/admin/pets/${encodeURIComponent(pet.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "approved",
          district: resolvedDistrict ?? pet.district ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "更新失敗");
      }
      await refreshAllBoards("approved");
      showToast("✅ 已批准上線", "success");
      await broadcastDistrictEvent(resolvedDistrict ?? pet.district, "NEW_CASE", {
        petId: pet.id,
        petName: pet.pet_name,
        imageUrl: pet.image_url,
        address: getDisplayAddress(pet.location, pet.manual_address),
        district: resolvedDistrict ?? pet.district ?? null,
        latitude: pet.latitude,
        longitude: pet.longitude,
      });
      try {
        await fetch("/api/push/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "NEW_CASE", petId: pet.id }),
        });
      } catch {}
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "更新失敗";
      showToast(msg);
    }
  };

  const handleAdminImageUpload = async (file?: File) => {
    if (!file) return;
    try {
      validatePetImageFile(file);
      setUploadingImage(true);
      const publicUrl = await uploadPetImage(supabase, file, { folder: "admin" });
      setForm((p) => ({ ...p, image_url: publicUrl }));
      showToast("📸 圖片已成功上傳", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "圖片上傳失敗";
      showToast(msg);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAdminAddressSearch = async () => {
    const query = String(form.manual_address || "").trim();
    if (!query) {
      showToast("請先輸入具體地址。");
      return;
    }
    try {
      setSearchingAddress(true);
      const result = await geocodeHongKongAddress(query);
      if (!result) {
        showToast("找不到該地址，系統會保留此手動地址供後台審批參考。");
        return;
      }
      setForm((p) => ({
        ...p,
        latitude: result.lat,
        longitude: result.lng,
      }));
      showToast("📍 地址搜尋成功，已自動帶入經緯度。", "success");
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : "地址搜尋失敗，請稍後再試。";
      showToast(msg);
    } finally {
      setSearchingAddress(false);
    }
  };

  const handleEditingImageUpload = async (file?: File) => {
    if (!file || !editingPet) return;
    try {
      validatePetImageFile(file);
      setEditingUploadingImage(true);
      const publicUrl = await uploadPetImage(supabase, file, { folder: "admin" });
      setEditingPet((prev) => (prev ? { ...prev, image_url: publicUrl } : prev));
      showToast("📸 已成功替換案件圖片", "success");
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "圖片替換失敗";
      showToast(msg);
    } finally {
      setEditingUploadingImage(false);
    }
  };

  const editMarkerIcon = useMemo(() => {
    if (!leafletModule) return undefined;
    return buildAdminEditIcon(leafletModule);
  }, [leafletModule]);

  const editingMarkerPosition = useMemo<[number, number] | null>(() => {
    try {
      const lat = parseLeafletCoordinate(editingPet?.latitude);
      const lng = parseLeafletCoordinate(editingPet?.longitude);
      if (lat == null || lng == null) return null;
      return [lat, lng];
    } catch (error) {
      console.error("Failed to parse admin marker coordinates:", editingPet?.id, error);
      return null;
    }
  }, [editingPet?.latitude, editingPet?.longitude]);

  const safeEditingMapCenter = useMemo<[number, number]>(() => {
    const lat = parseLeafletCoordinate(editingMapFocus?.center?.[0]);
    const lng = parseLeafletCoordinate(editingMapFocus?.center?.[1]);
    return lat != null && lng != null ? [lat, lng] : [22.3193, 114.1694];
  }, [editingMapFocus?.center]);

  const guidePlaceFormMarkerPosition = useMemo<[number, number] | null>(() => {
    const lat = parseOptionalCoordinate(guidePlaceForm.latitude);
    const lng = parseOptionalCoordinate(guidePlaceForm.longitude);
    return lat != null && lng != null ? [lat, lng] : null;
  }, [guidePlaceForm.latitude, guidePlaceForm.longitude]);

  const guidePlaceEditFormMarkerPosition = useMemo<[number, number] | null>(() => {
    const lat = parseOptionalCoordinate(guidePlaceEditForm.latitude);
    const lng = parseOptionalCoordinate(guidePlaceEditForm.longitude);
    return lat != null && lng != null ? [lat, lng] : null;
  }, [guidePlaceEditForm.latitude, guidePlaceEditForm.longitude]);

  const stagedPlaceEditFormMarkerPosition = useMemo<[number, number] | null>(() => {
    const lat = parseOptionalCoordinate(stagedPlaceEditForm.latitude);
    const lng = parseOptionalCoordinate(stagedPlaceEditForm.longitude);
    return lat != null && lng != null ? [lat, lng] : null;
  }, [stagedPlaceEditForm.latitude, stagedPlaceEditForm.longitude]);

  const safeGuidePlaceFormMapCenter = useMemo<[number, number]>(() => {
    const lat = guidePlaceFormMapFocus?.center?.[0];
    const lng = guidePlaceFormMapFocus?.center?.[1];
    if (lat != null && lng != null) return [lat, lng];
    return guidePlaceFormMarkerPosition ?? [22.3193, 114.1694];
  }, [guidePlaceFormMapFocus?.center, guidePlaceFormMarkerPosition]);

  const safeGuidePlaceEditFormMapCenter = useMemo<[number, number]>(() => {
    const lat = guidePlaceEditFormMapFocus?.center?.[0];
    const lng = guidePlaceEditFormMapFocus?.center?.[1];
    if (lat != null && lng != null) return [lat, lng];
    return guidePlaceEditFormMarkerPosition ?? [22.3193, 114.1694];
  }, [guidePlaceEditFormMapFocus?.center, guidePlaceEditFormMarkerPosition]);

  const safeStagedPlaceEditFormMapCenter = useMemo<[number, number]>(() => {
    const lat = stagedPlaceEditFormMapFocus?.center?.[0];
    const lng = stagedPlaceEditFormMapFocus?.center?.[1];
    if (lat != null && lng != null) return [lat, lng];
    return stagedPlaceEditFormMarkerPosition ?? [22.3193, 114.1694];
  }, [stagedPlaceEditFormMapFocus?.center, stagedPlaceEditFormMarkerPosition]);

  const openEditModal = (pet: PetRow) => {
    setEditingPet({ ...pet, source_type: normalizeContactIdentity(pet.source_type, pet.case_type) });
    setEditingTimeline(normalizeTimelineItems(pet.timeline));
    setEditingAddressSearchQuery(String(pet.manual_address || pet.location || "").trim());
    const lat = parseLeafletCoordinate(pet.latitude);
    const lng = parseLeafletCoordinate(pet.longitude);
    if (lat != null && lng != null) {
      setEditingMapFocus({ center: [lat, lng], zoom: 17 });
      return;
    }
    setEditingMapFocus({ center: [22.3193, 114.1694], zoom: 12 });
  };

  const closeEditModal = () => {
    setEditingPet(null);
    setEditingTimeline([]);
    setEditingAddressSearchQuery("");
    setEditingMapFocus(null);
  };

  const updateEditingPet = <K extends keyof PetRow>(key: K, value: PetRow[K]) => {
    setEditingPet((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateEditingTimeline = (index: number, key: keyof PetTimelineItem, value: string) => {
    setEditingTimeline((prev) =>
      prev.map((t, idx) => (idx === index ? { ...t, [key]: value } : t)),
    );
  };

  const addEditingTimelineItem = () => {
    setEditingTimeline((prev) => [...prev, { time: "", text: "" }]);
  };

  const deleteEditingTimelineItem = (index: number) => {
    setEditingTimeline((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleEditMapPick = ({ lat, lng }: { lat: number; lng: number }) => {
    setEditingPet((prev) => (prev ? { ...prev, latitude: lat, longitude: lng } : prev));
    setEditingMapFocus({ center: [lat, lng], zoom: 17 });
    showToast("📍 已為此案件補上地圖座標", "success");
  };

  const handleEditAddressSearch = async () => {
    const query = editingAddressSearchQuery.trim();
    if (!query) {
      showToast("請先輸入要搜尋的地址。");
      return;
    }
    try {
      setEditingSearchingAddress(true);
      const result = await geocodeAddressWithNominatim(query);
      if (!result) {
        showToast("找不到該地址，請改用小地圖手動落針。");
        return;
      }
      setEditingPet((prev) =>
        prev
          ? {
              ...prev,
              latitude: result.lat,
              longitude: result.lng,
              manual_address: String(prev.manual_address || "").trim() ? prev.manual_address : query,
            }
          : prev,
      );
      setEditingMapFocus({ center: [result.lat, result.lng], zoom: 17 });
      showToast("📍 已根據搜尋地址自動定位", "success");
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : "地址搜尋失敗，請稍後再試。";
      showToast(msg);
    } finally {
      setEditingSearchingAddress(false);
    }
  };

  const saveEditedPet = async (approveAfterSave: boolean) => {
    if (!editingPet || editingSaving) return;
    const manualAddress = String(editingPet.manual_address || "").trim();
    const locationText = getDisplayAddress(editingPet.location, manualAddress) || "";
    const hasCoordinates =
      Number.isFinite(editingPet.latitude) && Number.isFinite(editingPet.longitude);

    if (!editingPet.pet_name || !editingPet.lost_time || !locationText) {
      showToast("請先補齊：寵物名字 / 地點 / 時間。");
      return;
    }
    const identity = normalizeContactIdentity(editingPet.source_type, editingPet.case_type);
    const alignedCaseType = getDefaultCaseTypeForIdentity(identity);
    if (needsSourceLink(identity) && !String(editingPet.source_link || "").trim()) {
      showToast("社交媒體轉貼案件請補上原帖連結。");
      return;
    }
    const nextStatus: PetStatus = approveAfterSave ? "approved" : editingPet.status;
    if (nextStatus === "approved" && !hasCoordinates) {
      showToast("批准上線前，請先補全有效座標。");
      return;
    }

    setEditingSaving(true);
    try {
      const sourceLinkTrimmed = String(editingPet.source_link || "").trim();
      const resolvedDistrict =
        hasCoordinates && editingPet.latitude != null && editingPet.longitude != null
          ? await reverseGeocodeDistrict(editingPet.latitude, editingPet.longitude)
          : null;
      const updatePayload: Partial<PetInsert> = {
        pet_name: editingPet.pet_name,
        pet_type: editingPet.pet_type,
        breed: editingPet.breed,
        location: locationText,
        manual_address: manualAddress || null,
        district: resolvedDistrict ?? editingPet.district ?? null,
        lost_time: editingPet.lost_time,
        features: editingPet.features,
        phone: editingPet.phone,
        enable_privacy: editingPet.enable_privacy,
        image_url: editingPet.image_url,
        source_type: identity,
        source_link: needsSourceLink(identity) ? sourceLinkTrimmed || null : null,
        source_url:
          needsSourceLink(identity) && sourceLinkTrimmed
            ? sourceLinkTrimmed
            : editingPet.source_url || `daydaypet://admin/${editingPet.id}`,
        case_type: alignedCaseType,
        latitude: hasCoordinates ? editingPet.latitude : null,
        longitude: hasCoordinates ? editingPet.longitude : null,
        timeline: normalizeTimelineItems(editingTimeline),
        status: nextStatus,
      };

      const res = await fetch(`/api/admin/pets/${encodeURIComponent(editingPet.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "儲存修改失敗");
      }

      closeEditModal();
      await refreshAllBoards(nextStatus);
      if (nextStatus === "approved") {
        showToast("✅ 已儲存修改並直接批准上線", "success");
      } else {
        showToast("💾 已儲存案件修改", "success");
      }

      if (editingPet.status !== "approved" && nextStatus === "approved") {
        await broadcastDistrictEvent(resolvedDistrict ?? editingPet.district, "NEW_CASE", {
          petId: editingPet.id,
          petName: editingPet.pet_name,
          imageUrl: editingPet.image_url,
          address: locationText,
          district: resolvedDistrict ?? editingPet.district ?? null,
          latitude: updatePayload.latitude,
          longitude: updatePayload.longitude,
        });
        try {
          await fetch("/api/push/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "NEW_CASE", petId: editingPet.id }),
          });
        } catch {}
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "儲存修改失敗";
      showToast(msg);
    } finally {
      setEditingSaving(false);
    }
  };

  const saveSystemSettings = async () => {
    if (savingSystemSettings) return;
    setSavingSystemSettings(true);
    try {
      const res = await fetch("/api/admin/system-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(systemSettings),
      });
      const data = (await res.json()) as {
        error?: string;
        settings?: Record<keyof SystemSettingsForm, { value: string }>;
      };
      if (!res.ok) {
        throw new Error(data.error || "儲存系統設定失敗");
      }
      if (data.settings) {
        setSystemSettings({
          admin_whatsapp_number:
            data.settings.admin_whatsapp_number?.value ?? systemSettings.admin_whatsapp_number,
          template_admin_notification:
            data.settings.template_admin_notification?.value ?? systemSettings.template_admin_notification,
          template_citizen_approved:
            data.settings.template_citizen_approved?.value ?? systemSettings.template_citizen_approved,
        });
      }
      showToast("✅ 系統設定已更新", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "儲存系統設定失敗";
      showToast(message);
    } finally {
      setSavingSystemSettings(false);
    }
  };

  return (
    <div className="min-h-[100svh] bg-slate-50">
      <AppToast message={toastMessage} tone={toastTone} onClose={() => setToastMessage(null)} />
      <div className="border-b border-slate-200 bg-white">
        <div className="w-full px-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="text-lg font-black text-slate-900">Admin Dashboard</div>
            <div className="text-xs font-semibold text-slate-500">
              手動入料 / 審批 / 刪除（RLS + Supabase Auth）
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "board" as const, label: "🚨 案件審批看板" },
                { key: "sos-breeds" as const, label: "🐾 SOS品種管理" },
                { key: "guide-categories" as const, label: "📖 指南分類管理" },
                { key: "facility-tags" as const, label: "🏷️ 設施標籤管理" },
                { key: "staged-places" as const, label: "🧾 數據審核控制台" },
                { key: "scraper-jobs" as const, label: "🕷️ 爬蟲任務執行" },
                { key: "guide-places" as const, label: "📍 指南地點管理" },
                { key: "system" as const, label: "⚙️ 系統與通訊設定" },
              ].map((item) => {
                const active = activeDashboardTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveDashboardTab(item.key)}
                    className={[
                      "rounded-2xl px-4 py-3 text-sm font-black transition",
                      "ring-1 shadow-sm",
                      active
                        ? "bg-slate-900 text-white ring-slate-900"
                        : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-12">
        <div
          className={[
            activeDashboardTab === "board"
              ? showManualEntryForm
                ? "order-2 lg:col-span-12"
                : "hidden"
              : "lg:col-span-12",
          ].join(" ")}
        >
          <div
            className={[
              activeDashboardTab === "system" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">WhatsApp 免費通知橋接器</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  用備用 WhatsApp 號碼掃描 QR Code 後，系統可免費自動通知主人。
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900"
              >
                重新整理
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="text-sm font-black text-slate-900">
                狀態：{whatsappStatus?.enabled ? whatsappStatus.state : "disabled"}
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-500">
                {!whatsappStatus?.enabled
                  ? "請先在 .env.local 設定 WHATSAPP_WEB_ENABLED=true，系統才會初始化 QR 綁定。"
                  : whatsappStatus.state === "cloud_deployed" && whatsappStatus.notice
                    ? whatsappStatus.notice
                  : whatsappStatus.accountLabel
                    ? `目前已綁定：${whatsappStatus.accountLabel}`
                    : "若狀態為 qr_ready，請用備用 WhatsApp 掃描下方 QR。"}
              </div>
              {whatsappStatus?.notice && whatsappStatus.state === "cloud_deployed" ? (
                <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                  {whatsappStatus.notice}
                </div>
              ) : null}
              {whatsappStatus?.lastError ? (
                <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                  {whatsappStatus.lastError}
                </div>
              ) : null}
              {whatsappStatus?.qrDataUrl ? (
                <div className="mt-4 flex justify-center">
                  <Image
                    src={whatsappStatus.qrDataUrl}
                    alt="WhatsApp QR Code"
                    width={220}
                    height={220}
                    className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"
                    unoptimized
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={[
              activeDashboardTab === "system" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">⚙️ 系統參數與通知設定</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  直接修改管理員號碼與 WhatsApp 通知範本，儲存後即時寫入 Supabase。
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900"
              >
                重新整理
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <div className="text-sm font-bold text-slate-700">管理員 WhatsApp 號碼</div>
                <input
                  value={systemSettings.admin_whatsapp_number}
                  onChange={(e) =>
                    setSystemSettings((prev) => ({ ...prev, admin_whatsapp_number: e.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="85293597785"
                />
              </label>

              <label className="block">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-slate-700">管理員通知範本</div>
                  <div className="text-[11px] font-semibold text-slate-500">
                    可用變數：`${"{pet_name}"}` `${"{description}"}` `${"{admin_url}"}`
                  </div>
                </div>
                <textarea
                  value={systemSettings.template_admin_notification}
                  onChange={(e) =>
                    setSystemSettings((prev) => ({
                      ...prev,
                      template_admin_notification: e.target.value,
                    }))
                  }
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                />
              </label>

              <label className="block">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-slate-700">市民上架通知範本</div>
                  <div className="text-[11px] font-semibold text-slate-500">
                    可用變數：`${"{pet_name}"}` `${"{pet_url}"}`
                  </div>
                </div>
                <textarea
                  value={systemSettings.template_citizen_approved}
                  onChange={(e) =>
                    setSystemSettings((prev) => ({
                      ...prev,
                      template_citizen_approved: e.target.value,
                    }))
                  }
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-500">
                  {loadingSystemSettings ? "讀取系統設定中…" : "修改後會立即影響後續 WhatsApp 通知內容。"}
                </div>
                <button
                  type="button"
                  onClick={saveSystemSettings}
                  disabled={savingSystemSettings || loadingSystemSettings}
                  className={[
                    "rounded-2xl px-5 py-3 text-sm font-black text-white transition",
                    savingSystemSettings || loadingSystemSettings
                      ? "cursor-not-allowed bg-slate-400"
                      : "bg-slate-900 hover:bg-slate-800",
                  ].join(" ")}
                >
                  {savingSystemSettings ? "儲存中…" : "儲存設定"}
                </button>
              </div>
            </div>
          </div>

          <div
            className={[
              activeDashboardTab === "sos-breeds" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">🐾 品種數據管理中心</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  管理 SOS 表單的貓/狗/雀鳥細分品種（新增 / 刪除 / 排序）
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadPetBreeds()}
                disabled={loadingPetBreeds}
                className={[
                  "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                  loadingPetBreeds ? "opacity-70" : "",
                ].join(" ")}
              >
                重新整理
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="block">
                  <div className="text-xs font-bold text-slate-600">篩選大類</div>
                  <select
                    value={petBreedsFilter}
                    onChange={(e) =>
                      setPetBreedsFilter(
                        e.target.value === "cat" ? "cat" : e.target.value === "dog" ? "dog" : e.target.value === "bird" ? "bird" : "all",
                      )
                    }
                    className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  >
                    <option value="all">全部</option>
                    <option value="cat">貓</option>
                    <option value="dog">狗</option>
                    <option value="bird">雀鳥</option>
                  </select>
                </label>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">大類</div>
                    <select
                      value={petBreedForm.pet_type}
                      onChange={(e) =>
                        setPetBreedForm((prev) => ({
                          ...prev,
                          pet_type: e.target.value === "cat" ? "cat" : e.target.value === "bird" ? "bird" : "dog",
                        }))
                      }
                      className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    >
                      <option value="dog">狗</option>
                      <option value="cat">貓</option>
                      <option value="bird">雀鳥</option>
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">品種名稱</div>
                    <input
                      value={petBreedForm.breed_name}
                      onChange={(e) => setPetBreedForm((prev) => ({ ...prev, breed_name: e.target.value }))}
                      className="mt-2 w-[240px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="例如：唐狗 / 雞尾鸚鵡"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">排序</div>
                    <input
                      value={petBreedForm.sort_order}
                      onChange={(e) => setPetBreedForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                      className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      inputMode="numeric"
                      placeholder="100"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void createPetBreed()}
                    disabled={addingPetBreed}
                    className={[
                      "mt-6 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm",
                      addingPetBreed ? "opacity-70" : "hover:bg-emerald-700",
                    ].join(" ")}
                  >
                    {addingPetBreed ? "新增中…" : "➕ 新增品種"}
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                <div className="grid grid-cols-[84px_70px_1fr_190px] gap-2 bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">
                  <div>排序</div>
                  <div>大類</div>
                  <div>品種</div>
                  <div className="text-right">操作</div>
                </div>
                <div className="max-h-[340px] overflow-y-auto bg-white">
                  {loadingPetBreeds ? (
                    <div className="px-4 py-4 text-sm font-semibold text-slate-500">讀取中…</div>
                  ) : filteredPetBreeds.length === 0 ? (
                    <div className="px-4 py-4 text-sm font-semibold text-slate-500">目前沒有品種資料</div>
                  ) : (
                    filteredPetBreeds.map((row) => {
                      const label = row.pet_type === "cat" ? "貓" : row.pet_type === "bird" ? "雀鳥" : "狗";
                      const deleting = deletingPetBreedId === row.id;
                      const editing = editingPetBreedId === row.id;
                      const saving = savingPetBreedId === row.id;
                      return (
                        <div
                          key={row.id}
                          className="grid grid-cols-[84px_70px_1fr_190px] items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm"
                        >
                          <div className="font-black text-slate-900">{row.sort_order}</div>
                          <div className="font-semibold text-slate-700">{label}</div>
                          <div>
                            {editing ? (
                              <input
                                value={petBreedEditForm.breed_name}
                                onChange={(e) => setPetBreedEditForm({ breed_name: e.target.value })}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                              />
                            ) : (
                              <div className="font-semibold text-slate-900">{row.breed_name}</div>
                            )}
                          </div>
                          <div className="flex justify-end gap-2">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void savePetBreedEdit(row)}
                                  disabled={Boolean(savingPetBreedId)}
                                  className={[
                                    "rounded-xl px-3 py-2 text-xs font-black text-white",
                                    saving ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                  ].join(" ")}
                                >
                                  {saving ? "儲存中…" : "儲存"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditPetBreed}
                                  disabled={Boolean(savingPetBreedId)}
                                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-200"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditPetBreed(row)}
                                  disabled={Boolean(deletingPetBreedId) || Boolean(savingPetBreedId)}
                                  className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700"
                                >
                                  ✏️ 編輯
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deletePetBreed(row)}
                                  disabled={Boolean(deletingPetBreedId) || Boolean(savingPetBreedId)}
                                  className={[
                                    "rounded-xl px-3 py-2 text-xs font-black text-white",
                                    deleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700",
                                  ].join(" ")}
                                >
                                  {deleting ? "刪除中…" : "🗑️ 刪除"}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          <div
            className={[
              activeDashboardTab === "guide-categories" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">📖 寵物指南分類管理中心</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  動態管理前台「香港寵物指南」的大分類與子分類篩選按鈕
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refreshGuideTaxonomy()}
                disabled={loadingGuideCategories || loadingGuideSubcategories}
                className={[
                  "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                  loadingGuideCategories || loadingGuideSubcategories ? "opacity-70" : "",
                ].join(" ")}
              >
                重新整理
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-900">大分類管理</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">新增 / 刪除分類名稱、Emoji 與排序</div>

                <div className="mt-4 flex flex-wrap items-end gap-2">
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">Emoji</div>
                    <select
                      value={guideCategoryForm.icon}
                      onChange={(e) => setGuideCategoryForm((prev) => ({ ...prev, icon: e.target.value }))}
                      className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    >
                      {GUIDE_CATEGORY_ICON_OPTIONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">分類名稱</div>
                    <input
                      value={guideCategoryForm.name}
                      onChange={(e) => setGuideCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="mt-2 w-[220px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="例如：獸醫 / 寵物美容"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">排序</div>
                    <input
                      value={guideCategoryForm.sort_order}
                      onChange={(e) => setGuideCategoryForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                      className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      inputMode="numeric"
                      placeholder="100"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void createGuideCategory()}
                    disabled={addingGuideCategory}
                    className={[
                      "mt-6 rounded-2xl bg-orange-600 px-5 py-3 text-sm font-black text-white shadow-sm",
                      addingGuideCategory ? "opacity-70" : "hover:bg-orange-700",
                    ].join(" ")}
                  >
                    {addingGuideCategory ? "新增中…" : "➕ 新增大分類"}
                  </button>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                  <div className="grid grid-cols-[76px_120px_1fr_190px] gap-2 bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">
                    <div>排序</div>
                    <div>Emoji</div>
                    <div>名稱</div>
                    <div className="text-right">操作</div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto bg-white">
                    {loadingGuideCategories ? (
                      <div className="px-4 py-4 text-sm font-semibold text-slate-500">讀取中…</div>
                    ) : guideCategories.length === 0 ? (
                      <div className="px-4 py-4 text-sm font-semibold text-slate-500">目前沒有指南大分類</div>
                    ) : (
                      guideCategories.map((row) => {
                        const deleting = deletingGuideCategoryId === row.id;
                        const editing = editingGuideCategoryId === row.id;
                        const saving = savingGuideCategoryId === row.id;
                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-[76px_120px_1fr_190px] items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm"
                          >
                            <div className="font-black text-slate-900">{row.sort_order}</div>
                            <div>
                              {editing ? (
                                <select
                                  value={guideCategoryEditForm.icon}
                                  onChange={(e) =>
                                    setGuideCategoryEditForm((prev) => ({ ...prev, icon: e.target.value }))
                                  }
                                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                                >
                                  {GUIDE_CATEGORY_ICON_OPTIONS.map((icon) => (
                                    <option key={icon} value={icon}>
                                      {icon}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="text-xl">{row.icon}</div>
                              )}
                            </div>
                            <div>
                              {editing ? (
                                <input
                                  value={guideCategoryEditForm.name}
                                  onChange={(e) =>
                                    setGuideCategoryEditForm((prev) => ({ ...prev, name: e.target.value }))
                                  }
                                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                                />
                              ) : (
                                <div className="font-semibold text-slate-900">{row.name}</div>
                              )}
                            </div>
                            <div className="flex justify-end gap-2">
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void saveGuideCategoryEdit(row)}
                                    disabled={Boolean(savingGuideCategoryId)}
                                    className={[
                                      "rounded-xl px-3 py-2 text-xs font-black text-white",
                                      saving ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                    ].join(" ")}
                                  >
                                    {saving ? "儲存中…" : "儲存"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditGuideCategory}
                                    disabled={Boolean(savingGuideCategoryId)}
                                    className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-200"
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEditGuideCategory(row)}
                                    disabled={Boolean(deletingGuideCategoryId) || Boolean(savingGuideCategoryId)}
                                    className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700"
                                  >
                                    ✏️ 編輯
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteGuideCategory(row)}
                                    disabled={Boolean(deletingGuideCategoryId) || Boolean(savingGuideCategoryId)}
                                    className={[
                                      "rounded-xl px-3 py-2 text-xs font-black text-white",
                                      deleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700",
                                    ].join(" ")}
                                  >
                                    {deleting ? "刪除中…" : "🗑️ 刪除"}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-900">子分類管理</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">先選所屬大分類，再新增 / 刪除次級篩選</div>

                <div className="mt-4 flex flex-wrap items-end gap-2">
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">所屬大分類</div>
                    <select
                      value={guideSubcategoryForm.category_id}
                      onChange={(e) => setGuideSubcategoryForm((prev) => ({ ...prev, category_id: e.target.value }))}
                      className="mt-2 min-w-[180px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      disabled={guideCategories.length === 0}
                    >
                      {guideCategories.length === 0 ? <option value="">請先新增大分類</option> : null}
                      {guideCategories.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.icon} {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">子分類名稱</div>
                    <input
                      value={guideSubcategoryForm.name}
                      onChange={(e) => setGuideSubcategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="mt-2 w-[220px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="例如：24小時急症 / 幼犬社交"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">排序</div>
                    <input
                      value={guideSubcategoryForm.sort_order}
                      onChange={(e) => setGuideSubcategoryForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                      className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      inputMode="numeric"
                      placeholder="100"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void createGuideSubcategory()}
                    disabled={addingGuideSubcategory || guideCategories.length === 0}
                    className={[
                      "mt-6 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm",
                      addingGuideSubcategory || guideCategories.length === 0 ? "opacity-70" : "hover:bg-emerald-700",
                    ].join(" ")}
                  >
                    {addingGuideSubcategory ? "新增中…" : "➕ 新增子分類"}
                  </button>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                  <div className="grid grid-cols-[72px_1fr_1fr_190px] gap-2 bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">
                    <div>排序</div>
                    <div>所屬分類</div>
                    <div>子分類</div>
                    <div className="text-right">操作</div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto bg-white">
                    {loadingGuideSubcategories ? (
                      <div className="px-4 py-4 text-sm font-semibold text-slate-500">讀取中…</div>
                    ) : guideSubcategoriesWithCategory.length === 0 ? (
                      <div className="px-4 py-4 text-sm font-semibold text-slate-500">目前沒有指南子分類</div>
                    ) : (
                      guideSubcategoriesWithCategory.map((row) => {
                        const deleting = deletingGuideSubcategoryId === row.id;
                        const editing = editingGuideSubcategoryId === row.id;
                        const saving = savingGuideSubcategoryId === row.id;
                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-[72px_1fr_1fr_190px] items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm"
                          >
                            <div className="font-black text-slate-900">{row.sort_order}</div>
                            <div>
                              {editing ? (
                                <select
                                  value={guideSubcategoryEditForm.category_id}
                                  onChange={(e) =>
                                    setGuideSubcategoryEditForm((prev) => ({ ...prev, category_id: e.target.value }))
                                  }
                                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                                >
                                  {guideCategories.map((category) => (
                                    <option key={category.id} value={category.id}>
                                      {category.icon} {category.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="font-semibold text-slate-700">
                                  {row.category_icon} {row.category_name}
                                </div>
                              )}
                            </div>
                            <div>
                              {editing ? (
                                <input
                                  value={guideSubcategoryEditForm.name}
                                  onChange={(e) =>
                                    setGuideSubcategoryEditForm((prev) => ({ ...prev, name: e.target.value }))
                                  }
                                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                                />
                              ) : (
                                <div className="font-semibold text-slate-900">{row.name}</div>
                              )}
                            </div>
                            <div className="flex justify-end gap-2">
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void saveGuideSubcategoryEdit(row)}
                                    disabled={Boolean(savingGuideSubcategoryId)}
                                    className={[
                                      "rounded-xl px-3 py-2 text-xs font-black text-white",
                                      saving ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                    ].join(" ")}
                                  >
                                    {saving ? "儲存中…" : "儲存"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditGuideSubcategory}
                                    disabled={Boolean(savingGuideSubcategoryId)}
                                    className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-200"
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEditGuideSubcategory(row)}
                                    disabled={Boolean(deletingGuideSubcategoryId) || Boolean(savingGuideSubcategoryId)}
                                    className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700"
                                  >
                                    ✏️ 編輯
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteGuideSubcategory(row)}
                                    disabled={Boolean(deletingGuideSubcategoryId) || Boolean(savingGuideSubcategoryId)}
                                    className={[
                                      "rounded-xl px-3 py-2 text-xs font-black text-white",
                                      deleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700",
                                    ].join(" ")}
                                  >
                                    {deleting ? "刪除中…" : "🗑️ 刪除"}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className={[
              activeDashboardTab === "facility-tags" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">🏷️ 設施標籤管理</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  動態管理「寵物公園」設施標籤（新增 / 編輯 / 隱藏），爬蟲與前台會直接讀取此配置
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadFacilityTags()}
                disabled={loadingFacilityTags}
                className={[
                  "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                  loadingFacilityTags ? "opacity-70" : "",
                ].join(" ")}
              >
                重新整理
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-900">新增標籤</div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">Icon</div>
                    <input
                      value={facilityTagForm.icon}
                      onChange={(e) => setFacilityTagForm((prev) => ({ ...prev, icon: e.target.value }))}
                      className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="🌳"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">名稱</div>
                    <input
                      value={facilityTagForm.name}
                      onChange={(e) => setFacilityTagForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="mt-2 w-[220px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="例如：設有飲水機"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">排序</div>
                    <input
                      value={facilityTagForm.sort_order}
                      onChange={(e) => setFacilityTagForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                      className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      inputMode="numeric"
                      placeholder="100"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-bold text-slate-600">關鍵字 (CSV)</div>
                    <input
                      value={facilityTagForm.match_keywords}
                      onChange={(e) => setFacilityTagForm((prev) => ({ ...prev, match_keywords: e.target.value }))}
                      className="mt-2 w-[340px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="例如：飲水機,water fountain"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void createFacilityTag()}
                    disabled={addingFacilityTag}
                    className={[
                      "rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm",
                      addingFacilityTag ? "opacity-70" : "hover:bg-emerald-700",
                    ].join(" ")}
                  >
                    {addingFacilityTag ? "新增中…" : "➕ 新增標籤"}
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                <div className="grid grid-cols-[84px_70px_1fr_1.5fr_90px_220px] gap-2 bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">
                  <div>排序</div>
                  <div>Icon</div>
                  <div>名稱</div>
                  <div>關鍵字</div>
                  <div>狀態</div>
                  <div className="text-right">操作</div>
                </div>
                <div className="max-h-[420px] overflow-y-auto bg-white">
                  {loadingFacilityTags ? (
                    <div className="px-4 py-4 text-sm font-semibold text-slate-500">讀取中…</div>
                  ) : facilityTags.length === 0 ? (
                    <div className="px-4 py-4 text-sm font-semibold text-slate-500">目前沒有標籤資料</div>
                  ) : (
                    facilityTags.map((row) => {
                      const editing = editingFacilityTagId === row.id;
                      const deleting = deletingFacilityTagId === row.id;
                      const saving = savingFacilityTagId === row.id;
                      const statusLabel = row.is_active ? "啟用" : "隱藏";
                      const keywords = Array.isArray(row.match_keywords) ? row.match_keywords.join(", ") : "";
                      return (
                        <div
                          key={row.id}
                          className="grid grid-cols-[84px_70px_1fr_1.5fr_90px_220px] items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm"
                        >
                          <div className="font-black text-slate-900">{row.sort_order}</div>
                          <div className="text-lg">{row.icon || "🏷️"}</div>
                          <div>
                            {editing ? (
                              <input
                                value={facilityTagEditForm.name}
                                onChange={(e) => setFacilityTagEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                              />
                            ) : (
                              <div className="font-semibold text-slate-900">{row.name}</div>
                            )}
                            {row.legacy_key ? (
                              <div className="mt-1 text-xs font-semibold text-slate-400">legacy: {row.legacy_key}</div>
                            ) : null}
                          </div>
                          <div>
                            {editing ? (
                              <input
                                value={facilityTagEditForm.match_keywords}
                                onChange={(e) =>
                                  setFacilityTagEditForm((prev) => ({ ...prev, match_keywords: e.target.value }))
                                }
                                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                                placeholder="飲水機,water fountain"
                              />
                            ) : (
                              <div className="text-sm font-semibold text-slate-700">{keywords || "—"}</div>
                            )}
                          </div>
                          <div>
                            {editing ? (
                              <label className="inline-flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={facilityTagEditForm.is_active}
                                  onChange={(e) =>
                                    setFacilityTagEditForm((prev) => ({ ...prev, is_active: e.target.checked }))
                                  }
                                  className="h-4 w-4"
                                />
                                <span className="text-xs font-black text-slate-700">啟用</span>
                              </label>
                            ) : (
                              <div className={row.is_active ? "text-xs font-black text-emerald-700" : "text-xs font-black text-slate-400"}>
                                {statusLabel}
                              </div>
                            )}
                          </div>
                          <div className="flex justify-end gap-2">
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void saveFacilityTagEdit(row)}
                                  disabled={Boolean(savingFacilityTagId)}
                                  className={[
                                    "rounded-xl px-3 py-2 text-xs font-black text-white",
                                    saving ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                  ].join(" ")}
                                >
                                  {saving ? "儲存中…" : "儲存"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditFacilityTag}
                                  disabled={Boolean(savingFacilityTagId)}
                                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-200"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditFacilityTag(row)}
                                  disabled={Boolean(deletingFacilityTagId) || Boolean(savingFacilityTagId)}
                                  className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700"
                                >
                                  ✏️ 編輯
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void hideFacilityTag(row)}
                                  disabled={Boolean(deletingFacilityTagId) || Boolean(savingFacilityTagId)}
                                  className={[
                                    "rounded-xl px-3 py-2 text-xs font-black text-white",
                                    deleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700",
                                  ].join(" ")}
                                >
                                  {deleting ? "處理中…" : "🙈 隱藏"}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          <div
            className={[
              activeDashboardTab === "staged-places" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">🧾 數據審核控制台</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  所有外部匯入/爬取資料先進 staged_places，人工審核後才可入庫 guide_places
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void loadStagedPlaces()}
                  disabled={loadingStagedPlaces}
                  className={[
                    "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                    loadingStagedPlaces ? "opacity-70" : "",
                  ].join(" ")}
                >
                  重新整理
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <label className="block w-full lg:max-w-[420px]">
                  <div className="text-xs font-bold text-slate-600">搜尋</div>
                  <input
                    value={stagedPlaceSearchInput}
                    onChange={(e) => setStagedPlaceSearchInput(e.target.value)}
                    placeholder="輸入地點名稱或地區（例如：西貢區 / 公園）"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-600">
                    共 <span className="font-black text-slate-900">{stagedPlaceTotal}</span> 筆
                    <span className="ml-2 text-xs font-semibold text-slate-500">
                      第 {stagedPlacePage} / {stagedPlaceTotalPages} 頁
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStagedPlacePage((prev) => Math.max(1, prev - 1))}
                      disabled={loadingStagedPlaces || stagedPlacePage <= 1}
                      className={[
                        "rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-800 ring-1 ring-slate-200",
                        loadingStagedPlaces || stagedPlacePage <= 1 ? "opacity-50" : "hover:bg-slate-100",
                      ].join(" ")}
                    >
                      上一頁
                    </button>
                    <button
                      type="button"
                      onClick={() => setStagedPlacePage((prev) => Math.min(stagedPlaceTotalPages, prev + 1))}
                      disabled={loadingStagedPlaces || stagedPlacePage >= stagedPlaceTotalPages}
                      className={[
                        "rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-800 ring-1 ring-slate-200",
                        loadingStagedPlaces || stagedPlacePage >= stagedPlaceTotalPages ? "opacity-50" : "hover:bg-slate-100",
                      ].join(" ")}
                    >
                      下一頁
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl ring-1 ring-slate-200">
              <div className="grid grid-cols-[1.1fr_1fr_1.2fr_0.8fr_1fr_260px] items-center gap-2 bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">
                <div>大分類</div>
                <div>子分類</div>
                <div>地點名稱</div>
                <div>地區</div>
                <div>設施標籤</div>
                <div className="text-right">操作</div>
              </div>
              <div className="max-h-[620px] overflow-y-auto bg-white">
                {loadingStagedPlaces ? (
                  <div className="px-4 py-4 text-sm font-semibold text-slate-500">讀取中…</div>
                ) : stagedPlaces.length === 0 ? (
                  <div className="px-4 py-4 text-sm font-semibold text-slate-500">目前沒有待審核資料</div>
                ) : (
                  stagedPlaces.map((row) => {
                    const category = guideCategories.find((item) => item.id === row.category_id);
                    const rowSubcategoryLabels = normalizeGuideSubcategoryIds(
                      row.subcategory_ids?.length ? row.subcategory_ids : [row.subcategory_id],
                    )
                      .map((id) => guideSubcategories.find((item) => item.id === id)?.name ?? null)
                      .filter(Boolean) as string[];
                    const editing = editingStagedPlaceId === row.id;
                    const editingCategory =
                      guideCategories.find((item) => item.id === stagedPlaceEditForm.category_id) ?? null;
                    const showVetMeta = Boolean(editing && editingCategory?.name.includes("獸醫"));
                    const approving = approvingStagedPlaceId === row.id;
                    const rejecting = rejectingStagedPlaceId === row.id;
                    const saving = savingStagedPlaceId === row.id;
                    const features = [
                      row.has_grass ? "草地" : null,
                      row.has_wash_station ? "清洗區" : null,
                      row.has_fencing ? "圍欄" : null,
                      row.has_parking ? "車位" : null,
                    ].filter(Boolean);

                    return (
                      <div key={row.id} className="border-t border-slate-100">
                        <div className="grid grid-cols-[1.1fr_1fr_1.2fr_0.8fr_1fr_260px] items-center gap-2 px-4 py-3 text-sm">
                          <div className="font-semibold text-slate-700">
                            {category ? `${category.icon} ${category.name}` : "未分類"}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {rowSubcategoryLabels.length > 0 ? (
                              rowSubcategoryLabels.map((label) => (
                                <span
                                  key={`${row.id}-${label}`}
                                  className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-black text-sky-700"
                                >
                                  {label}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">未分類</span>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{row.name}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">{row.address}</div>
                            <div className="mt-1 text-[11px] font-semibold text-slate-400">
                              來源：{row.source} · 建立：{formatHongKongDateTime(row.created_at)}
                            </div>
                          </div>
                          <div className="font-semibold text-slate-700">{row.district}</div>
                          <div className="flex flex-wrap gap-1">
                            {features.length > 0 ? (
                              features.map((feature) => (
                                <span
                                  key={`${row.id}-${feature}`}
                                  className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700"
                                >
                                  {feature}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">未設標籤</span>
                            )}
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void approveStagedPlace(row)}
                              disabled={editing || approving || rejecting || saving}
                              className={[
                                "rounded-xl px-3 py-2 text-xs font-black text-white",
                                approving ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                              ].join(" ")}
                            >
                              {approving ? "入庫中…" : "✅ 入庫"}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditStagedPlace(row)}
                              disabled={approving || rejecting || saving}
                              className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700"
                            >
                              ✏️ 編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectStagedPlace(row)}
                              disabled={approving || rejecting || saving}
                              className={[
                                "rounded-xl px-3 py-2 text-xs font-black text-white",
                                rejecting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700",
                              ].join(" ")}
                            >
                              {rejecting ? "處理中…" : "🗑️ 拒絕"}
                            </button>
                          </div>
                        </div>

                        {editing ? (
                          <div className="bg-slate-50 px-4 pb-4 pt-2">
                            <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 xl:grid-cols-2">
                              <label className="block">
                                <div className="text-xs font-bold text-slate-600">大分類</div>
                                <select
                                  value={stagedPlaceEditForm.category_id}
                                  onChange={(e) =>
                                    setStagedPlaceEditForm((prev) => ({
                                      ...prev,
                                      category_id: e.target.value,
                                      subcategory_ids: [],
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                >
                                  {guideCategories.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.icon} {item.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="block">
                                <div className="text-xs font-bold text-slate-600">子分類</div>
                                <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                                  {stagedPlaceEditSubcategoryOptions.length === 0 ? (
                                    <span className="text-xs font-semibold text-slate-400">請先選擇可用子分類</span>
                                  ) : (
                                    stagedPlaceEditSubcategoryOptions.map((item) => {
                                      const checked = stagedPlaceEditForm.subcategory_ids.includes(item.id);
                                      return (
                                        <button
                                          key={item.id}
                                          type="button"
                                          onClick={() => toggleStagedPlaceEditSubcategory(item.id)}
                                          className={[
                                            "rounded-full px-3 py-2 text-xs font-black ring-1 transition",
                                            checked
                                              ? "bg-emerald-600 text-white ring-emerald-600"
                                              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                                          ].join(" ")}
                                        >
                                          {checked ? "✓ " : ""}{item.name}
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              </label>

                              <label className="block">
                                <div className="text-xs font-bold text-slate-600">地點名稱</div>
                                <input
                                  value={stagedPlaceEditForm.name}
                                  onChange={(e) => setStagedPlaceEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                />
                              </label>

                              <label className="block">
                                <div className="text-xs font-bold text-slate-600">地區</div>
                                <select
                                  value={stagedPlaceEditForm.district}
                                  onChange={(e) => setStagedPlaceEditForm((prev) => ({ ...prev, district: e.target.value }))}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                >
                                  {GUIDE_PLACE_DISTRICTS.map((d) => (
                                    <option key={d} value={d}>
                                      {d}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="block xl:col-span-2">
                                <div className="text-xs font-bold text-slate-600">詳細地址</div>
                                <input
                                  value={stagedPlaceEditForm.address}
                                  onChange={(e) => setStagedPlaceEditForm((prev) => ({ ...prev, address: e.target.value }))}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                />
                              </label>

                              <div className="xl:col-span-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={handleStagedPlaceEditFormUseCurrentLocation}
                                  disabled={locatingStagedPlaceEditForm}
                                  className={[
                                    "rounded-2xl px-4 py-3 text-sm font-black text-white",
                                    locatingStagedPlaceEditForm ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                  ].join(" ")}
                                >
                                  {locatingStagedPlaceEditForm ? "定位中…" : "📍 獲取目前手機定位"}
                                </button>
                                <div className="flex items-center text-xs font-semibold leading-relaxed text-slate-500">
                                  可用地圖落針或直接讀取定位，自動填入下方經緯度。
                                </div>
                              </div>

                              <div className="xl:col-span-2 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                                <AdminMiniMap
                                  center={safeStagedPlaceEditFormMapCenter}
                                  zoom={stagedPlaceEditFormMapFocus?.zoom ?? 13}
                                  focusCenter={stagedPlaceEditFormMapFocus?.center ?? null}
                                  focusZoom={stagedPlaceEditFormMapFocus?.zoom}
                                  pickEnabled
                                  onPick={handleStagedPlaceEditFormMapPick}
                                  markerPosition={stagedPlaceEditFormMarkerPosition}
                                  markerIcon={editMarkerIcon}
                                  className="h-56 w-full"
                                />
                              </div>

                              <div className="xl:col-span-2">
                                <div className="text-xs font-bold text-slate-600">地址搜尋</div>
                                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                  <input
                                    value={stagedPlaceEditFormAddressSearchQuery}
                                    onChange={(e) => setStagedPlaceEditFormAddressSearchQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter") return;
                                      e.preventDefault();
                                      void handleStagedPlaceEditFormAddressSearch();
                                    }}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                    placeholder="輸入地址並搜尋定位"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleStagedPlaceEditFormAddressSearch()}
                                    disabled={searchingStagedPlaceEditFormAddress}
                                    className={[
                                      "rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white sm:min-w-[96px]",
                                      searchingStagedPlaceEditFormAddress ? "opacity-70" : "hover:bg-amber-600",
                                    ].join(" ")}
                                  >
                                    {searchingStagedPlaceEditFormAddress ? "搜尋中…" : "搜尋"}
                                  </button>
                                </div>
                              </div>

                              <label className="block">
                                <div className="text-xs font-bold text-slate-600">緯度</div>
                                <input
                                  value={stagedPlaceEditForm.latitude}
                                  onChange={(e) => setStagedPlaceEditForm((prev) => ({ ...prev, latitude: e.target.value }))}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                  placeholder="例如：22.3"
                                />
                              </label>

                              <label className="block">
                                <div className="text-xs font-bold text-slate-600">經度</div>
                                <input
                                  value={stagedPlaceEditForm.longitude}
                                  onChange={(e) => setStagedPlaceEditForm((prev) => ({ ...prev, longitude: e.target.value }))}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                  placeholder="例如：114.1"
                                />
                              </label>

                              <label className="block xl:col-span-2">
                                <div className="text-xs font-bold text-slate-600">營業/開放時間</div>
                                <input
                                  value={stagedPlaceEditForm.opening_hours}
                                  onChange={(e) =>
                                    setStagedPlaceEditForm((prev) => ({ ...prev, opening_hours: e.target.value }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                  placeholder="例如：每日 07:00-23:00"
                                />
                              </label>

                              <div className="block xl:col-span-2">
                                <div className="text-xs font-bold text-slate-600">地點相片</div>
                                <label
                                  className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-emerald-300 hover:bg-emerald-50"
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    void handleStagedPlaceEditImageUpload(e.dataTransfer.files);
                                  }}
                                >
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => void handleStagedPlaceEditImageUpload(e.target.files ?? undefined)}
                                  />
                                  <div className="text-2xl">🖼️</div>
                                  <div className="mt-2 text-sm font-black text-slate-900">
                                    {uploadingStagedPlaceImage ? "相片上傳中…" : "拖放多張圖片到此處，或點擊多選上傳"}
                                  </div>
                                  <div className="mt-1 text-xs font-semibold text-slate-500">
                                    支援 JPG / PNG / WEBP，最多 5MB
                                  </div>
                                </label>

                                {stagedPlaceEditForm.image_urls.length > 0 ? (
                                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                                      {stagedPlaceEditForm.image_urls.map((url, index) => (
                                        <div key={`${url}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                                          <img src={url} alt={`待審核地點預覽 ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                                            <div className="text-[11px] font-black text-slate-500">{index === 0 ? "封面" : `第 ${index + 1} 張`}</div>
                                            <button
                                              type="button"
                                              onClick={() => removeStagedPlaceEditFormImageAt(index)}
                                              className="rounded-xl bg-rose-100 px-2 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-200"
                                            >
                                              刪除
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                <label className="mt-3 block">
                                  <div className="text-xs font-bold text-slate-600">圖片 URL（可手動貼上多條）</div>
                                  <textarea
                                    value={stagedPlaceEditForm.image_urls.join("\n")}
                                    onChange={(e) =>
                                      setStagedPlaceEditForm((prev) => {
                                        const image_urls = normalizeImageUrlList(e.target.value);
                                        return { ...prev, image_urls, image_url: getPrimaryImageUrl(image_urls) };
                                      })
                                    }
                                    rows={4}
                                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                    placeholder={"https://example.com/1.jpg\nhttps://example.com/2.jpg"}
                                  />
                                </label>
                              </div>

                              {showVetMeta ? (
                                <div className="xl:col-span-2 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                                  <div className="text-sm font-black text-slate-900">🩺 獸醫專屬欄位</div>
                                  <div className="mt-1 text-xs font-semibold text-slate-500">
                                    先由管理員補齊基本資訊，服務細節後續可由商戶認領自行完善
                                  </div>

                                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                                    <label className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900">
                                      <input
                                        type="checkbox"
                                        checked={stagedPlaceVetMetaForm.is_24h_emergency}
                                        onChange={(e) =>
                                          setStagedPlaceVetMetaForm((prev) => ({
                                            ...prev,
                                            is_24h_emergency: e.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-slate-300"
                                      />
                                      <span>24 小時急症</span>
                                    </label>

                                    <label className="block">
                                      <div className="text-xs font-bold text-slate-600">預約連結 (booking_url)</div>
                                      <input
                                        value={stagedPlaceVetMetaForm.booking_url}
                                        onChange={(e) =>
                                          setStagedPlaceVetMetaForm((prev) => ({ ...prev, booking_url: e.target.value }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                        placeholder="https://..."
                                      />
                                    </label>

                                    <label className="block xl:col-span-2">
                                      <div className="text-xs font-bold text-slate-600">專科服務 (用逗號分隔)</div>
                                      <input
                                        value={stagedPlaceVetMetaForm.specialist_services}
                                        onChange={(e) =>
                                          setStagedPlaceVetMetaForm((prev) => ({
                                            ...prev,
                                            specialist_services: e.target.value,
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                        placeholder="例如：內科, 外科, 牙科, 針灸"
                                      />
                                    </label>

                                    <label className="block xl:col-span-2">
                                      <div className="text-xs font-bold text-slate-600">支援寵物類型 (用逗號分隔)</div>
                                      <input
                                        value={stagedPlaceVetMetaForm.pet_types_supported}
                                        onChange={(e) =>
                                          setStagedPlaceVetMetaForm((prev) => ({
                                            ...prev,
                                            pet_types_supported: e.target.value,
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                        placeholder="例如：貓, 狗, 珍禽異獸"
                                      />
                                    </label>
                                  </div>
                                </div>
                              ) : null}

                              <div className="xl:col-span-2">
                                <div className="text-xs font-bold text-slate-600">設施標籤</div>
                                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                  {[
                                    { key: "has_grass" as const, label: "有草地" },
                                    { key: "has_wash_station" as const, label: "清洗區" },
                                    { key: "has_fencing" as const, label: "安全圍欄" },
                                    { key: "has_parking" as const, label: "附近車位" },
                                  ].map((item) => (
                                    <label
                                      key={item.key}
                                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={stagedPlaceEditForm[item.key]}
                                        onChange={(e) =>
                                          setStagedPlaceEditForm((prev) => ({
                                            ...prev,
                                            [item.key]: e.target.checked,
                                          }))
                                        }
                                        className="h-4 w-4 rounded border-slate-300"
                                      />
                                      <span>{item.label}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div className="xl:col-span-2 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => void saveStagedPlaceEdit(row)}
                                  disabled={saving}
                                  className={[
                                    "rounded-2xl px-5 py-3 text-sm font-black text-white shadow-sm",
                                    saving ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                  ].join(" ")}
                                >
                                  {saving ? "儲存中…" : "儲存"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditStagedPlace}
                                  disabled={saving}
                                  className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-200"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div
            className={[
              activeDashboardTab === "scraper-jobs" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">🕷️ 爬蟲任務執行</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  直接在後台觸發已優化 `zh-HK` 語言參數的 `vet_scraper.ts`，新資料會自動寫入 staged_places
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVetScraperResult(null)}
                disabled={runningVetScraper || !vetScraperResult}
                className={[
                  "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                  runningVetScraper || !vetScraperResult ? "opacity-50" : "hover:bg-slate-200",
                ].join(" ")}
              >
                清除結果
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:grid-cols-2">
              <label className="block">
                <div className="text-xs font-bold text-slate-600">地區選擇</div>
                <select
                  value={vetScraperForm.district}
                  onChange={(e) => setVetScraperForm((prev) => ({ ...prev, district: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  disabled={runningVetScraper}
                >
                  {HONG_KONG_18_DISTRICTS.map((district) => (
                    <option key={district} value={district}>
                      {district}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="text-xs font-bold text-slate-600">關鍵字選擇</div>
                <select
                  value={vetScraperForm.keyword}
                  onChange={(e) => setVetScraperForm((prev) => ({ ...prev, keyword: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  disabled={runningVetScraper}
                >
                  {VET_SCRAPER_KEYWORD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.hint})
                    </option>
                  ))}
                </select>
              </label>

              {vetScraperForm.keyword === "__custom__" ? (
                <label className="block xl:col-span-2">
                  <div className="text-xs font-bold text-slate-600">自訂關鍵字</div>
                  <input
                    value={vetScraperForm.customKeyword}
                    onChange={(e) => setVetScraperForm((prev) => ({ ...prev, customKeyword: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="例如：exotic animal vet / avian vet"
                    disabled={runningVetScraper}
                  />
                </label>
              ) : null}

              <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    {runningVetScraper ? "正在爬取..." : "準備好後可直接啟動本次獸醫爬蟲任務"}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    執行期間會沿用現有 `vet_scraper.ts` 的 Google Maps + `zh-HK` + Language Missing 驗證流程
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunVetScraper()}
                  disabled={runningVetScraper}
                  className={[
                    "rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm",
                    runningVetScraper ? "opacity-70" : "hover:bg-emerald-700",
                  ].join(" ")}
                >
                  {runningVetScraper ? "爬取中…" : "開始爬取"}
                </button>
              </div>
            </div>

            {vetScraperResult ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-base font-black text-emerald-900">
                  已新增 {vetScraperResult.imported} 筆數據至 staged_places
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-emerald-800">
                  <span>地區：{vetScraperResult.district}</span>
                  <span>關鍵字：{vetScraperResult.keyword}</span>
                  {vetScraperResult.mode ? <span>模式：{vetScraperResult.mode}</span> : null}
                  <span>候選結果：{vetScraperResult.candidates}</span>
                  <span>有效資料：{vetScraperResult.validPlaces}</span>
                </div>
                {vetScraperResult.query ? (
                  <div className="mt-2 text-xs font-semibold text-emerald-800">
                    實際搜尋：<span className="font-black">{vetScraperResult.query}</span>
                  </div>
                ) : null}
                {vetScraperResult.queryAttempts && vetScraperResult.queryAttempts.length > 0 ? (
                  <div className="mt-3 rounded-2xl bg-white/70 p-3 text-xs font-semibold text-slate-700 ring-1 ring-emerald-200">
                    <div className="font-black text-slate-900">查詢嘗試</div>
                    <div className="mt-2 space-y-1">
                      {vetScraperResult.queryAttempts.slice(0, 8).map((row) => (
                        <div key={row.query} className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 truncate">{row.query}</div>
                          <div className="shrink-0 font-black text-slate-900">{row.candidates}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void jumpToStagedPlacesReview()}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
                  >
                    跳轉到審核列表
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadStagedPlaces()}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
                  >
                    重新整理 staged_places
                  </button>
                </div>
                {vetScraperResult.languageWarnings.length > 0 ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
                    提示：本次有 {vetScraperResult.languageWarnings.length} 筆資料被標記為 Language Missing，建議到審核列表人工檢查中文名稱與地址。
                  </div>
                ) : null}
                {vetScraperResult.failures.length > 0 ? (
                  <div className="mt-4 text-xs font-semibold text-slate-500">
                    另有 {vetScraperResult.failures.length} 筆候選資料未通過驗證，已自動略過。
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            className={[
              activeDashboardTab === "guide-places" ? "" : "hidden",
              "mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-900">📍 指南地點管理中心</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  管理香港寵物指南的實體地點、分類歸屬、18 區位置與設施標籤
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleImportParks()}
                  disabled={importingGuideParks}
                  className={[
                    "rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white",
                    importingGuideParks ? "opacity-70" : "hover:bg-emerald-700",
                  ].join(" ")}
                >
                  {importingGuideParks ? "匯入中…" : "🏞️ 匯入政府公園（待審核）"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadGuidePlaces()}
                  disabled={loadingGuidePlaces}
                  className={[
                    "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                    loadingGuidePlaces ? "opacity-70" : "",
                  ].join(" ")}
                >
                  重新整理
                </button>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={openGuidePlaceCreateModal}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
              >
                + 新增指南地點
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <label className="block w-full lg:max-w-[420px]">
                  <div className="text-xs font-bold text-slate-600">搜尋</div>
                  <input
                    value={guidePlaceSearchInput}
                    onChange={(e) => setGuidePlaceSearchInput(e.target.value)}
                    placeholder="輸入地點名稱或地區（例如：西貢區 / 動物醫院）"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-600">
                    共 <span className="font-black text-slate-900">{guidePlaceTotal}</span> 筆
                    <span className="ml-2 text-xs font-semibold text-slate-500">
                      第 {guidePlacePage} / {guidePlaceTotalPages} 頁
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGuidePlacePage((prev) => Math.max(1, prev - 1))}
                      disabled={loadingGuidePlaces || guidePlacePage <= 1}
                      className={[
                        "rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-800 ring-1 ring-slate-200",
                        loadingGuidePlaces || guidePlacePage <= 1 ? "opacity-50" : "hover:bg-slate-100",
                      ].join(" ")}
                    >
                      上一頁
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuidePlacePage((prev) => Math.min(guidePlaceTotalPages, prev + 1))}
                      disabled={loadingGuidePlaces || guidePlacePage >= guidePlaceTotalPages}
                      className={[
                        "rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-800 ring-1 ring-slate-200",
                        loadingGuidePlaces || guidePlacePage >= guidePlaceTotalPages ? "opacity-50" : "hover:bg-slate-100",
                      ].join(" ")}
                    >
                      下一頁
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl ring-1 ring-slate-200">
              <div className="grid grid-cols-[44px_1.1fr_1fr_1.2fr_0.8fr_1fr_190px] items-center gap-2 bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={guidePlaces.length > 0 && selectedGuidePlaceIds.length === guidePlaces.length}
                    onChange={(e) => toggleSelectAllGuidePlaces(e.target.checked)}
                    disabled={guidePlaces.length === 0}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </div>
                <div>大分類</div>
                <div>子分類</div>
                <div>地點名稱</div>
                <div>地區</div>
                <div>設施標籤</div>
                <div className="flex items-center justify-end gap-2">
                  {selectedGuidePlaceIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void bulkDeleteGuidePlaces()}
                      disabled={bulkDeletingGuidePlaces || Boolean(deletingGuidePlaceId) || Boolean(savingGuidePlaceId)}
                      className={[
                        "rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white",
                        bulkDeletingGuidePlaces ? "opacity-70" : "hover:bg-red-700",
                      ].join(" ")}
                    >
                      {bulkDeletingGuidePlaces ? "刪除中…" : `批量刪除 (${selectedGuidePlaceIds.length})`}
                    </button>
                  ) : null}
                  <span className="text-right">操作</span>
                </div>
              </div>
              <div className="max-h-[620px] overflow-y-auto bg-white">
                {loadingGuidePlaces ? (
                  <div className="px-4 py-4 text-sm font-semibold text-slate-500">讀取中…</div>
                ) : guidePlaces.length === 0 ? (
                  <div className="px-4 py-4 text-sm font-semibold text-slate-500">目前沒有指南地點資料</div>
                ) : (
                  guidePlaces.map((row) => {
                    const category = guideCategories.find((item) => item.id === row.category_id);
                    const rowSubcategoryLabels = normalizeGuideSubcategoryIds(
                      row.subcategory_ids?.length ? row.subcategory_ids : [row.subcategory_id],
                    )
                      .map((id) => guideSubcategories.find((item) => item.id === id)?.name ?? null)
                      .filter(Boolean) as string[];
                    const editing = Boolean(editingGuidePlaceId);
                    const editingThisRow = editingGuidePlaceId === row.id;
                    const deleting = deletingGuidePlaceId === row.id;
                    const saving = savingGuidePlaceId === row.id;
                    const tagIds = Array.isArray(row.facility_tag_ids) ? row.facility_tag_ids : [];
                    const tagBadges = tagIds
                      .map((id) => guidePlaceFacilityTagMap.get(id) ?? null)
                      .filter(Boolean) as GuidePlaceFacilityTagOption[];
                    const legacyBadges = [
                      row.has_grass ? { key: "has_grass", label: "🌳 有草地" } : null,
                      row.has_wash_station ? { key: "has_wash_station", label: "🚿 清洗區" } : null,
                      row.has_fencing ? { key: "has_fencing", label: "🧱 圍欄" } : null,
                      row.has_parking ? { key: "has_parking", label: "🚗 車位" } : null,
                    ].filter(Boolean) as Array<{ key: string; label: string }>;

                    return (
                      <div key={row.id} className="border-t border-slate-100">
                        <div className="grid grid-cols-[44px_1.1fr_1fr_1.2fr_0.8fr_1fr_190px] items-center gap-2 px-4 py-3 text-sm">
                          <div className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={selectedGuidePlaceIdSet.has(row.id)}
                              onChange={(e) => toggleSelectGuidePlace(row.id, e.target.checked)}
                              disabled={editing || deleting || saving || bulkDeletingGuidePlaces}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          </div>
                          <div className="font-semibold text-slate-700">
                            {category ? `${category.icon} ${category.name}` : "未分類"}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {rowSubcategoryLabels.length > 0 ? (
                              rowSubcategoryLabels.map((label) => (
                                <span
                                  key={`${row.id}-${label}`}
                                  className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-black text-sky-700"
                                >
                                  {label}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">未分類</span>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{row.name}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">{row.address}</div>
                          </div>
                          <div className="font-semibold text-slate-700">{row.district}</div>
                          <div className="flex flex-wrap gap-1">
                            {tagBadges.length > 0 ? (
                              tagBadges.map((tag) => (
                                <span
                                  key={`${row.id}-${tag.id}`}
                                  className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700"
                                >
                                  {(tag.icon || "🏷️").trim()} {tag.name}
                                </span>
                              ))
                            ) : legacyBadges.length > 0 ? (
                              legacyBadges.map((badge) => (
                                <span
                                  key={`${row.id}-${badge.key}`}
                                  className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700"
                                >
                                  {badge.label}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">未設標籤</span>
                            )}
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => startEditGuidePlace(row)}
                              disabled={
                                Boolean(deletingGuidePlaceId) || Boolean(savingGuidePlaceId) || (editing && !editingThisRow)
                              }
                              className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700"
                            >
                              ✏️ 編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteGuidePlace(row)}
                              disabled={Boolean(deletingGuidePlaceId) || Boolean(savingGuidePlaceId)}
                              className={[
                                "rounded-xl px-3 py-2 text-xs font-black text-white",
                                deleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700",
                              ].join(" ")}
                            >
                              {deleting ? "刪除中…" : "🗑️ 刪除"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {editingGuidePlaceRow ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <div className="text-base font-black text-slate-900">✏️ 編輯寵物公園 / 設施</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">在同一個彈窗完成基本資料與設施標籤設定</div>
                    </div>
                    <button
                      type="button"
                      onClick={cancelEditGuidePlace}
                      disabled={Boolean(savingGuidePlaceId)}
                      className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-900 hover:bg-slate-200"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="max-h-[calc(90vh-150px)] overflow-y-auto px-5 py-5">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-black text-slate-900">基本資料</div>
                        <div className="mt-4 grid grid-cols-1 gap-4">
                          <label className="block">
                            <div className="text-xs font-bold text-slate-600">大分類</div>
                            <select
                              value={guidePlaceEditForm.category_id}
                              onChange={(e) =>
                                setGuidePlaceEditForm((prev) => ({
                                  ...prev,
                                  category_id: e.target.value,
                                  subcategory_ids: [],
                                }))
                              }
                              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                            >
                              {guideCategories.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.icon} {item.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <div className="text-xs font-bold text-slate-600">子分類</div>
                            <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                              {guidePlaceEditSubcategoryOptions.length === 0 ? (
                                <span className="text-xs font-semibold text-slate-400">請先選擇可用子分類</span>
                              ) : (
                                guidePlaceEditSubcategoryOptions.map((item) => {
                                  const checked = guidePlaceEditForm.subcategory_ids.includes(item.id);
                                  return (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onClick={() => toggleGuidePlaceEditSubcategory(item.id)}
                                      className={[
                                        "rounded-full px-3 py-2 text-xs font-black ring-1 transition",
                                        checked
                                          ? "bg-emerald-600 text-white ring-emerald-600"
                                          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                                      ].join(" ")}
                                    >
                                      {checked ? "✓ " : ""}{item.name}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </label>

                          <label className="block">
                            <div className="text-xs font-bold text-slate-600">地點名稱</div>
                            <input
                              value={guidePlaceEditForm.name}
                              onChange={(e) => setGuidePlaceEditForm((prev) => ({ ...prev, name: e.target.value }))}
                              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                            />
                          </label>

                          <label className="block">
                            <div className="text-xs font-bold text-slate-600">地區</div>
                            <select
                              value={guidePlaceEditForm.district}
                              onChange={(e) => setGuidePlaceEditForm((prev) => ({ ...prev, district: e.target.value }))}
                              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                            >
                              {GUIDE_PLACE_DISTRICTS.map((district) => (
                                <option key={district} value={district}>
                                  {district}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <div className="text-xs font-bold text-slate-600">詳細地址</div>
                            <input
                              value={guidePlaceEditForm.address}
                              onChange={(e) => setGuidePlaceEditForm((prev) => ({ ...prev, address: e.target.value }))}
                              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                              placeholder="可填寫地址（選填），定位以座標為準"
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleGuidePlaceEditFormUseCurrentLocation}
                                disabled={locatingGuidePlaceEditForm}
                                className={[
                                  "rounded-2xl px-4 py-3 text-sm font-black text-white",
                                  locatingGuidePlaceEditForm ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                                ].join(" ")}
                              >
                                {locatingGuidePlaceEditForm ? "定位中…" : "📍 獲取目前手機定位"}
                              </button>
                              <div className="flex items-center text-xs font-semibold leading-relaxed text-slate-500">
                                可用地圖落針或直接讀取定位，自動填入下方經緯度。
                              </div>
                            </div>
                          </label>

                          <label className="block">
                            <div className="text-xs font-bold text-slate-600">營業時間</div>
                            <input
                              value={guidePlaceEditForm.opening_hours}
                              onChange={(e) => setGuidePlaceEditForm((prev) => ({ ...prev, opening_hours: e.target.value }))}
                              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                            />
                          </label>

                          <div className="block">
                            <div className="text-xs font-bold text-slate-600">地點相片上傳</div>
                            <label
                              className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-emerald-300 hover:bg-emerald-50"
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                void handleGuidePlaceEditImageUpload(e.dataTransfer.files);
                              }}
                            >
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                multiple
                                className="hidden"
                                onChange={(e) => void handleGuidePlaceEditImageUpload(e.target.files ?? undefined)}
                              />
                              <div className="text-2xl">🖼️</div>
                              <div className="mt-2 text-sm font-black text-slate-900">
                                {uploadingGuidePlaceEditImage ? "相片上傳中…" : "拖放多張圖片到此處，或點擊多選上傳"}
                              </div>
                              <div className="mt-1 text-xs font-semibold text-slate-500">支援 JPG / PNG / WEBP，最多 5MB</div>
                            </label>
                            {guidePlaceEditForm.image_urls.length > 0 ? (
                              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                  {guidePlaceEditForm.image_urls.map((url, index) => (
                                    <div key={`${url}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                                      <img src={url} alt={`指南地點編輯預覽 ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                                        <div className="text-[11px] font-black text-slate-500">{index === 0 ? "封面" : `第 ${index + 1} 張`}</div>
                                        <button
                                          type="button"
                                          onClick={() => removeGuidePlaceEditFormImageAt(index)}
                                          className="rounded-xl bg-rose-100 px-2 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-200"
                                        >
                                          刪除
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                            <AdminMiniMap
                              center={safeGuidePlaceEditFormMapCenter}
                              zoom={guidePlaceEditFormMapFocus?.zoom ?? 13}
                              focusCenter={guidePlaceEditFormMapFocus?.center ?? null}
                              focusZoom={guidePlaceEditFormMapFocus?.zoom}
                              pickEnabled
                              onPick={handleGuidePlaceEditFormMapPick}
                              markerPosition={guidePlaceEditFormMarkerPosition}
                              markerIcon={editMarkerIcon}
                              className="h-56 w-full"
                            />
                          </div>

                          <div className="mt-4">
                            <div className="text-xs font-bold text-slate-600">地址搜尋</div>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                              <input
                                value={guidePlaceEditFormAddressSearchQuery}
                                onChange={(e) => setGuidePlaceEditFormAddressSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key !== "Enter") return;
                                  e.preventDefault();
                                  void handleGuidePlaceEditFormAddressSearch();
                                }}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                placeholder="輸入地址並搜尋定位"
                              />
                              <button
                                type="button"
                                onClick={() => void handleGuidePlaceEditFormAddressSearch()}
                                disabled={searchingGuidePlaceEditFormAddress}
                                className={[
                                  "rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white sm:min-w-[96px]",
                                  searchingGuidePlaceEditFormAddress ? "opacity-70" : "hover:bg-amber-600",
                                ].join(" ")}
                              >
                                {searchingGuidePlaceEditFormAddress ? "搜尋中…" : "搜尋"}
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <div className="text-xs font-bold text-slate-600">緯度</div>
                              <input
                                value={guidePlaceEditForm.latitude}
                                onChange={(e) => setGuidePlaceEditForm((prev) => ({ ...prev, latitude: e.target.value }))}
                                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                              />
                            </label>
                            <label className="block">
                              <div className="text-xs font-bold text-slate-600">經度</div>
                              <input
                                value={guidePlaceEditForm.longitude}
                                onChange={(e) => setGuidePlaceEditForm((prev) => ({ ...prev, longitude: e.target.value }))}
                                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                              />
                            </label>
                          </div>
                          {!guidePlaceEditForm.latitude || !guidePlaceEditForm.longitude ? (
                            <div className="text-xs font-semibold text-amber-700">
                              尚未帶入座標，可按上方「獲取目前手機定位」或點地圖落針。
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-black text-slate-900">設施標籤</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">以 Chip 形式點選即可加入 / 移除</div>
                          </div>
                          <div className="text-xs font-semibold text-slate-500">
                            已選 <span className="font-black text-slate-900">{guidePlaceEditFacilityTagIdSet.size}</span> 個
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {loadingFacilityTags ? (
                            <div className="text-sm font-semibold text-slate-500">讀取中…</div>
                          ) : guidePlaceFacilityTags.length === 0 ? (
                            <div className="text-sm font-semibold text-slate-500">目前沒有可用標籤</div>
                          ) : (
                            guidePlaceFacilityTags.map((tag) => {
                              const selected = guidePlaceEditFacilityTagIdSet.has(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() => toggleGuidePlaceEditFacilityTag(tag)}
                                  className={[
                                    "rounded-full px-4 py-2 text-xs font-black ring-1",
                                    selected
                                      ? "bg-sky-600 text-white ring-sky-700"
                                      : "bg-slate-50 text-slate-800 ring-slate-200 hover:bg-slate-100",
                                  ].join(" ")}
                                >
                                  {(tag.icon || "🏷️").trim()} {tag.name}
                                </button>
                              );
                            })
                          )}
                        </div>

                        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                          <div className="text-sm font-black text-slate-900">＋ 即時新增標籤</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">新增後會自動加入到此公園</div>

                          <div className="mt-4 flex flex-wrap items-end gap-2">
                            <label className="block">
                              <div className="text-xs font-bold text-slate-600">Icon</div>
                              <input
                                value={guidePlaceFacilityTagQuickAddForm.icon}
                                onChange={(e) =>
                                  setGuidePlaceFacilityTagQuickAddForm((prev) => ({ ...prev, icon: e.target.value }))
                                }
                                className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                placeholder="🏷️"
                              />
                            </label>
                            <label className="block">
                              <div className="text-xs font-bold text-slate-600">名稱</div>
                              <input
                                value={guidePlaceFacilityTagQuickAddForm.name}
                                onChange={(e) =>
                                  setGuidePlaceFacilityTagQuickAddForm((prev) => ({ ...prev, name: e.target.value }))
                                }
                                className="mt-2 w-[240px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                placeholder="例如：設有飲水機"
                              />
                            </label>
                            <label className="block">
                              <div className="text-xs font-bold text-slate-600">排序</div>
                              <input
                                value={guidePlaceFacilityTagQuickAddForm.sort_order}
                                onChange={(e) =>
                                  setGuidePlaceFacilityTagQuickAddForm((prev) => ({
                                    ...prev,
                                    sort_order: e.target.value,
                                  }))
                                }
                                className="mt-2 w-[90px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                inputMode="numeric"
                                placeholder="100"
                              />
                            </label>
                            <label className="block">
                              <div className="text-xs font-bold text-slate-600">關鍵字 (CSV)</div>
                              <input
                                value={guidePlaceFacilityTagQuickAddForm.match_keywords}
                                onChange={(e) =>
                                  setGuidePlaceFacilityTagQuickAddForm((prev) => ({
                                    ...prev,
                                    match_keywords: e.target.value,
                                  }))
                                }
                                className="mt-2 w-[320px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                                placeholder="例如：飲水機,water fountain"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void createGuidePlaceFacilityTagInline()}
                              disabled={addingGuidePlaceFacilityTagQuickAdd}
                              className={[
                                "rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm",
                                addingGuidePlaceFacilityTagQuickAdd ? "opacity-70" : "hover:bg-emerald-700",
                              ].join(" ")}
                            >
                              {addingGuidePlaceFacilityTagQuickAdd ? "新增中…" : "新增並選取"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                    <button
                      type="button"
                      onClick={() => void saveGuidePlaceEdit(editingGuidePlaceRow)}
                      disabled={Boolean(savingGuidePlaceId)}
                      className={[
                        "rounded-2xl px-6 py-3 text-sm font-black text-white",
                        savingGuidePlaceId ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                      ].join(" ")}
                    >
                      {savingGuidePlaceId ? "儲存中…" : "儲存修改"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditGuidePlace}
                      disabled={Boolean(savingGuidePlaceId)}
                      className="rounded-2xl bg-slate-100 px-6 py-3 text-sm font-black text-slate-900 hover:bg-slate-200"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div
            className={[
              activeDashboardTab === "board" && showManualEntryForm ? "" : "hidden",
              "rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5",
            ].join(" ")}
          >
            <div className="text-base font-black text-slate-900">管理員手動入料</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">
              提交後 status 直接為 approved
            </div>

            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm font-bold text-slate-700">案件類型</div>
                  <select
                    value={form.case_type}
                    onChange={(e) =>
                      setForm((p) => {
                        const nextCaseType =
                          e.target.value === "found_rescued"
                            ? "found_rescued"
                            : e.target.value === "spotted_unrescued"
                              ? "spotted_unrescued"
                              : "lost";
                        return {
                          ...p,
                          case_type: nextCaseType,
                          source_type: syncIdentityWithCaseType(
                            normalizeContactIdentity(p.source_type, p.case_type),
                            nextCaseType,
                          ),
                        };
                      })
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900"
                  >
                    <option value="lost">走失</option>
                    <option value="spotted_unrescued">發現（未救起）</option>
                    <option value="found_rescued">發現（救起）</option>
                  </select>
                </label>
                <label className="block">
                  <div className="text-sm font-bold text-slate-700">聯絡電話</div>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="6345 7788"
                  />
                </label>
              </div>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">寵物種類</div>
                <select
                  value={form.pet_type}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      pet_type:
                        e.target.value === "dog"
                          ? "dog"
                          : e.target.value === "bird"
                            ? "bird"
                            : e.target.value === "other"
                              ? "other"
                              : "cat",
                      breed:
                        (e.target.value === "dog"
                          ? "dog"
                          : e.target.value === "bird"
                            ? "bird"
                            : e.target.value === "other"
                              ? "other"
                              : "cat") === p.pet_type
                          ? p.breed
                          : e.target.value === "other"
                            ? "其他 / 不確定品種"
                            : null,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900"
                >
                  <option value="cat">貓貓</option>
                  <option value="dog">狗狗</option>
                  <option value="bird">鸚鵡/雀鳥</option>
                  <option value="other">其他</option>
                </select>
              </label>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">詳細品種</div>
                <select
                  value={typeof form.breed === "string" ? form.breed : ""}
                  onChange={(e) => setForm((p) => ({ ...p, breed: e.target.value ? e.target.value : null }))}
                  disabled={form.pet_type !== "cat" && form.pet_type !== "dog" && form.pet_type !== "bird"}
                  className={[
                    "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900",
                    form.pet_type !== "cat" && form.pet_type !== "dog" && form.pet_type !== "bird"
                      ? "cursor-not-allowed opacity-60"
                      : "",
                  ].join(" ")}
                >
                  {form.pet_type !== "cat" && form.pet_type !== "dog" && form.pet_type !== "bird" ? (
                    <option value="其他 / 不確定品種">其他 / 不確定品種</option>
                  ) : (
                    <option value="">請選擇詳細品種</option>
                  )}
                  {petBreeds
                    .filter((b) => b.pet_type === form.pet_type)
                    .map((breed) => (
                      <option key={breed.id} value={breed.breed_name}>
                        {breed.breed_name}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">寵物名字</div>
                <input
                  value={form.pet_name}
                  onChange={(e) => setForm((p) => ({ ...p, pet_name: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="豆豉（柴犬）"
                />
              </label>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">走失/目擊地點（文字）</div>
                <input
                  value={form.location}
                  onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="旺角朗豪坊後巷"
                />
              </label>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">手動地址（Fallback）</div>
                <input
                  value={String(form.manual_address || "")}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      manual_address: e.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="尖沙咀海港城正門"
                />
                <div className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">
                  如現場未能準確取得 GPS，可保留此欄作後備地址；後台仍可批准案件。
                </div>
              </label>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">時間</div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="date"
                    value={formTimeParts.date}
                    onChange={(e) => {
                      const next = buildIsoFromLocalParts(e.target.value, formTimeParts.hour, formTimeParts.minute);
                      setForm((p) => ({ ...p, lost_time: next }));
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  />
                  <select
                    value={formTimeParts.hour}
                    onChange={(e) => {
                      const next = buildIsoFromLocalParts(formTimeParts.date, e.target.value, formTimeParts.minute);
                      setForm((p) => ({ ...p, lost_time: next }));
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
                    value={formTimeParts.minute}
                    onChange={(e) => {
                      const next = buildIsoFromLocalParts(formTimeParts.date, formTimeParts.hour, e.target.value);
                      setForm((p) => ({ ...p, lost_time: next }));
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

              <label className="block">
                <div className="text-sm font-bold text-slate-700">特徵描述</div>
                <textarea
                  value={form.features}
                  onChange={(e) => setForm((p) => ({ ...p, features: e.target.value }))}
                  className="mt-2 min-h-[90px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  placeholder="親人、帶有紅色頸圈。"
                />
              </label>

              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-sm font-black text-slate-900">座標與定位</div>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  {Number.isFinite(form.latitude) && Number.isFinite(form.longitude)
                    ? `已帶入座標：${form.latitude?.toFixed(5)}, ${form.longitude?.toFixed(5)}`
                    : form.manual_address
                      ? "目前未有座標，將以手動地址作後備資料"
                      : "尚未輸入座標"}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <div className="text-sm font-bold text-slate-700">Latitude</div>
                    <input
                      value={form.latitude == null ? "" : String(form.latitude)}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          latitude: parseOptionalCoordinate(e.target.value),
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="22.3193"
                    />
                  </label>
                  <label className="block">
                    <div className="text-sm font-bold text-slate-700">Longitude</div>
                    <input
                      value={form.longitude == null ? "" : String(form.longitude)}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          longitude: parseOptionalCoordinate(e.target.value),
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="114.1694"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAdminAddressSearch()}
                    disabled={searchingAddress}
                    className={[
                      "rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white",
                      searchingAddress ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    {searchingAddress ? "搜尋中…" : "用手動地址搜尋座標"}
                  </button>
                  <div className="flex items-center text-xs font-semibold leading-relaxed text-slate-500">
                    找到後會自動帶入座標；找不到也會保留文字地址供審批與人工跟進。
                  </div>
                </div>
              </div>

              <label className="block">
                <div className="text-sm font-bold text-slate-700">聯絡人身份 / 發佈方式</div>
                <select
                  value={form.source_type}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      source_type: normalizeContactIdentity(e.target.value, p.case_type),
                      case_type: getDefaultCaseTypeForIdentity(normalizeContactIdentity(e.target.value, p.case_type)),
                      source_link: needsSourceLink(normalizeContactIdentity(e.target.value, p.case_type)) ? p.source_link : null,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900"
                >
                  {CONTACT_IDENTITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  {getCaseIdentityCategoryLabel(normalizeContactIdentity(form.source_type, form.case_type))}
                </div>
              </label>

              {needsSourceLink(normalizeContactIdentity(form.source_type, form.case_type)) ? (
                <label className="block">
                  <div className="text-sm font-bold text-slate-700">社交媒體原帖連結</div>
                  <input
                    value={String(form.source_link || "")}
                    onChange={(e) => setForm((p) => ({ ...p, source_link: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="https://www.facebook.com/... 或 https://www.threads.net/..."
                  />
                </label>
              ) : null}

              <div className="block">
                <div className="text-sm font-bold text-slate-700">毛孩照片</div>
                <label
                  htmlFor="admin-pet-image"
                  className="mt-2 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center"
                >
                  {form.image_url ? (
                    <div className="w-full">
                      <img
                        src={form.image_url}
                        alt="管理員上傳預覽"
                        className="mx-auto h-56 w-full rounded-2xl object-cover shadow-md"
                      />
                      <div className="mt-3 text-xs font-bold text-slate-600">
                        已上傳至 Supabase Storage，可再次點擊更換圖片
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-3xl">🖼️</div>
                      <div className="mt-2 text-sm font-black text-slate-900">
                        選擇本機圖片後，系統會立即自動上傳至 Supabase
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        支援 JPG / PNG / WEBP，大小上限 5MB
                      </div>
                    </>
                  )}
                </label>
                <input
                  id="admin-pet-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void handleAdminImageUpload(e.target.files?.[0])}
                />
                {uploadingImage ? (
                  <div className="mt-2 text-sm font-bold text-sky-700">圖片上傳中…</div>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={saving || uploadingImage}
                className={[
                  "w-full rounded-2xl bg-emerald-600 px-4 py-3 text-base font-black text-white shadow-lg",
                  saving || uploadingImage ? "opacity-70" : "",
                ].join(" ")}
              >
                {saving ? "提交中…" : uploadingImage ? "等待圖片上傳…" : "發佈（approved）"}
              </button>
            </form>
          </div>
        </div>

        <div className={activeDashboardTab === "board" ? "order-1 lg:col-span-12" : "hidden"}>
          <div className="mb-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-base font-black text-slate-900">🚨 案件審批看板</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  集中處理待審批、已發佈與已結案案件
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualEntryForm((prev) => !prev)}
                className={[
                  "rounded-2xl px-5 py-3 text-sm font-black text-white shadow-sm transition",
                  showManualEntryForm ? "bg-slate-900 hover:bg-slate-800" : "bg-sky-600 hover:bg-sky-700",
                ].join(" ")}
              >
                {showManualEntryForm ? "✖ 收起手動入料表單" : "➕ 展開手動入料表單"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <div className="text-base font-black text-slate-900">數據與審批管理看板</div>
              <button
                type="button"
                onClick={() => void refreshAllBoards(tab)}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900"
              >
                重新整理
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setTab("approved")}
                className={[
                  "rounded-full px-4 py-2 text-sm font-black",
                  tab === "approved"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-900",
                ].join(" ")}
              >
                🟢 已發佈案件
              </button>
              <button
                type="button"
                onClick={() => setTab("pending")}
                className={[
                  "rounded-full px-4 py-2 text-sm font-black",
                  tab === "pending" ? "bg-yellow-400 text-black" : "bg-slate-100 text-slate-900",
                ].join(" ")}
              >
                🟡 待審批案件
              </button>
              <button
                type="button"
                onClick={() => setTab("resolved")}
                className={[
                  "rounded-full px-4 py-2 text-sm font-black",
                  tab === "resolved" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900",
                ].join(" ")}
              >
                🎉 已尋回 / 結案
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {loadingList ? (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                  讀取中…
                </div>
              ) : (
                <>
                  {items.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                      暫時沒有資料
                    </div>
                  ) : (
                    items.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-black/5">
                            {p.image_url ? (
                              <Image
                                src={p.image_url}
                                alt=""
                                width={56}
                                height={56}
                                className="h-full w-full object-cover"
                                unoptimized
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900">
                              {p.pet_name}
                            </div>
                            <div className="mt-0.5 truncate text-xs font-bold text-slate-600">
                              {p.pet_type === "dog"
                                ? "🐶 狗狗"
                                : p.pet_type === "bird"
                                  ? "🦜 鸚鵡/雀鳥"
                                  : p.pet_type === "other"
                                    ? "🐹 其他"
                                    : "🐱 貓貓"}{" "}
                              ·{" "}
                              {p.case_type === "lost"
                                ? "走失"
                                : p.case_type === "found_rescued"
                                  ? "發現（救起）"
                                  : "發現（未救起）"}
                            </div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-600">
                              📍 {getDisplayAddress(p.location, p.manual_address) || "未提供位置"}
                            </div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-600">
                              👤 {getContactIdentityLabel(normalizeContactIdentity(p.source_type, p.case_type))} ·{" "}
                              {getCaseIdentityCategoryLabel(normalizeContactIdentity(p.source_type, p.case_type))}
                            </div>
                            {p.manual_address && isInvalidLocationText(p.location) ? (
                              <div className="mt-0.5 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-900">
                                已改用手動地址作顯示（地點描述疑似無效）
                              </div>
                            ) : null}
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-600">
                              ⏰ {formatHongKongDateTime(p.lost_time)}
                            </div>
                            <div className="mt-1">
                              <span
                                className={[
                                  "inline-flex rounded-full px-2 py-1 text-[11px] font-black",
                                  p.status === "approved"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : p.status === "resolved"
                                      ? "bg-slate-900 text-white"
                                      : "bg-yellow-100 text-yellow-800",
                                ].join(" ")}
                              >
                                {p.status === "approved"
                                  ? "approved"
                                  : p.status === "resolved"
                                    ? "resolved"
                                    : "pending"}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs font-medium text-slate-700">
                              ✨ {p.features}
                            </div>
                            {Number.isFinite(p.latitude) && Number.isFinite(p.longitude) ? (
                              <div className="mt-1 truncate text-[11px] font-bold text-emerald-700">
                                已定位：{p.latitude?.toFixed(5)}, {p.longitude?.toFixed(5)}
                              </div>
                            ) : (
                              <div className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-800">
                                僅有地址，未有座標
                              </div>
                            )}
                            {p.user_id ? (
                              <div className="mt-1 truncate text-[11px] font-bold text-slate-500">
                                UID: {p.user_id}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"
                          >
                            {tab === "pending" ? "✏️ 編輯/補全座標" : "✏️ 編輯資料"}
                          </button>
                          {tab === "pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => onApprove(p)}
                                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white"
                              >
                                ✅ 批准上線
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onDelete(p.id)}
                            className="rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white"
                          >
                            {tab === "pending" ? "❌ 拒絕" : "❌ 刪除"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {guidePlaceCreateModalOpen ? (
        <div className="fixed inset-0 z-[1390] bg-black/55 backdrop-blur-sm">
          <div className="flex min-h-full items-end justify-center p-0 lg:items-center lg:p-6">
            <div className="relative z-50 w-full max-w-4xl max-h-[92svh] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl lg:rounded-3xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xl font-black text-slate-900">新增指南地點</div>
                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    所有欄位、地址搜尋與地圖定位均在彈窗內完成
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeGuidePlaceCreateModal}
                  disabled={addingGuidePlace || uploadingGuidePlaceImage || locatingGuidePlaceForm || searchingGuidePlaceFormAddress}
                  className={[
                    "rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900",
                    addingGuidePlace || uploadingGuidePlaceImage || locatingGuidePlaceForm || searchingGuidePlaceFormAddress
                      ? "opacity-50"
                      : "hover:bg-slate-200",
                  ].join(" ")}
                >
                  關閉
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <label className="block">
                  <div className="text-xs font-bold text-slate-600">大分類</div>
                  <select
                    value={guidePlaceForm.category_id}
                    onChange={(e) =>
                      setGuidePlaceForm((prev) => ({
                        ...prev,
                        category_id: e.target.value,
                        subcategory_ids: [],
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    disabled={guideCategories.length === 0}
                  >
                    {guideCategories.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.icon} {row.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="text-xs font-bold text-slate-600">子分類</div>
                  <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    {guidePlaceSubcategoryOptions.length === 0 ? (
                      <span className="text-xs font-semibold text-slate-400">請先選擇可用子分類</span>
                    ) : (
                      guidePlaceSubcategoryOptions.map((row) => {
                        const checked = guidePlaceForm.subcategory_ids.includes(row.id);
                        return (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => toggleGuidePlaceFormSubcategory(row.id)}
                            className={[
                              "rounded-full px-3 py-2 text-xs font-black ring-1 transition",
                              checked
                                ? "bg-emerald-600 text-white ring-emerald-600"
                                : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            {checked ? "✓ " : ""}{row.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </label>

                <label className="block">
                  <div className="text-xs font-bold text-slate-600">地點名稱</div>
                  <input
                    value={guidePlaceForm.name}
                    onChange={(e) => setGuidePlaceForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="例如：西貢海濱寵物共享公園"
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-bold text-slate-600">地區</div>
                  <select
                    value={guidePlaceForm.district}
                    onChange={(e) => setGuidePlaceForm((prev) => ({ ...prev, district: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                  >
                    {GUIDE_PLACE_DISTRICTS.map((district) => (
                      <option key={district} value={district}>
                        {district}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block xl:col-span-2">
                  <div className="text-xs font-bold text-slate-600">詳細地址</div>
                  <input
                    value={guidePlaceForm.address}
                    onChange={(e) => setGuidePlaceForm((prev) => ({ ...prev, address: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="例如：西貢海濱長廊近碼頭入口"
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-bold text-slate-600">營業時間</div>
                  <input
                    value={guidePlaceForm.opening_hours}
                    onChange={(e) => setGuidePlaceForm((prev) => ({ ...prev, opening_hours: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="例如：24小時開放 / 10:00 - 22:00"
                  />
                </label>

                <div className="xl:col-span-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGuidePlaceFormUseCurrentLocation}
                    disabled={locatingGuidePlaceForm}
                    className={[
                      "rounded-2xl px-4 py-3 text-sm font-black text-white",
                      locatingGuidePlaceForm ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
                    ].join(" ")}
                  >
                    {locatingGuidePlaceForm ? "定位中…" : "📍 獲取目前手機定位"}
                  </button>
                  <div className="flex items-center text-xs font-semibold leading-relaxed text-slate-500">
                    可用地圖落針或直接讀取定位，自動填入下方經緯度。
                  </div>
                </div>

                <div className="block xl:col-span-2">
                  <div className="text-xs font-bold text-slate-600">地點相片上傳</div>
                  <label
                    className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-emerald-300 hover:bg-emerald-50"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleGuidePlaceImageUpload(e.dataTransfer.files);
                    }}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleGuidePlaceImageUpload(e.target.files ?? undefined)}
                    />
                    <div className="text-2xl">📸</div>
                    <div className="mt-2 text-sm font-black text-slate-900">
                      {uploadingGuidePlaceImage ? "相片上傳中…" : "拖放多張圖片到此處，或點擊多選上傳"}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">支援 JPG / PNG / WEBP，最多 5MB</div>
                  </label>
                  {guidePlaceForm.image_urls.length > 0 ? (
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                        {guidePlaceForm.image_urls.map((url, index) => (
                          <div key={`${url}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                            <img src={url} alt={`指南地點預覽 ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                              <div className="text-[11px] font-black text-slate-500">{index === 0 ? "封面" : `第 ${index + 1} 張`}</div>
                              <button
                                type="button"
                                onClick={() => removeGuidePlaceFormImageAt(index)}
                                className="rounded-xl bg-rose-100 px-2 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-200"
                              >
                                刪除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="xl:col-span-2 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                  <AdminMiniMap
                    center={safeGuidePlaceFormMapCenter}
                    zoom={guidePlaceFormMapFocus?.zoom ?? 13}
                    focusCenter={guidePlaceFormMapFocus?.center ?? null}
                    focusZoom={guidePlaceFormMapFocus?.zoom}
                    invalidateSizeKey={guidePlaceCreateModalNonce}
                    pickEnabled
                    onPick={handleGuidePlaceFormMapPick}
                    markerPosition={guidePlaceFormMarkerPosition}
                    markerIcon={editMarkerIcon}
                    className="h-56 w-full"
                  />
                </div>

                <div className="xl:col-span-2">
                  <div className="text-xs font-bold text-slate-600">地址搜尋</div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={guidePlaceFormAddressSearchQuery}
                      onChange={(e) => setGuidePlaceFormAddressSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        void handleGuidePlaceFormAddressSearch();
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      placeholder="輸入地址並搜尋定位"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGuidePlaceFormAddressSearch()}
                      disabled={searchingGuidePlaceFormAddress}
                      className={[
                        "rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white sm:min-w-[96px]",
                        searchingGuidePlaceFormAddress ? "opacity-70" : "hover:bg-amber-600",
                      ].join(" ")}
                    >
                      {searchingGuidePlaceFormAddress ? "搜尋中…" : "搜尋"}
                    </button>
                  </div>
                </div>

                <label className="block">
                  <div className="text-xs font-bold text-slate-600">緯度</div>
                  <input
                    value={guidePlaceForm.latitude}
                    onChange={(e) => setGuidePlaceForm((prev) => ({ ...prev, latitude: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="22.3813"
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-bold text-slate-600">經度</div>
                  <input
                    value={guidePlaceForm.longitude}
                    onChange={(e) => setGuidePlaceForm((prev) => ({ ...prev, longitude: e.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    placeholder="114.2702"
                  />
                </label>

                <div className="xl:col-span-2">
                  <div className="text-xs font-bold text-slate-600">設施標籤</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      { key: "has_grass" as const, label: "有草地" },
                      { key: "has_wash_station" as const, label: "清洗區" },
                      { key: "has_fencing" as const, label: "安全圍欄" },
                      { key: "has_parking" as const, label: "附近車位" },
                    ].map((item) => (
                      <label
                        key={item.key}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900"
                      >
                        <input
                          type="checkbox"
                          checked={guidePlaceForm[item.key]}
                          onChange={(e) =>
                            setGuidePlaceForm((prev) => ({
                              ...prev,
                              [item.key]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeGuidePlaceCreateModal}
                  disabled={addingGuidePlace || uploadingGuidePlaceImage || locatingGuidePlaceForm || searchingGuidePlaceFormAddress}
                  className={[
                    "rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-900",
                    addingGuidePlace || uploadingGuidePlaceImage || locatingGuidePlaceForm || searchingGuidePlaceFormAddress
                      ? "opacity-50"
                      : "hover:bg-slate-200",
                  ].join(" ")}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void createGuidePlace()}
                  disabled={addingGuidePlace}
                  className={[
                    "rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-sm",
                    addingGuidePlace ? "opacity-70" : "hover:bg-emerald-700",
                  ].join(" ")}
                >
                  {addingGuidePlace ? "新增中…" : "➕ 新增指南地點"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editingPet ? (
        <div className="fixed inset-0 z-[1400] bg-black/55 backdrop-blur-sm">
          <div className="flex min-h-full items-end justify-center p-0 lg:items-center lg:p-6">
            <div className="relative z-50 w-full max-w-5xl max-h-[92svh] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl lg:rounded-3xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xl font-black text-slate-900">全功能案件超級編輯器</div>
                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    可完整修正欄位、圖片、地址、座標與案件狀態，再儲存回 Supabase
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900"
                >
                  關閉
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="relative z-50 lg:col-span-7 space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">案件類型</div>
                      <select
                        value={editingPet.case_type}
                        onChange={(e) =>
                          (() => {
                            const nextCaseType =
                              e.target.value === "found_rescued"
                                ? "found_rescued"
                                : e.target.value === "spotted_unrescued"
                                  ? "spotted_unrescued"
                                  : "lost";
                            updateEditingPet("case_type", nextCaseType);
                            updateEditingPet(
                              "source_type",
                              syncIdentityWithCaseType(
                                normalizeContactIdentity(editingPet.source_type, editingPet.case_type),
                                nextCaseType,
                              ),
                            );
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
                      <div className="text-sm font-bold text-slate-700">寵物種類</div>
                      <select
                        value={editingPet.pet_type}
                        onChange={(e) => {
                          const nextPetType =
                            e.target.value === "dog"
                              ? "dog"
                              : e.target.value === "bird"
                                ? "bird"
                                : e.target.value === "other"
                                  ? "other"
                                  : "cat";
                          setEditingPet((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  pet_type: nextPetType,
                                  breed:
                                    nextPetType === prev.pet_type
                                      ? prev.breed
                                      : nextPetType === "other"
                                        ? "其他 / 不確定品種"
                                        : null,
                                }
                              : prev,
                          );
                        }}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      >
                        <option value="cat">貓貓</option>
                        <option value="dog">狗狗</option>
                        <option value="bird">鸚鵡/雀鳥</option>
                        <option value="other">其他</option>
                      </select>
                    </label>
                  </div>

                  <label className="mt-4 block">
                    <div className="text-sm font-bold text-slate-700">詳細品種</div>
                    <select
                      value={typeof editingPet.breed === "string" ? editingPet.breed : ""}
                      onChange={(e) => updateEditingPet("breed", e.target.value ? e.target.value : null)}
                      disabled={editingPet.pet_type !== "cat" && editingPet.pet_type !== "dog" && editingPet.pet_type !== "bird"}
                      className={[
                        "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900",
                        editingPet.pet_type !== "cat" && editingPet.pet_type !== "dog" && editingPet.pet_type !== "bird"
                          ? "cursor-not-allowed opacity-60"
                          : "",
                      ].join(" ")}
                    >
                      {editingPet.pet_type !== "cat" && editingPet.pet_type !== "dog" && editingPet.pet_type !== "bird" ? (
                        <option value="其他 / 不確定品種">其他 / 不確定品種</option>
                      ) : (
                        <option value="">請選擇詳細品種</option>
                      )}
                      {petBreeds
                        .filter((b) => b.pet_type === editingPet.pet_type)
                        .map((breed) => (
                          <option key={breed.id} value={breed.breed_name}>
                            {breed.breed_name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">寵物名字</div>
                      <input
                        value={editingPet.pet_name}
                        onChange={(e) => updateEditingPet("pet_name", e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      />
                    </label>
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">案件狀態</div>
                      <select
                        value={editingPet.status}
                        onChange={(e) =>
                          updateEditingPet(
                            "status",
                            e.target.value === "resolved"
                              ? "resolved"
                              : e.target.value === "pending"
                                ? "pending"
                                : "approved",
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      >
                        <option value="approved">approved（尋找中 / 顯示於前台地圖）</option>
                        <option value="resolved">resolved（已尋回 / 結案下架）</option>
                        <option value="pending">pending（下架並移回待審批池）</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">聯絡電話</div>
                      <input
                        value={editingPet.phone}
                        onChange={(e) => updateEditingPet("phone", e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      />
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <input
                          type="checkbox"
                          id="editPrivacyToggle"
                          checked={editingPet.enable_privacy}
                          onChange={(e) => updateEditingPet("enable_privacy", e.target.checked)}
                          className="h-4 w-4 rounded text-blue-600"
                        />
                        <label htmlFor="editPrivacyToggle" className="cursor-pointer text-sm font-medium text-blue-800">
                          🛡️ 啟用防騙隱私保護 (隱藏電話號碼，聯絡時跳出防騙倒數彈窗)
                        </label>
                      </div>
                    </label>
                  </div>

                  <label className="block">
                    <div className="text-sm font-bold text-slate-700">地點文字描述</div>
                    <input
                      value={editingPet.location}
                      onChange={(e) => updateEditingPet("location", e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    />
                  </label>

                  <label className="block">
                    <div className="text-sm font-bold text-slate-700">手動輸入地址</div>
                    <input
                      value={String(editingPet.manual_address || "")}
                      onChange={(e) => updateEditingPet("manual_address", e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    />
                  </label>

                  {isInvalidLocationText(String(editingPet.location || "")) &&
                  String(editingPet.manual_address || "").trim() ? (
                    <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                      <div className="text-sm font-black text-amber-900">提示：地點描述疑似無效</div>
                      <div className="mt-2 text-sm font-semibold text-amber-900/80">
                        目前「地點文字描述」看起來像 na / nil / 太短，前台與海報會優先用「手動地址」作顯示。
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateEditingPet("location", String(editingPet.manual_address || "").trim())
                          }
                          className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white"
                        >
                          一鍵用手動地址覆蓋地點描述
                        </button>
                        <div className="text-xs font-semibold text-amber-900/70">
                          手動地址：{String(editingPet.manual_address || "").trim()}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">時間</div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input
                          type="date"
                          value={safeEditingTimeParts.date}
                          onChange={(e) => {
                            const next = buildIsoFromLocalParts(
                              e.target.value,
                              safeEditingTimeParts.hour,
                              safeEditingTimeParts.minute,
                            );
                            updateEditingPet("lost_time", next);
                          }}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                        />
                        <select
                          value={safeEditingTimeParts.hour}
                          onChange={(e) => {
                            const next = buildIsoFromLocalParts(
                              safeEditingTimeParts.date,
                              e.target.value,
                              safeEditingTimeParts.minute,
                            );
                            updateEditingPet("lost_time", next);
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
                          value={safeEditingTimeParts.minute}
                          onChange={(e) => {
                            const next = buildIsoFromLocalParts(
                              safeEditingTimeParts.date,
                              safeEditingTimeParts.hour,
                              e.target.value,
                            );
                            updateEditingPet("lost_time", next);
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
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">聯絡人身份 / 發佈方式</div>
                      <select
                        value={editingPet.source_type}
                        onChange={(e) =>
                          (() => {
                            const nextIdentity = normalizeContactIdentity(e.target.value, editingPet.case_type);
                            updateEditingPet("source_type", nextIdentity);
                            updateEditingPet("case_type", getDefaultCaseTypeForIdentity(nextIdentity));
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
                        {getCaseIdentityCategoryLabel(
                          normalizeContactIdentity(editingPet.source_type, editingPet.case_type),
                        )}
                      </div>
                    </label>
                  </div>

                  {needsSourceLink(normalizeContactIdentity(editingPet.source_type, editingPet.case_type)) ? (
                    <label className="block">
                      <div className="text-sm font-bold text-slate-700">社交媒體原帖連結</div>
                      <input
                        value={String(editingPet.source_link || "")}
                        onChange={(e) => updateEditingPet("source_link", e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                      />
                    </label>
                  ) : null}

                  <label className="block">
                    <div className="text-sm font-bold text-slate-700">毛孩特徵</div>
                    <textarea
                      value={editingPet.features}
                      onChange={(e) => updateEditingPet("features", e.target.value)}
                      className="mt-2 min-h-[100px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                    />
                  </label>

                  <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">實時目擊時間軸</div>
                        <div className="mt-1 text-xs font-semibold text-slate-600">
                          可新增 / 修改 / 刪除每一條「目擊時間 + 事件文字」，儲存後前台面板會同步更新。
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={addEditingTimelineItem}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"
                      >
                        ➕ 新增
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {editingTimeline.length === 0 ? (
                        <div className="text-sm font-semibold text-slate-600">
                          目前沒有時間軸資料（前台會顯示「暫無目擊紀錄更新」）。你可以按「新增」建立第一條。
                        </div>
                      ) : (
                        editingTimeline.map((t, idx) => (
                          <div key={`${t.time}-${idx}`} className="grid grid-cols-12 gap-2">
                            <input
                              value={t.time}
                              onChange={(e) => updateEditingTimeline(idx, "time", e.target.value)}
                              className="col-span-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                              placeholder="15:30"
                            />
                            <input
                              value={t.text}
                              onChange={(e) => updateEditingTimeline(idx, "text", e.target.value)}
                              className="col-span-8 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                              placeholder="街坊A報料：在後巷見到蹤影"
                            />
                            <button
                              type="button"
                              onClick={() => deleteEditingTimelineItem(idx)}
                              className="col-span-1 rounded-2xl bg-red-600 px-3 py-2 text-sm font-black text-white"
                            >
                              ✕
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="block">
                    <div className="text-sm font-bold text-slate-700">照片管理</div>
                    <label
                      htmlFor="admin-edit-image"
                      className="mt-2 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center"
                    >
                      {editingPet.image_url ? (
                        <div className="w-full">
                          <img
                            src={editingPet.image_url}
                            alt="案件圖片"
                            className="mx-auto h-56 w-full rounded-2xl object-cover shadow-md"
                          />
                          <div className="mt-3 text-xs font-bold text-slate-600">
                            點擊即可上傳新圖片並直接替換目前 URL
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-3xl">🖼️</div>
                          <div className="mt-2 text-sm font-black text-slate-900">
                            點擊上傳新相片並替換目前案件圖片
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            支援 JPG / PNG / WEBP，大小上限 5MB
                          </div>
                        </>
                      )}
                    </label>
                    <input
                      id="admin-edit-image"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => void handleEditingImageUpload(e.target.files?.[0])}
                    />
                    {editingUploadingImage ? (
                      <div className="mt-2 text-sm font-bold text-sky-700">圖片替換中…</div>
                    ) : null}
                  </div>
                </div>

                <div className="relative z-0 lg:col-span-5 space-y-4">
                  <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <div className="text-sm font-black text-slate-900">智慧小地圖與座標</div>
                    <div className="mt-2 text-sm font-semibold text-slate-600">
                      可直接點小地圖落針，或手動輸入緯度 / 經度。
                    </div>
                    <div className="mt-4 h-72 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                      <AdminMiniMap
                        center={safeEditingMapCenter}
                        zoom={editingMapFocus?.zoom ?? 13}
                        focusCenter={editingMapFocus?.center ?? null}
                        focusZoom={editingMapFocus?.zoom}
                        pickEnabled
                        onPick={handleEditMapPick}
                        markerPosition={editingMarkerPosition}
                        markerIcon={editMarkerIcon}
                        className="h-full w-full"
                      />
                    </div>

                    <div className="mt-4">
                      <div className="text-sm font-bold text-slate-700">搜尋地址以定位</div>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={editingAddressSearchQuery}
                          onChange={(e) => setEditingAddressSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            void handleEditAddressSearch();
                          }}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                          placeholder="例如：西營盤第三街、旺角彌敦道 123 號"
                        />
                        <button
                          type="button"
                          onClick={() => void handleEditAddressSearch()}
                          disabled={editingSearchingAddress}
                          className={[
                            "rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white sm:min-w-[124px]",
                            editingSearchingAddress ? "opacity-70" : "",
                          ].join(" ")}
                        >
                          {editingSearchingAddress ? "搜尋中…" : "搜尋地址"}
                        </button>
                      </div>
                      <div className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">
                        使用 OpenStreetMap Nominatim 取第一個結果，並自動填入下方經緯度。
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <label className="block">
                        <div className="text-sm font-bold text-slate-700">Latitude</div>
                        <input
                          value={editingPet.latitude == null ? "" : String(editingPet.latitude)}
                          onChange={(e) =>
                            updateEditingPet("latitude", parseOptionalCoordinate(e.target.value))
                          }
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                          placeholder="22.3193"
                        />
                      </label>
                      <label className="block">
                        <div className="text-sm font-bold text-slate-700">Longitude</div>
                        <input
                          value={editingPet.longitude == null ? "" : String(editingPet.longitude)}
                          onChange={(e) =>
                            updateEditingPet("longitude", parseOptionalCoordinate(e.target.value))
                          }
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                          placeholder="114.1694"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => void saveEditedPet(false)}
                  disabled={editingSaving || editingUploadingImage}
                  className={[
                    "rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-lg",
                    editingSaving || editingUploadingImage ? "opacity-70" : "",
                  ].join(" ")}
                >
                  {editingSaving ? "儲存中…" : editingUploadingImage ? "等待圖片上傳…" : "💾 儲存所有修改"}
                </button>
                <button
                  type="button"
                  onClick={() => void saveEditedPet(true)}
                  disabled={editingSaving || editingUploadingImage}
                  className={[
                    "rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-lg",
                    editingSaving || editingUploadingImage ? "opacity-70" : "",
                  ].join(" ")}
                >
                  {editingSaving
                    ? "儲存中…"
                    : editingUploadingImage
                      ? "等待圖片上傳…"
                      : "✅ 儲存並直接批准上線"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
