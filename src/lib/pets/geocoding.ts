export type GeocodeResult = {
  lat: number;
  lng: number;
  label: string;
};

type SearchOptions = {
  limit?: number;
  signal?: AbortSignal;
};

export async function searchHongKongAddresses(
  query: string,
  options: SearchOptions = {},
): Promise<GeocodeResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const params = new URLSearchParams({
    q: normalized,
  });

  try {
    const res = await fetch(`/api/geocoding?${params.toString()}`, {
      cache: "no-store",
      signal: options.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let errorMessage = `地址搜尋服務暫時不可用 (HTTP ${res.status})`;
      try {
        const errJson = JSON.parse(body) as any;
        if (typeof errJson?.error === "string" && errJson.error.trim()) {
          errorMessage = errJson.error.trim();
        }
      } catch {}
      console.error("Geocoding search non-200:", res.status, errorMessage, body.slice(0, 200));
      throw new Error(errorMessage);
    }
    const json = (await res.json().catch(() => null)) as any;
    const arrayDirect = Array.isArray(json) ? (json as any[]) : null;
    const arrayWrapped = Array.isArray(json?.results) ? (json.results as any[]) : null;
    const raw = arrayDirect ?? arrayWrapped ?? [];

    const mapped = raw
      .map((r) => ({
        lat: Number((r as any)?.lat),
        lng: Number((r as any)?.lng ?? (r as any)?.lon),
        label: String((r as any)?.label || (r as any)?.displayName || (r as any)?.display_name || normalized),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    return options.limit != null ? mapped.slice(0, Math.max(0, options.limit)) : mapped;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return [];
    console.error("Geocoding search exception:", err);
    throw err;
  }
}

export async function geocodeHongKongAddress(query: string): Promise<GeocodeResult | null> {
  const normalized = query.trim();
  if (!normalized) return null;

  const results = await searchHongKongAddresses(normalized, { limit: 1 });
  return results[0] ?? null;
}

export async function geocodeAddressWithNominatim(query: string): Promise<GeocodeResult | null> {
  const normalized = query.trim();
  if (!normalized) return null;

  const params = new URLSearchParams({
    q: normalized,
    format: "json",
    limit: "1",
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim 地址搜尋失敗 (HTTP ${response.status})`);
  }

  const json = (await response.json().catch(() => null)) as
    | Array<{ lat?: string; lon?: string; display_name?: string; name?: string }>
    | null;

  const first = Array.isArray(json) ? json[0] : null;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    label: String(first?.display_name || first?.name || normalized),
  };
}

export async function reverseGeocodeHongKong(
  lat: number,
  lng: number,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });
    const res = await fetch(`/api/geocoding?${params.toString()}`, {
      cache: "no-store",
      signal: options.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as any;
    const first = Array.isArray(json) ? json[0] : null;
    const label = typeof first?.label === "string" ? first.label.trim() : "";
    return label || null;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    console.error("Reverse geocoding exception:", err);
    return null;
  }
}
