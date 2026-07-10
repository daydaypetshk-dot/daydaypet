"use client";

import { useMapEvents } from "react-leaflet";

export default function MapClickCapture({
  enabled,
  onPick,
}: {
  enabled: boolean;
  onPick: (point: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  return null;
}

