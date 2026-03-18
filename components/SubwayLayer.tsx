"use client";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { SubwayRoute } from "@/lib/overpass";

/** Shared canvas renderer — all metro lines on one canvas, zero SVG overhead */
const canvasRenderer = L.canvas({ padding: 0.5 });

/** Convert SubwayRoute segments to a GeoJSON FeatureCollection */
export function subwayRoutesToGeoJSON(
  routes: SubwayRoute[]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) =>
      route.segments.map((segment) => ({
        type: "Feature" as const,
        properties: { colour: route.colour, name: route.name, ref: route.ref },
        geometry: {
          type: "LineString" as const,
          // GeoJSON is [lng, lat]; Leaflet segments are [lat, lng]
          coordinates: segment.map(([lat, lng]) => [lng, lat]),
        },
      }))
    ),
  };
}

interface SubwayLayerProps {
  routes: SubwayRoute[];
}

export default function SubwayLayer({ routes }: SubwayLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (routes.length === 0) return;

    layerRef.current = L.geoJSON(subwayRoutesToGeoJSON(routes), {
      // renderer is valid at runtime but absent from @types/leaflet GeoJSONOptions
      ...(({ renderer: canvasRenderer } as unknown) as L.GeoJSONOptions),
      style: (feature) => ({
        color: feature?.properties?.colour ?? "#666666",
        weight: 4,
        opacity: 0.9,
      }),
    });

    layerRef.current.addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, routes]);

  return null;
}
