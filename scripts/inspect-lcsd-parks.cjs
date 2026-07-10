const DGPG_URL = "https://www.lcsd.gov.hk/datagovhk/facility/facility-dgpg.json";
const IPFP_URL = "https://www.lcsd.gov.hk/datagovhk/facility/facility-ipfp.json";

async function fetchText(url) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json,text/plain,*/*" } });
  const contentType = res.headers.get("content-type") || "";
  const buf = new Uint8Array(await res.arrayBuffer());
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  const charset = (charsetMatch ? charsetMatch[1] : "").trim().toLowerCase();
  const preferred = charset.includes("big5") ? "big5" : "utf-8";

  const decoders = [preferred, preferred === "utf-8" ? "big5" : "utf-8"];
  for (const enc of decoders) {
    try {
      const text = new TextDecoder(enc).decode(buf);
      return { ok: true, text, contentType, encoding: enc };
    } catch {
      continue;
    }
  }

  return { ok: false, text: "", contentType, encoding: preferred };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const source = payload;
  const dgpg = (source.data && source.data.dgpg) || source.dgpg;
  if (Array.isArray(dgpg)) return dgpg;
  const records = (source.data && source.data.records) || source.records;
  if (Array.isArray(records)) return records;
  const firstArray = Object.values(source).find(Array.isArray);
  return Array.isArray(firstArray) ? firstArray : [];
}

async function inspect(url) {
  const { ok, text, contentType, encoding } = await fetchText(url);
  if (!ok) throw new Error(`Failed to decode: ${url}`);
  const json = JSON.parse(text);
  const rows = extractRows(json);
  const row0 = rows[0] || null;
  const keys = row0 && typeof row0 === "object" ? Object.keys(row0) : [];
  const sample = row0 && typeof row0 === "object" ? row0 : null;
  return { url, contentType, encoding, rows: rows.length, sample_keys: keys.slice(0, 40), sample };
}

(async () => {
  const dgpg = await inspect(DGPG_URL);
  const ipfp = await inspect(IPFP_URL);
  console.log(JSON.stringify({ dgpg, ipfp }, null, 2));
})().catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
});

