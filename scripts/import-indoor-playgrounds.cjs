require("dotenv").config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HK_BBOX = "113.8,22.1,114.4,22.6";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function withinHongKong(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 22.1 && lat <= 22.6 && lng >= 113.8 && lng <= 114.4;
}

async function geocodeHongKong(q) {
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=${encodeURIComponent(HK_BBOX)}&limit=5`;
  const res = await fetch(photonUrl, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Photon geocode failed (${res.status})`);
  const json = await res.json();
  const features = Array.isArray(json?.features) ? json.features : [];
  for (const feat of features) {
    const coords = Array.isArray(feat?.geometry?.coordinates) ? feat.geometry.coordinates : null;
    const lng = coords ? Number(coords[0]) : NaN;
    const lat = coords ? Number(coords[1]) : NaN;
    if (withinHongKong(lat, lng)) return { lat, lng };
  }
  return null;
}

async function geocodeWithFallback(place) {
  const name = normalizeText(place.name);
  const district = normalizeText(place.district);
  const address = normalizeText(place.address);

  const queries = [
    [address, district, "香港"].filter(Boolean).join(" "),
    [name, address, district, "香港"].filter(Boolean).join(" "),
    [name, district, "香港"].filter(Boolean).join(" "),
    [address, "香港"].filter(Boolean).join(" "),
    [name, "香港"].filter(Boolean).join(" "),
  ].map((q) => q.trim()).filter(Boolean);

  for (const q of queries) {
    try {
      const geo = await geocodeHongKong(q);
      if (geo) return { geo, q };
    } catch {
      continue;
    }
  }

  return { geo: null, q: queries[0] ?? "" };
}

async function ensureCategory(name, icon, sortOrder) {
  const exact = await supabase.from("guide_categories").select("id,name,icon,sort_order").eq("name", name).maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data?.id) return exact.data;

  const fuzzy = await supabase.from("guide_categories").select("id,name,icon,sort_order").ilike("name", `%${name}%`).limit(1);
  if (fuzzy.error) throw fuzzy.error;
  if (Array.isArray(fuzzy.data) && fuzzy.data[0]?.id) return fuzzy.data[0];

  const inserted = await supabase
    .from("guide_categories")
    .insert({ name, icon, sort_order: sortOrder })
    .select("id,name,icon,sort_order")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function ensureSubcategory(categoryId, name, sortOrder) {
  const exact = await supabase
    .from("guide_subcategories")
    .select("id,category_id,name,sort_order")
    .eq("category_id", categoryId)
    .eq("name", name)
    .maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data?.id) return exact.data;

  const inserted = await supabase
    .from("guide_subcategories")
    .insert({ category_id: categoryId, name, sort_order: sortOrder })
    .select("id,category_id,name,sort_order")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

const places = [
  {
    name: "SOUTHSIDE PAWTY",
    district: "南區",
    address: "黃竹坑香葉道11號 THE SOUTHSIDE",
    tags: ["室內寵物公園"],
    description: "商場內大型室內貓狗樂園，適合城市內運動。",
  },
  {
    name: "CyberPAW Zone",
    district: "南區",
    address: "數碼港商場",
    tags: ["室內寵物公園"],
    description: "提供平衡木、冒險橋及隧道，專為寵物設計的室內跑跳空間。",
  },
  {
    name: "Hooment",
    district: "觀塘區",
    address: "觀塘成業街6號泓富廣場",
    tags: ["室內寵物公園"],
    description: "擁有超過6000呎室內空間，專為人寵打造的玩樂園區。",
  },
  {
    name: "Dog Dog Come Wonderland",
    district: "元朗區",
    address: "元朗錦田大江埔",
    tags: ["室內寵物公園"],
    description: "全港最大型室內恆溫寵物樂園，設有多項專業 agility 訓練設施。",
  },
  {
    name: "Pet Oasis 寵物綠洲",
    district: "葵青區",
    address: "葵涌打磚坪街",
    tags: ["室內寵物公園"],
    description: "設有室內跑道及玩樂設施，提供舒適的寵物運動環境。",
  },
];

(async () => {
  const category = await ensureCategory("寵物公園", "🌳", 200);
  const subcategory = await ensureSubcategory(category.id, "室內寵物公園", 120);

  const results = [];

  for (const p of places) {
    const name = normalizeText(p.name);
    const district = normalizeText(p.district);
    const address = normalizeText(p.address);
    const { geo, q } = await geocodeWithFallback({ name, district, address });

    const payload = {
      category_id: category.id,
      subcategory_id: subcategory.id,
      name,
      district,
      address,
      opening_hours: null,
      latitude: geo ? geo.lat : null,
      longitude: geo ? geo.lng : null,
      image_url: null,
      has_grass: false,
      has_wash_station: false,
      has_fencing: false,
      has_parking: false,
      source: "manual",
    };

    const upserted = await supabase
      .from("guide_places")
      .upsert(payload, { onConflict: "name,address" })
      .select("id,name,district,address,latitude,longitude,category_id,subcategory_id")
      .single();

    if (upserted.error) {
      results.push({ name, ok: false, reason: upserted.error.message });
      continue;
    }

    results.push({
      name,
      ok: true,
      id: upserted.data.id,
      lat: upserted.data.latitude,
      lng: upserted.data.longitude,
      geocodeQuery: q,
      geocodeStatus: geo ? "ok" : "missing",
    });
  }

  console.log(
    JSON.stringify(
      {
        category,
        subcategory,
        imported: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error("ERROR:", e && e.message ? e.message : String(e));
  process.exit(1);
});
