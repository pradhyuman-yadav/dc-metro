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
      {stations.map((station) => (
        <CircleMarker
          key={station.id}
          center={[station.lat, station.lng]}
          radius={6}
          fillColor={station.colours[0] ?? SUBWAY_COLOUR_FALLBACK}
          color="#ffffff"
          weight={2}
          fillOpacity={0.9}
          opacity={1}
        >
          <Tooltip>{station.name}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
