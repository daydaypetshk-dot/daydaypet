"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";

type MapViewportControllerProps = {
  center: [number, number] | null;
  zoom?: number;
};

export default function MapViewportController({
  center,
  zoom = 16,
}: MapViewportControllerProps) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;
    if (!Array.isArray(center) || center.length < 2) return;
    const isValidLatLng = (lat: unknown, lng: unknown) =>
      typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng);
    const lat = center[0];
    const lng = center[1];
    if (!isValidLatLng(lat, lng)) {
      console.warn("跳過無效定位", center);
      return;
    }
    const safeZoom = typeof zoom === "number" && !Number.isNaN(zoom) ? zoom : 16;
    map.flyTo([lat, lng], safeZoom, {
      animate: true,
      duration: 0.8,
    });
  }, [center, map, zoom]);

  return null;
}
