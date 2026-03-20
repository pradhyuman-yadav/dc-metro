"use client";
import { useState } from "react";
import { CircleMarker, Tooltip, useMapEvents } from "react-leaflet";
import type { SubwayStation } from "@/lib/overpass";
import { SUBWAY_COLOUR_FALLBACK } from "@/lib/overpass";
import type { StationPassengerState } from "@/lib/simulation";

export const MIN_STATION_ZOOM = 11;

interface StationLayerProps {
  stations: SubwayStation[];
  stationPassengers?: Map<string, StationPassengerState>;
}

/**
 * Returns the outer ring radius based on station passenger capacity.
 * Range: 7–14 px (capacity 300 → 1200).
 */
function getStationRadius(capacity: number): number {
  return 7 + Math.log2(capacity / 300) * 2.5;
}

/**
 * Returns a load-based colour from green → yellow → red.
 * 0% load = #22c55e (green), 50% = #eab308 (yellow), 100% = #ef4444 (red).
 */
function getLoadColor(current: number, capacity: number): string {
  const pct = capacity > 0 ? Math.min(1, current / capacity) : 0;

  let r: number, g: number, b: number;
  if (pct < 0.5) {
    // green (#22c55e) → yellow (#eab308)
    const t = pct * 2;
    r = Math.round(0x22 + t * (0xea - 0x22));
    g = Math.round(0xc5 + t * (0xb3 - 0xc5));
    b = Math.round(0x5e + t * (0x08 - 0x5e));
  } else {
    // yellow (#eab308) → red (#ef4444)
    const t = (pct - 0.5) * 2;
    r = Math.round(0xea + t * (0xef - 0xea));
    g = Math.round(0xb3 + t * (0x44 - 0xb3));
    b = Math.round(0x08 + t * (0x44 - 0x08));
  }

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default function StationLayer({
  stations,
  stationPassengers = new Map(),
}: StationLayerProps) {
  const [visible, setVisible] = useState(true);

  useMapEvents({
    load(e) {
      setVisible(e.target.getZoom() >= MIN_STATION_ZOOM);
    },
    zoom(e) {
      setVisible(e.target.getZoom() >= MIN_STATION_ZOOM);
    },
  });

  if (!visible || stations.length === 0) return null;

  return (
    <>
      {/*
       * Render all outer rings first so they paint beneath every inner dot.
       * SVG painters-algorithm: last element rendered = on top.
       *
       * Each station gets three concentric layers:
       *   1. Background ring  — full circle, neutral track colour, thin stroke
       *   2. Progress arc     — stroke-dasharray clockwise fill, load colour
       *   3. Inner dot        — station line colour, white gap stroke
       *
       * The progress arc uses stroke-dasharray to draw only the "filled"
       * portion of the circumference. A CSS class rotates it -90° so the
       * arc starts at 12 o'clock and fills clockwise.
       */}

      {/* Pass 1: background track rings (neutral full circle) */}
      {stations.map((station) => {
        const sp = stationPassengers.get(station.name);
        const capacity = sp?.capacity ?? 500;
        const radius = getStationRadius(capacity);
        return (
          <CircleMarker
            key={`${station.id}-bg`}
            center={[station.lat, station.lng]}
            radius={radius}
            pathOptions={{
              fill: false,
              color: "rgba(150,150,150,0.25)",
              weight: 3,
              opacity: 1,
              interactive: false,
            } as object}
          />
        );
      })}

      {/* Pass 2: clockwise progress arcs (load %) */}
      {stations.map((station) => {
        const sp = stationPassengers.get(station.name);
        const capacity = sp?.capacity ?? 500;
        const current = sp?.current ?? 0;
        const radius = getStationRadius(capacity);
        const loadColor = getLoadColor(current, capacity);
        const circumference = 2 * Math.PI * radius;
        const loadPct = capacity > 0 ? Math.min(1, current / capacity) : 0;
        const filled = Math.max(0.01, loadPct * circumference);
        const gap = circumference - filled;
        return (
          <CircleMarker
            key={`${station.id}-ring`}
            center={[station.lat, station.lng]}
            radius={radius}
            pathOptions={{
              fill: false,
              color: loadColor,
              weight: 3,
              opacity: 1,
              dashArray: `${filled.toFixed(2)} ${gap.toFixed(2)}`,
              className: "station-ring",
              interactive: false,
            } as object}
          />
        );
      })}

      {/* Pass 3: inner coloured dots with white gap-stroke (above) */}
      {stations.map((station) => {
        const sp = stationPassengers.get(station.name);
        const capacity = sp?.capacity ?? 500;
        const current = sp?.current ?? 0;
        return (
          <CircleMarker
            key={`${station.id}-dot`}
            center={[station.lat, station.lng]}
            radius={5}
            pathOptions={{
              fillColor: station.colours[0] ?? SUBWAY_COLOUR_FALLBACK,
              color: "#ffffff",
              weight: 2,
              fillOpacity: 1,
              opacity: 1,
            } as object}
          >
            <Tooltip>
              {station.name} · {Math.floor(current)}/{capacity} passengers
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
