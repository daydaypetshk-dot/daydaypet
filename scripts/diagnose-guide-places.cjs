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

function coordKey(lat, lng) {
  return `${String(lat)},${String(lng)}`;
}

(async () => {
  const sample = await supabase
    .from("guide_places")
    .select("id,name,latitude,longitude,created_at")
    .order("created_at", { ascending: true })
    .limit(10);

  if (sample.error) throw sample.error;

  console.log("--- sample_first_10 ---");
  console.log(JSON.stringify(sample.data ?? [], null, 2));

  const allRes = await supabase.from("guide_places").select("id,name,latitude,longitude").limit(5000);
  if (allRes.error) throw allRes.error;

  const rows = allRes.data ?? [];
  const counts = new Map();

  for (const row of rows) {
    const key = coordKey(row.latitude, row.longitude);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const topDuplicates = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log("--- coord_stats ---");
  console.log(
    JSON.stringify(
      {
        total_rows: rows.length,
        unique_coords: counts.size,
        top_duplicates: topDuplicates,
      },
      null,
      2,
    ),
  );

  const topKey = topDuplicates[0]?.[0] ?? null;
  const topCount = topDuplicates[0]?.[1] ?? 0;

  if (topKey && topCount > 1) {
    const [latStr, lngStr] = topKey.split(",");
    const lat = latStr === "null" ? null : Number(latStr);
    const lng = lngStr === "null" ? null : Number(lngStr);
    const examples = rows
      .filter((r) => r.latitude === lat && r.longitude === lng)
      .slice(0, 20)
      .map((r) => ({ id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude }));

    console.log("--- top_duplicate_examples ---");
    console.log(JSON.stringify({ coord: topKey, count: topCount, examples }, null, 2));
  }
})().catch((e) => {
  console.error("ERROR:", e && e.message ? e.message : String(e));
  process.exit(1);
});

