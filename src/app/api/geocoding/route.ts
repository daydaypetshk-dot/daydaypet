import { NextResponse } from "next/server";

type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

type PhotonGeoJson = {
  features?: PhotonFeature[];
};

type NormalizedGeocodeItem = { label: string; lat: number; lng: number };
type GoogleGeocodeJson = {
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildLabel(props: Record<string, unknown>, fallback: string) {
  const name = asString(props.name);
  const street = asString(props.street);
  const district = asString(props.district) || asString(props.city);
  return [name, street, district].filter(Boolean).join(", ") || fallback;
}

function normalizePhotonFeatures(features: PhotonFeature[], q: string): NormalizedGeocodeItem[] {
  const out: NormalizedGeocodeItem[] = [];
  for (const feat of Array.isArray(features) ? features : []) {
    const props = (feat?.properties && typeof feat.properties === "object" ? feat.properties : {}) as Record<
      string,
      unknown
    >;
    const coordsRaw = (feat?.geometry as any)?.coordinates;
    const coords = Array.isArray(coordsRaw) ? coordsRaw : null;
    const lng = coords ? asNumber(coords[0]) : null;
    const lat = coords ? asNumber(coords[1]) : null;
    if (lat == null || lng == null) continue;
    out.push({ label: buildLabel(props, q), lat, lng });
  }
  return out;
}

async function geocodeWithGoogleMaps(query: string) {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    address: query,
    key: apiKey,
    language: "zh-HK",
    region: "hk",
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Google Geocoding API error:", response.status);
    return null;
  }

  const json = (await response.json()) as GoogleGeocodeJson;
  const rows = Array.isArray(json?.results) ? json.results : [];
  const normalized = rows
    .map((row) => {
      const lat = asNumber(row?.geometry?.location?.lat);
      const lng = asNumber(row?.geometry?.location?.lng);
      const label = asString(row?.formatted_address).trim() || query;
      if (lat == null || lng == null) return null;
      return { label, lat, lng } satisfies NormalizedGeocodeItem;
    })
    .filter(Boolean) as NormalizedGeocodeItem[];

  return normalized;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const latRaw = searchParams.get("lat");
    const lngRaw = searchParams.get("lng");

    if (latRaw && lngRaw && !q) {
      const lat = asNumber(latRaw);
      const lng = asNumber(lngRaw);
      if (lat == null || lng == null) return NextResponse.json([] satisfies NormalizedGeocodeItem[]);

      const photonUrl = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(
        String(lat),
      )}&lon=${encodeURIComponent(String(lng))}&limit=1`;

      const response = await fetch(photonUrl, { method: "GET", cache: "no-store" });
      if (!response.ok) {
        console.error("Photon API error:", response.status);
        return NextResponse.json([] satisfies NormalizedGeocodeItem[]);
      }

      const geojson = (await response.json()) as PhotonGeoJson;
      const features = Array.isArray(geojson?.features) ? geojson.features : [];
      return NextResponse.json(normalizePhotonFeatures(features, ""));
    }

    if (!q) {
      return NextResponse.json([] satisfies NormalizedGeocodeItem[]);
    }

    const trimmed = q.trim();
    if (!trimmed) return NextResponse.json([] satisfies NormalizedGeocodeItem[]);

    const googleResults = await geocodeWithGoogleMaps(trimmed).catch((error) => {
      console.error("Google Geocoding backend crash:", error);
      return null;
    });
    if (googleResults && googleResults.length > 0) {
      return NextResponse.json(googleResults);
    }

    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      trimmed,
    )}&bbox=113.8,22.1,114.4,22.6&limit=5`;

    const response = await fetch(photonUrl, { method: "GET", cache: "no-store" });

    if (!response.ok) {
      console.error("Photon API error:", response.status);
      return NextResponse.json([] satisfies NormalizedGeocodeItem[]);
    }

    const geojson = (await response.json()) as PhotonGeoJson;
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const normalizedData = normalizePhotonFeatures(features, trimmed);

    return NextResponse.json(normalizedData);
  } catch (error) {
    console.error("Geocoding backend crash:", error);
    return NextResponse.json([] satisfies NormalizedGeocodeItem[]);
  }
}
