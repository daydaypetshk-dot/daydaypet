const FACEBOOK_IMAGE_HOST_PATTERNS = [/^scontent[-.]/i, /\.fbcdn\.net$/i, /\.fbsbx\.com$/i];

function parseUrl(raw: string) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isFacebookImageUrl(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value) return false;
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:") return false;
  return FACEBOOK_IMAGE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname));
}

export function toImageProxyUrl(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!isFacebookImageUrl(value)) return value;
  return `/api/image-proxy?url=${encodeURIComponent(value)}`;
}

export function mapImageUrlArrayWithProxy(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => toImageProxyUrl(typeof item === "string" ? item : String(item || "")));
}
