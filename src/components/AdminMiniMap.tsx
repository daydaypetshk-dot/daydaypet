"use client";

import { useEffect } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { useMap } from "react-leaflet";
import type { DivIcon } from "leaflet";

import MapClickCapture from "@/components/MapClickCapture";
import MapViewportController from "@/components/MapViewportController";

function parseLeafletCoordinate(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type AdminMiniMapProps = {
  center?: [number, number] | null;
  zoom?: number;
  className?: string;
  focusCenter?: [number, number] | null;
  focusZoom?: number;
  invalidateSizeKey?: number;
  pickEnabled: boolean;
  onPick: (point: { lat: number; lng: number }) => void;
  markerPosition?: [number, number] | null;
  markerIcon?: DivIcon | null;
};

function MapSizeInvalidator({ invalidateSizeKey }: { invalidateSizeKey: number }) {
  const map = useMap();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [invalidateSizeKey, map]);
  return null;
}

export default function AdminMiniMap({
  center,
  zoom = 13,
  className,
  focusCenter,
  focusZoom,
  invalidateSizeKey,
  pickEnabled,
  onPick,
  markerPosition,
  markerIcon,
}: AdminMiniMapProps) {
  const centerObj = center ? { lat: (center as any)[0], lng: (center as any)[1] } : null;
  if (!centerObj || centerObj.lat === undefined || centerObj.lng === undefined) {
    return (
      <div className={["relative z-0", className ?? "h-56 w-full"].join(" ")}>
        <div className="flex h-full w-full items-center justify-center bg-slate-50 text-sm font-black text-slate-600">
          正在獲取定位...
        </div>
      </div>
    );
  }

  const centerLat = parseLeafletCoordinate(centerObj.lat);
  const centerLng = parseLeafletCoordinate(centerObj.lng);
  const safeZoom = Number.isFinite(zoom) ? zoom : 13;

  if (centerLat == null || centerLng == null) {
    return (
      <div className={["relative z-0", className ?? "h-56 w-full"].join(" ")}>
        <div className="flex h-full w-full items-center justify-center bg-slate-50 text-sm font-black text-slate-600">
          正在獲取定位...
        </div>
      </div>
    );
  }

  const markerLat = parseLeafletCoordinate(markerPosition?.[0]);
  const markerLng = parseLeafletCoordinate(markerPosition?.[1]);
  const safeMarkerPosition = markerLat != null && markerLng != null ? ([markerLat, markerLng] as [number, number]) : null;

  return (
    <div className={["relative z-0", className ?? "h-56 w-full"].join(" ")}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={safeZoom}
        zoomControl={false}
        attributionControl={false}
        className="relative z-0 h-full w-full"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
        />
        <MapViewportController center={focusCenter ?? null} zoom={focusZoom} />
        {typeof invalidateSizeKey === "number" ? <MapSizeInvalidator invalidateSizeKey={invalidateSizeKey} /> : null}
        <MapClickCapture enabled={pickEnabled} onPick={onPick} />
        {safeMarkerPosition && markerIcon ? <Marker position={safeMarkerPosition} icon={markerIcon} /> : null}
      </MapContainer>
    </div>
  );
}
