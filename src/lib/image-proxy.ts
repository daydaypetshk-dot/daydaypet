function isHttpsUrl(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function toImageProxyUrl(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return isHttpsUrl(value) ? value : "";
}

export function mapImageUrlArrayWithProxy(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => toImageProxyUrl(typeof item === "string" ? item : String(item || "")));
}
