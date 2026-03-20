"use client";
import { useState } from "react";
import { CircleMarker, Tooltip, useMapEvents } from "react-leaflet";
import type { SubwayStation } from "@/lib/overpass";
import { SUBWAY_COLOUR_FALLBACK } from "@/lib/overpass";

export const MIN_STATION_ZOOM = 11;

interface StationLayerProps {
  stations: SubwayStation[];
}

export default function StationLayer({ stations }: StationLayerProps) {
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
       * Render all outer black rings first so they paint beneath every inner dot.
       * SVG painters-algorithm: last element rendered = on top.
       *
       * Each station gets two concentric CircleMarkers:
       *   1. Outer ring  — radius 9, solid black fill, no stroke
       *   2. Inner dot   — radius 5, line colour fill, 2 px white stroke
       *
       * The 2 px white stroke on the inner dot sits in the gap between the two
       * radii (9 px vs 5 px + 2 px half-stroke = 6 px), producing a visible
       * white band that separates the black ring from the coloured centre.
       */}

      {/* Pass 1: outer black rings (below) */}
      {stations.map((station) => (
        <CircleMarker
          key={`${station.id}-ring`}
          center={[station.lat, station.lng]}
          radius={9}
          fillColor="#111111"
          color="#111111"
          weight={0}
          fillOpacity={1}
          opacity={1}
          interactive={false}
        />
      ))}

      {/* Pass 2: inner coloured dots with white gap-stroke (above) */}
      {stations.map((station) => (
        <CircleMarker
          key={`${station.id}-dot`}
          center={[station.lat, station.lng]}
          radius={5}
          fillColor={station.colours[0] ?? SUBWAY_COLOUR_FALLBACK}
          color="#ffffff"
          weight={2}
          fillOpacity={1}
          opacity={1}
        >
          <Tooltip>{station.name}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
