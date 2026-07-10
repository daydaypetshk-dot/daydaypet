const DISTRICT_MAP: Record<string, string> = {
  "central and western district": "中西區",
  "eastern district": "東區",
  "southern district": "南區",
  "wan chai district": "灣仔區",
  "kowloon city district": "九龍城區",
  "kwun tong district": "觀塘區",
  "sham shui po district": "深水埗區",
  "wong tai sin district": "黃大仙區",
  "yau tsim mong district": "油尖旺區",
  "islands district": "離島區",
  "kwai tsing district": "葵青區",
  "north district": "北區",
  "sai kung district": "西貢區",
  "sha tin district": "沙田區",
  "tai po district": "大埔區",
  "tsuen wan district": "荃灣區",
  "tuen mun district": "屯門區",
  "yuen long district": "元朗區",
};

export const DISTRICTS_HK = [
  "全港",
  "中西區",
  "東區",
  "南區",
  "灣仔區",
  "九龍城區",
  "觀塘區",
  "深水埗區",
  "黃大仙區",
  "油尖旺區",
  "離島區",
  "葵青區",
  "北區",
  "西貢區",
  "沙田區",
  "大埔區",
  "荃灣區",
  "屯門區",
  "元朗區",
] as const;

export type District = (typeof DISTRICTS_HK)[number];

export const normalizeDistrict = (value: string): District | null => {
  const t = value.trim();
  if (!t) return null;
  if ((DISTRICTS_HK as readonly string[]).includes(t)) return t as District;
  const lower = t.toLowerCase();
  if (DISTRICT_MAP[lower]) return DISTRICT_MAP[lower] as District;
  return null;
};

function extractDistrictFromLabel(label: string): District | null {
  const parts = label
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const normalized = normalizeDistrict(parts[i]);
    if (normalized) return normalized;
  }
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const lower = parts[i].toLowerCase();
    for (const [k, v] of Object.entries(DISTRICT_MAP)) {
      if (lower.includes(k.replace(" district", ""))) return v as District;
    }
  }
  return null;
}

export async function reverseGeocodeDistrict(lat: number, lng: number): Promise<District | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let label = "";

  if (typeof window !== "undefined") {
    try {
      const url = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      const res = await fetch(`/api/geocoding?${url.toString()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as any;
      const first = Array.isArray(json) ? json[0] : null;
      label = typeof first?.label === "string" ? first.label : "";
    } catch (err) {
      console.error("Reverse geocode district exception:", err);
      return null;
    }
  } else {
    try {
      const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(
        String(lat),
      )}&lon=${encodeURIComponent(String(lng))}&limit=1`;
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as any;
      const first = Array.isArray(json?.features) ? json.features[0] : null;
      const props = first?.properties && typeof first.properties === "object" ? first.properties : null;
      const district =
        props && typeof props.district === "string"
          ? props.district
          : props && typeof props.city === "string"
            ? props.city
            : "";
      const normalized = district ? normalizeDistrict(district) : null;
      if (normalized) return normalized;
      label = typeof props?.name === "string" ? props.name : "";
      if (!label && typeof props?.street === "string") label = props.street;
      if (typeof district === "string" && district) label = `${label ? `${label}, ` : ""}${district}`;
    } catch {
      return null;
    }
  }

  return label ? extractDistrictFromLabel(label) : null;
}
