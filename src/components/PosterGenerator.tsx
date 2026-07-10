"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PetFormValues = {
  petName: string;
  location: string;
  lostTime: string;
  features: string;
  phone: string;
  petImage: string;
  mapSnapshotUrl: string;
  qrUrl: string;
};

type PosterGeneratorProps = {
  open: boolean;
  initialValues: PetFormValues;
  onClose: () => void;
};

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

function buildQrImageUrl(qrUrl: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(
    qrUrl,
  )}`;
}

async function fetchProxiedBlob(url: string) {
  const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let details = "";
    try {
      details = await res.text();
    } catch {}
    throw new Error(`image-proxy failed (${res.status})${details ? `: ${details}` : ""}`);
  }
  return await res.blob();
}

async function loadBitmapAny(src: string) {
  if (src.startsWith("data:")) {
    const blob = await (await fetch(src)).blob();
    return await createImageBitmap(blob);
  }
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    const blob = await fetchProxiedBlob(src);
    return await createImageBitmap(blob);
  }
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function bottomRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.closePath();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const iw = (img as any).width ?? w;
  const ih = (img as any).height ?? h;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const suffix = "…";
  let t = text;
  while (t.length > 0 && ctx.measureText(t + suffix).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + suffix;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  ctx.fillText(ellipsize(ctx, text, maxWidth), x, y);
}

type PosterAssets = {
  photo: ImageBitmap;
  qr: ImageBitmap;
};

function drawPoster(ctx: CanvasRenderingContext2D, v: PetFormValues, a: PosterAssets) {
  const W = 794;
  const H = 1123;
  const pad = 54;
  const bg = "#f8fafc";

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#0b0f19";
  for (let x = 0; x < W; x += 28) {
    ctx.fillRect(x, 0, 10, H);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#dc2626";
  ctx.font = '900 78px Arial, "Noto Sans", sans-serif';
  ctx.fillText("🚨 尋 寵 啟 事", W / 2, 34);

  ctx.fillStyle = "#dc2626";
  roundedRectPath(ctx, pad, 132, W - pad * 2, 14, 999);
  ctx.fill();

  const photoX = pad;
  const photoY = 160;
  const photoW = W - pad * 2;
  const photoH = 450;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = "#ffffff";
  roundedRectPath(ctx, photoX, photoY, photoW, photoH, 28);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  roundedRectPath(ctx, photoX + 4, photoY + 4, photoW - 8, photoH - 8, 24);
  ctx.stroke();
  ctx.restore();

  drawCoverImage(ctx, a.photo, photoX + 14, photoY + 14, photoW - 28, photoH - 28, 22);

  const bubbleY = photoY + photoH + 24;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const bubbleText = v.petName.trim() || "（未命名）";
  const bubblePadX = 20;
  const bubbleW = Math.min(W - pad * 2, ctx.measureText(bubbleText).width + bubblePadX * 2);
  const bubbleH = 56;
  ctx.save();
  ctx.fillStyle = "#fef2f2";
  ctx.strokeStyle = "#fecaca";
  ctx.lineWidth = 2;
  roundedRectPath(ctx, pad, bubbleY, bubbleW, bubbleH, 999);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#dc2626";
  ctx.font = '900 30px Arial, "Noto Sans", sans-serif';
  ctx.fillText(bubbleText, pad + bubblePadX, bubbleY + bubbleH / 2);
  ctx.restore();

  const cardX = pad;
  const cardW = W - pad * 2;
  const cardH = 70;
  const cardGap = 10;
  const cardsTop = bubbleY + bubbleH + 18;

  const drawInfoCard = (idx: number, icon: string, label: string, value: string) => {
    const y = cardsTop + idx * (cardH + cardGap);

    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,0.08)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 2;
    roundedRectPath(ctx, cardX, y, cardW, cardH, 18);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const px = cardX + 18;
    const iconSize = 28;
    const iconCenterY = y + cardH / 2;

    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${iconSize}px Arial, "Noto Sans", sans-serif`;
    ctx.fillStyle = "#0b0f19";
    ctx.fillText(icon, px, iconCenterY);

    ctx.font = '800 16px Arial, "Noto Sans", sans-serif';
    ctx.fillStyle = "#64748b";
    ctx.textBaseline = "top";
    ctx.fillText(label, px + 42, y + 12);

    const valueFontPx = idx === 2 ? 28 : 26;
    ctx.font = `500 ${valueFontPx}px Arial, "Noto Sans", sans-serif`;
    ctx.fillStyle = "#0b0f19";

    const maxWidth = cardX + cardW - (px + 42);
    const startX = px + 42;
    const startY = y + 34;
    const maxLines = 2;
    const lineHeight = idx === 2 ? 34 : 32;

    const text = value.trim() || "—";
    const chars = Array.from(text);
    let line = 0;
    let cx = startX;
    let cy = startY;
    for (const ch of chars) {
      const w = ctx.measureText(ch).width;
      if (cx - startX + w > maxWidth) {
        line += 1;
        if (line >= maxLines) break;
        cx = startX;
        cy = startY + line * lineHeight;
      }
      ctx.fillText(ch, cx, cy);
      cx += w;
    }
    ctx.restore();
  };

  const formatLostTime = (timeStr: string) => {
    if (!timeStr) return "";
    try {
      const date = new Date(timeStr);
      if (!Number.isFinite(date.getTime())) return String(timeStr);

      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(date);

      const pick = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((p) => p.type === type)?.value ?? "";

      const yyyy = pick("year");
      const mm = pick("month");
      const dd = pick("day");
      const hh = pick("hour");
      const min = pick("minute");

      if (!yyyy || !mm || !dd || !hh || !min) return String(timeStr);
      return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    } catch {
      return String(timeStr);
    }
  };

  drawInfoCard(0, "📍", "走失地點", v.location);
  drawInfoCard(1, "⏰", "走失時間", formatLostTime(v.lostTime));
  drawInfoCard(2, "✨", "毛孩特徵", v.features);

  const barH = 144;
  const barY = H - barH;
  const colW = W / 12;
  const w1 = Math.round(colW * 7);
  const w2 = W - w1;
  const r = 0;

  ctx.save();
  bottomRoundedRectPath(ctx, 0, barY, W, barH, r);
  ctx.clip();

  ctx.fillStyle = "#dc2626";
  ctx.fillRect(0, barY, w1, barH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(w1, barY, w2, barH);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(w1 - 1, barY, 2, barH);

  const leftCenterX = w1 / 2;
  const leftCenterY = barY + barH / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fde047";
  ctx.font = '900 20px Arial, "Noto Sans", sans-serif';
  ctx.fillText("☎️ 發現蹤影？立刻致電主人", leftCenterX, leftCenterY - 26);

  ctx.fillStyle = "#ffffff";
  ctx.font = '900 54px Arial, "Noto Sans", sans-serif';
  ctx.fillText(v.phone.trim() || "—", leftCenterX, leftCenterY + 26);

  const qrSize = 112;
  const caption = "🔍 掃描提供最新線索";
  const gap = 6;
  const captionFont = '900 18px Arial, "Noto Sans", sans-serif';
  ctx.font = captionFont;
  const captionH = 20;
  const groupH = qrSize + gap + captionH;
  const groupTop = barY + Math.round((barH - groupH) / 2);
  const qrX = w1 + Math.round((w2 - qrSize) / 2);
  const qrY = groupTop;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(a.qr, qrX, qrY, qrSize, qrSize);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000000";
  ctx.font = captionFont;
  ctx.fillText(caption, w1 + w2 / 2, qrY + qrSize + gap);

  ctx.restore();
}

