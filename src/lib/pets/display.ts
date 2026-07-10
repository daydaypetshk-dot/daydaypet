export function isInvalidLocationText(value: string) {
  const t = value.trim().toLowerCase();
  if (t.length < 2) return true;
  if (t === "na" || t === "n/a" || t === "nil" || t === "null") return true;
  if (t === "無" || t === "沒有" || t === "未知") return true;
  return false;
}

export function getDisplayAddress(location: string, manualAddress?: string | null) {
  const manual = String(manualAddress || "").trim();
  const loc = String(location || "").trim();
  if (manual && isInvalidLocationText(loc)) return manual;
  return loc || manual;
}

