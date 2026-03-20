"use client";
import { useMemo, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { useTheme } from "next-themes";
import "leaflet/dist/leaflet.css";
import { useSubwayRoutes } from "@/hooks/useSubwayRoutes";
import { useSubwayStations } from "@/hooks/useSubwayStations";
import { useSimulation } from "@/hooks/useSimulation";
import SubwayLayer from "@/components/SubwayLayer";
import StationLayer from "@/components/StationLayer";
import TrainLayer from "@/components/TrainLayer";
import LoadingScreen from "@/components/LoadingScreen";
import SidePanel from "@/components/SidePanel";

export const DC_CENTER: [number, number] = [38.9072, -77.0369];
export const DEFAULT_ZOOM = 12;

// ~50 km radius from DC center
const MAX_BOUNDS = L.latLngBounds(
  L.latLng(38.45, -77.6),
  L.latLng(39.35, -76.5)
);

/** Imperatively applies maxBounds after the Leaflet map has mounted. */
function BoundsEnforcer() {
  const map = useMap();
  useEffect(() => {
    map.setMaxBounds(MAX_BOUNDS);
    map.options.maxBoundsViscosity = 1.0;
    map.options.minZoom = 10;
  }, [map]);
  return null;
}

const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_DARK  = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

export const TILE_URL         = TILE_LIGHT; // exported for tests
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> | Built by <a href="https://github.com/pradhyuman-yadav" target="_blank" rel="noopener noreferrer">Pradhyuman</a>';
export const TILE_SUBDOMAINS  = "abcd";
export const TILE_MAX_ZOOM    = 20;

/** Swaps the tile layer URL when the theme changes without remounting the map. */
function TileThemeSwitcher() {
  const { resolvedTheme } = useTheme();
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const url = resolvedTheme === "dark" ? TILE_DARK : TILE_LIGHT;
    if (layerRef.current) {
      layerRef.current.setUrl(url);
    } else {
      const layer = L.tileLayer(url, {
        attribution: TILE_ATTRIBUTION,
        subdomains: TILE_SUBDOMAINS,
        maxZoom: TILE_MAX_ZOOM,
      }).addTo(map);
      layerRef.current = layer;
    }
  }, [resolvedTheme, map]);

  return null;
}

export default function MapInner() {
  const { routes, loading, error } = useSubwayRoutes();
  const { stations, loading: stationsLoading, error: stationsError } = useSubwayStations();
  const { resolvedTheme } = useTheme();

  const { trainsRef, pathsMap, stationPassengers, surgeEvents, addTrain, removeTrain } =
    useSimulation(routes, stations);

  const anyLoading = loading || stationsLoading;

  // Live snapshot of trains for the side panel (refreshed every second)
  const [trainSnapshot, setTrainSnapshot] = useState<ReturnType<typeof trainsRef.current.slice>>([]);
  useEffect(() => {
    const id = setInterval(() => setTrainSnapshot([...trainsRef.current]), 1000);
    return () => clearInterval(id);
  }, [trainsRef]);

  const isDark = resolvedTheme === "dark";

  // Stations by line data (passed to side panel)
  const stationsByLine = useMemo(() => {
    const byRef = new Map<string, { colour: string; stops: { stationName: string; distanceAlong: number }[] }>();
    for (const path of pathsMap.values()) {
      const prev = byRef.get(path.routeRef);
      if (!prev || path.stops.length > prev.stops.length) {
        byRef.set(path.routeRef, {
          colour: path.routeColour,
          stops: path.stops.map((s) => ({ stationName: s.stationName, distanceAlong: s.distanceAlong })),
        });
      }
    }
    return Array.from(byRef.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pathsMap]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <LoadingScreen visible={anyLoading} />

      <MapContainer
        center={DC_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={10}
        maxBounds={[[38.45, -77.6], [39.35, -76.5]]}
        maxBoundsViscosity={1.0}
        style={{ height: "100%", width: "100%" }}
        data-testid="map-container"
      >
        <BoundsEnforcer />
        <TileThemeSwitcher />
        {/* Base tile layer for initial render (TileThemeSwitcher takes over after mount) */}
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={isDark ? TILE_DARK : TILE_LIGHT}
          subdomains={TILE_SUBDOMAINS}
          maxZoom={TILE_MAX_ZOOM}
        />
        <SubwayLayer routes={routes} />
        <StationLayer stations={stations} stationPassengers={stationPassengers} />
        <TrainLayer trainsRef={trainsRef} pathsMap={pathsMap} />
      </MapContainer>

      {/* Vignette fade overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 999,
          pointerEvents: "none",
          background: isDark
            ? "radial-gradient(ellipse at center, transparent 42%, rgba(10,10,10,0.25) 60%, rgba(10,10,10,0.65) 76%, rgba(10,10,10,0.88) 88%, rgba(10,10,10,0.97) 96%, rgb(10,10,10) 100%)"
            : "radial-gradient(ellipse at center, transparent 42%, rgba(240,240,240,0.25) 60%, rgba(230,230,230,0.65) 76%, rgba(220,220,220,0.88) 88%, rgba(210,210,210,0.97) 96%, rgb(200,200,200) 100%)",
        }}
      />

      {/* ── Right side panel ─────────────────────────────────────────────────── */}
      <SidePanel
        trains={trainSnapshot}
        pathsMap={pathsMap}
        stationPassengers={stationPassengers}
        surgeEvents={surgeEvents}
        addTrain={addTrain}
        removeTrain={removeTrain}
        stationsByLine={stationsByLine}
      />

      {/* ── Status banners ───────────────────────────────────────────────────── */}
      {anyLoading && <div data-testid="subway-loading" style={{ display: "none" }} />}

      {error && (
        <div
          data-testid="subway-error"
          style={{
            position: "absolute", bottom: 24, left: "50%",
            transform: "translateX(-50%)", zIndex: 1000,
            background: "rgba(255,240,240,0.95)", color: "#c00",
            padding: "6px 14px", borderRadius: 20, fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)", pointerEvents: "none",
          }}
        >
          Could not load Metro lines
        </div>
      )}

      {stationsError && !error && (
        <div
          data-testid="stations-error"
          style={{
            position: "absolute", bottom: 60, left: "50%",
            transform: "translateX(-50%)", zIndex: 1000,
            background: "rgba(255,240,240,0.95)", color: "#c00",
            padding: "6px 14px", borderRadius: 20, fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)", pointerEvents: "none",
          }}
        >
          Could not load station markers
        </div>
      )}
    </div>
  );
}