async function renderPoster(canvas: HTMLCanvasElement, values: PetFormValues) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");

  const [photo, qr] = await Promise.all([
    loadBitmapAny(values.petImage),
    loadBitmapAny(buildQrImageUrl(values.qrUrl)),
  ]);
  drawPoster(ctx, values, { photo, qr });
}

export async function downloadPosterPdf(values: PetFormValues) {
  const { jsPDF } = await import("jspdf");
  const canvas = document.createElement("canvas");
  canvas.width = 794;
  canvas.height = 1123;
  await renderPoster(canvas, values);
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  pdf.addImage(imgData, "PNG", 0, 0, 210, 297);
  pdf.save(`尋寵街招_${sanitizeFileName(values.petName || "未命名")}.pdf`);
}

export default function PosterGenerator({ open, initialValues, onClose }: PosterGeneratorProps) {
  const [values, setValues] = useState<PetFormValues>(initialValues);
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
  }, [open, initialValues]);

  const qrPreviewUrl = useMemo(() => buildQrImageUrl(values.qrUrl), [values.qrUrl]);

  useEffect(() => {
    if (!open) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    canvas.width = 794;
    canvas.height = 1123;
    setPreviewError(null);

    const seq = ++renderSeqRef.current;
    renderPoster(canvas, values).catch(() => {
      if (seq !== renderSeqRef.current) return;
      setPreviewError("預覽載入失敗（圖片網址可能不支援跨域）。建議改用上傳圖片或使用允許的圖片網址。");
    });
  }, [open, values]);

  const onPickImage: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      if (!result) return;
      setValues((prev) => ({ ...prev, petImage: result }));
    };
    reader.readAsDataURL(file);
  };

  const downloadPdf = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadPosterPdf(values);
    } catch {
      alert("下載失敗，請稍後再試。");
    } finally {
      setIsDownloading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 overflow-auto p-4">
        <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
          <div className="flex items-center justify-between border-b border-zinc-200/70 px-5 py-4">
            <div className="text-base font-black tracking-tight text-zinc-900">
              🚨 生成尋寵街招 PDF
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-zinc-100 px-3 py-2 text-sm font-bold text-zinc-900 hover:bg-zinc-200"
            >
              ❌ 關閉
            </button>
          </div>

          <div className="grid grid-cols-1 gap-0 lg:grid-cols-12">
            <div className="border-b border-zinc-200/70 p-5 lg:col-span-5 lg:border-b-0 lg:border-r">
              <div className="text-sm font-bold text-zinc-900">尋寵啟事資料輸入</div>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <Field label="寵物名字">
                  <input
                    value={values.petName}
                    onChange={(e) => setValues((p) => ({ ...p, petName: e.target.value }))}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </Field>

                <Field label="走失/目擊地點（文字）">
                  <input
                    value={values.location}
                    onChange={(e) => setValues((p) => ({ ...p, location: e.target.value }))}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </Field>

                <Field label="走失/目擊時間">
                  <input
                    value={values.lostTime}
                    onChange={(e) => setValues((p) => ({ ...p, lostTime: e.target.value }))}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </Field>

                <Field label="毛孩特徵">
                  <textarea
                    value={values.features}
                    onChange={(e) => setValues((p) => ({ ...p, features: e.target.value }))}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </Field>

                <Field label="聯絡電話">
                  <input
                    value={values.phone}
                    onChange={(e) => setValues((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </Field>

                <Field label="地圖圖片網址（海報中間地圖）">
                  <input
                    value={values.mapSnapshotUrl}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, mapSnapshotUrl: e.target.value }))
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                </Field>

                <Field label="QR Code 網址（掃描落地頁）">
                  <input
                    value={values.qrUrl}
                    onChange={(e) => setValues((p) => ({ ...p, qrUrl: e.target.value }))}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  />
                  <div className="mt-2 break-all text-xs text-zinc-500">{qrPreviewUrl}</div>
                </Field>

                <Field label="上傳寵物照片">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onPickImage}
                    className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                </Field>

                <button
                  onClick={downloadPdf}
                  disabled={isDownloading}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-2xl bg-red-600 px-4 py-3 text-base font-black text-white shadow-sm ring-1 ring-red-600/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isDownloading ? "📥 生成中…" : "📥 下載 A4 高清 PDF"}
                </button>
              </div>
            </div>

            <div className="p-5 lg:col-span-7">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-zinc-900">A4 海報即時預覽</div>
                <div className="text-xs font-medium text-zinc-500">794 × 1123 px</div>
              </div>

              <div className="mt-3 overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-black/10">
                <div className="w-full p-3">
                  <canvas
                    ref={previewCanvasRef}
                    className="block h-auto w-full rounded-xl bg-white shadow-xl"
                    style={{ aspectRatio: "794 / 1123" }}
                  />
                </div>
              </div>

              {previewError ? (
                <div className="mt-3 rounded-xl bg-red-600/10 p-3 text-sm text-red-700 ring-1 ring-red-600/20">
                  {previewError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-bold text-zinc-900">{label}</div>
      {children}
    </label>
  );
}
