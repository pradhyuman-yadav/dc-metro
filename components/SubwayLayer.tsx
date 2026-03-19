"use client";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { SubwayRoute } from "@/lib/overpass";
import type { RoutePath } from "@/lib/simulation";
import { detectPathGaps } from "@/lib/simulation";

/** Shared canvas renderer — all metro lines on one canvas, zero SVG overhead */
const canvasRenderer = L.canvas({ padding: 0.5 });

/**
 * Convert SubwayRoute segments to a GeoJSON FeatureCollection.
 * Renders one LineString per OSM way-segment, which faithfully reproduces the
 * exact track geometry captured in OSM (including curves, branches, and shared
 * sections between multiple lines).
 */
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

/**
 * Convert stitched+smoothed RoutePaths to a GeoJSON FeatureCollection.
 * Produces one continuous LineString per route from the simulation's internal
 * path geometry. Exported for use by tests and external consumers; the
 * SubwayLayer component itself always renders from raw OSM segments to preserve
 * the full track topology (branches, shared sections, tight curves).
 */
export function routePathsToGeoJSON(
  paths: RoutePath[]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: paths.map((path) => ({
      type: "Feature" as const,
      properties: {
        colour: path.routeColour,
        name: path.routeName,
        ref: path.routeRef,
      },
      geometry: {
        type: "LineString" as const,
        // GeoJSON is [lng, lat]; waypoints are [lat, lng]
        coordinates: path.waypoints.map(([lat, lng]) => [lng, lat]),
      },
    })),
  };
}

// ─── SimPathDebugLayer ────────────────────────────────────────────────────────

interface SimPathDebugLayerProps {
  pathsMap: Map<number, RoutePath>;
}

/**
 * Debug overlay: renders the simulation's stitched waypoint path as a thin
 * dashed white line on top of the solid OSM track.
 *
 * When the simulation path perfectly traces the OSM track, the dashed line is
 * invisible (hidden under the coloured track). Any deviation shows as a white
 * dash that departs from the track colour — making misalignments immediately
 * obvious.
 *
 * Enable via the "Show sim path" toggle in the map UI.
 */
export function SimPathDebugLayer({ pathsMap }: SimPathDebugLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (pathsMap.size === 0) return;

    const paths = Array.from(pathsMap.values());
    layerRef.current = L.geoJSON(routePathsToGeoJSON(paths), {
      ...(({ renderer: canvasRenderer } as unknown) as L.GeoJSONOptions),
      style: () => ({
        color: "#ffffff",
        weight: 2,
        opacity: 0.95,
        dashArray: "6 5",
      }),
    });

    layerRef.current.addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, pathsMap]);

  return null;
}

// ─── GapDebugLayer ────────────────────────────────────────────────────────────

/**
 * Renders a red circle marker at the midpoint of every stitching jump detected
 * in the simulation paths. Each marker shows a tooltip with the route name and
 * gap distance, making it easy to spot which routes have bad stitching.
 *
 * Enable together with SimPathDebugLayer via the "Sim path" toggle.
 */
export function GapDebugLayer({ pathsMap }: { pathsMap: Map<number, RoutePath> }) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);

  useEffect(() => {
    // Remove previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const path of pathsMap.values()) {
      const gaps = detectPathGaps(path);
      for (const gap of gaps) {
        const marker = L.circleMarker([gap.lat, gap.lng], {
          radius: 9,
          color: "#cc0000",
          fillColor: "#ff3333",
          fillOpacity: 0.9,
          weight: 2,
        });
        marker.bindTooltip(
          `<b>${path.routeName}</b><br>⚠ ${gap.distanceKm.toFixed(2)} km jump<br>` +
          `wp ${gap.fromIdx} → ${gap.toIdx}`,
          { direction: "top", offset: [0, -8] }
        );
        marker.addTo(map);
        markersRef.current.push(marker);
      }
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, pathsMap]);

  return null;
}

// ─── SubwayLayer ──────────────────────────────────────────────────────────────

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

    // Always render from original OSM segments — they faithfully capture the
    // full track network topology: branches (Red Line Y-shape), shared sections
    // (Blue/Orange/Silver through downtown), and precise curves. The stitched
    // path used by the simulation is optimised for train positioning, not for
    // visual rendering of the complete network.
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
