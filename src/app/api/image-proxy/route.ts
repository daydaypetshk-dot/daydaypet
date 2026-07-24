export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set([
  "images.unsplash.com",
  "api.qrserver.com",
  "staticmap.openstreetmap.de",
  "a.basemaps.cartocdn.com",
  "b.basemaps.cartocdn.com",
  "c.basemaps.cartocdn.com",
  "d.basemaps.cartocdn.com",
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get("url");
  if (!rawUrl) {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }

  if (target.protocol !== "https:") {
    return Response.json({ error: "Invalid protocol" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return Response.json({ error: "Host not allowed" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[image-proxy] upstream fetch failed", { url: target.toString(), error });
    return Response.json({ error: "Upstream fetch failed" }, { status: 502 });
  }
  if (!upstream.ok) {
    console.error("[image-proxy] upstream error", { url: target.toString(), status: upstream.status });
    return Response.json({ error: "Upstream error", status: upstream.status }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
