"use client";

import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
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

export type SosMapCanvasProps = {
  center: [number, number] | null;
  zoom: number;
  className?: string;
  focusCenter: [number, number] | null;
  focusZoom?: number;
  isPickLocationMode: boolean;
  onPick: (point: { lat: number; lng: number }) => void;
  cases: Array<{
    id: string;
    position: [number, number];
    enablePrivacy: boolean;
    pulseColor: "red" | "blue" | "green";
  }>;
  iconByCaseId: Map<string, DivIcon>;
  guidePlaces: Array<{
    id: string;
    position: [number, number];
    title: string;
    address: string;
    district: string;
    openingHours: string | null;
    imageUrl: string | null;
    categoryLabel: string;
    subcategoryLabel: string;
    featureBadges: string[];
  }>;
  guideIconByPlaceId: Map<string, DivIcon>;
  onMarkerClick: (id: string) => void;
  reportMarkerPosition: [number, number] | null;
  reportLocationIcon: DivIcon | null;
  myLocationPosition?: [number, number] | null;
  myLocationAccuracyMeters?: number | null;
  myLocationIcon?: DivIcon | null;
};

export default function SosMapCanvas({
  center,
  zoom,
  className,
  focusCenter,
  focusZoom,
  isPickLocationMode,
  onPick,
  cases,
  iconByCaseId,
  guidePlaces,
  guideIconByPlaceId,
  onMarkerClick,
  reportMarkerPosition,
  reportLocationIcon,
  myLocationPosition,
  myLocationAccuracyMeters,
  myLocationIcon,
}: SosMapCanvasProps) {
  const centerObj = center ? { lat: (center as any)[0], lng: (center as any)[1] } : null;
  if (!centerObj || centerObj.lat === undefined || centerObj.lng === undefined) {
    return (
      <div className={className ?? "h-full w-full"}>
        <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-50 text-sm font-black text-slate-600">
          正在獲取定位...
        </div>
      </div>
    );
  }

  const centerLat = parseLeafletCoordinate(centerObj.lat);
  const centerLng = parseLeafletCoordinate(centerObj.lng);
  const safeZoom = Number.isFinite(zoom) ? zoom : 15;
  const safeCases = Array.isArray(cases) ? cases : [];
  const safeGuidePlaces = Array.isArray(guidePlaces) ? guidePlaces : [];

  if (centerLat == null || centerLng == null) {
    return (
      <div className={className ?? "h-full w-full"}>
        <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-50 text-sm font-black text-slate-600">
          正在獲取定位...
        </div>
      </div>
    );
  }

  return (
    <MapContainer
      center={[centerLat, centerLng]}
      zoom={safeZoom}
      zoomControl={false}
      attributionControl={false}
      className={className ?? "h-full w-full"}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
      />
      <MapViewportController center={focusCenter} zoom={focusZoom} />
      <MapClickCapture enabled={isPickLocationMode} onPick={onPick} />

      {safeCases.map((c) => {
        try {
          const lat = parseLeafletCoordinate(c.position?.[0]);
          const lng = parseLeafletCoordinate(c.position?.[1]);
          if (lat == null || lng == null) {
            console.error("Invalid SOS marker coordinates:", c.id, c.position);
            return null;
          }

          if (c.enablePrivacy) {
            const circleColor = c.pulseColor === "red" ? "#ef4444" : c.pulseColor === "green" ? "#22c55e" : "#3b82f6";
            const markerIcon = iconByCaseId.get(c.id);
            return [
              <Circle
                key={`${c.id}:circle`}
                center={[lat, lng]}
                radius={100}
                pathOptions={{
                  color: circleColor,
                  fillColor: circleColor,
                  fillOpacity: 0.25,
                  weight: 1,
                }}
                eventHandlers={{
                  click: () => onMarkerClick(c.id),
                }}
              />,
              markerIcon ? (
                <Marker
                  key={`${c.id}:marker`}
                  position={[lat, lng]}
                  icon={markerIcon}
                  eventHandlers={{
                    click: () => onMarkerClick(c.id),
                  }}
                />
              ) : null,
            ];
          }

          const markerIcon = iconByCaseId.get(c.id);
          if (!markerIcon) return null;
          return (
            <Marker
              key={c.id}
              position={[lat, lng]}
              icon={markerIcon}
              eventHandlers={{
                click: () => onMarkerClick(c.id),
              }}
            />
          );
        } catch (error) {
          console.error("Failed to render SOS marker:", c.id, error);
          return null;
        }
      })}

      {safeGuidePlaces.map((place) => {
        try {
          const lat = parseLeafletCoordinate(place.position?.[0]);
          const lng = parseLeafletCoordinate(place.position?.[1]);
          if (lat == null || lng == null) {
            console.error("Invalid guide place marker coordinates:", place.id, place.position);
            return null;
          }

          const markerIcon = guideIconByPlaceId.get(place.id);
          if (!markerIcon) return null;

          return (
            <Marker
              key={place.id}
              position={[lat, lng]}
              icon={markerIcon}
              eventHandlers={{
                click: () => onMarkerClick(place.id),
              }}
            />
          );
        } catch (error) {
          console.error("Failed to render guide place marker:", place.id, error);
          return null;
        }
      })}

      {(() => {
        const lat = parseLeafletCoordinate(reportMarkerPosition?.[0]);
        const lng = parseLeafletCoordinate(reportMarkerPosition?.[1]);
        if (lat == null || lng == null || !reportLocationIcon) return null;
        return <Marker position={[lat, lng]} icon={reportLocationIcon} />;
      })()}

      {(() => {
        const lat = parseLeafletCoordinate(myLocationPosition?.[0]);
        const lng = parseLeafletCoordinate(myLocationPosition?.[1]);
        if (lat == null || lng == null || !myLocationIcon) return null;
        const accuracy = typeof myLocationAccuracyMeters === "number" && Number.isFinite(myLocationAccuracyMeters) ? myLocationAccuracyMeters : null;
        return [
          accuracy != null && accuracy > 0 ? (
            <Circle
              key="my-location:accuracy"
              center={[lat, lng]}
              radius={Math.min(Math.max(accuracy, 10), 350)}
              pathOptions={{
                color: "#3b82f6",
                fillColor: "#3b82f6",
                fillOpacity: 0.12,
                weight: 1,
              }}
            />
          ) : null,
          <Marker key="my-location:marker" position={[lat, lng]} icon={myLocationIcon} />,
        ];
      })()}
    </MapContainer>
  );
}
