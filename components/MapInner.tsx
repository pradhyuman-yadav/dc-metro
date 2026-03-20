"use client";
import { useState, useMemo, useEffect, useRef } from "react";
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
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
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

  const { trainsRef, pathsMap } = useSimulation(routes, stations);

  const anyLoading = loading || stationsLoading;

  // Live snapshot of trains for the side panel (refreshed every second)
  const [trainSnapshot, setTrainSnapshot] = useState<ReturnType<typeof trainsRef.current.slice>>([]);
  useEffect(() => {
    const id = setInterval(() => setTrainSnapshot([...trainsRef.current]), 1000);
    return () => clearInterval(id);
  }, [trainsRef]);

  const isDark = resolvedTheme === "dark";

  // Stations panel state
  const [showStations, setShowStations] = useState(false);

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
        <StationLayer stations={stations} />
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

      {/* ── Left side panel ─────────────────────────────────────────────────── */}
      <SidePanel trains={trainSnapshot} pathsMap={pathsMap} />

      {/* ── Stations button (top-right) ──────────────────────────────────────── */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 1000 }}>
        <button
          data-testid="stations-toggle"
          onClick={() => setShowStations((v) => !v)}
          style={{
            background: showStations
              ? (isDark ? "#14532d" : "#14532d")
              : (isDark ? "rgba(24,24,27,0.92)" : "rgba(255,255,255,0.92)"),
            color: showStations ? "#fff" : (isDark ? "#e4e4e7" : "#333"),
            border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.18)"}`,
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            letterSpacing: "0.02em",
            userSelect: "none",
          }}
          title="Show stations per line"
        >
          {showStations ? "✕ Stations" : "🚉 Stations"}
        </button>
      </div>

      {/* ── Stations panel ──────────────────────────────────────────────────── */}
      {showStations && (
        <div
          data-testid="stations-panel"
          style={{
            position: "absolute",
            top: 46,
            right: 12,
            zIndex: 1000,
            background: isDark ? "rgba(24,24,27,0.97)" : "rgba(255,255,255,0.97)",
            color: isDark ? "#e4e4e7" : "#111",
            borderRadius: 8,
            boxShadow: "0 2px 10px rgba(0,0,0,0.22)",
            fontSize: 11,
            width: 280,
            maxHeight: "calc(100vh - 120px)",
            overflowY: "auto",
          }}
        >
          <div style={{
            padding: "7px 10px",
            borderBottom: `1px solid ${isDark ? "#3f3f46" : "#e0e0e0"}`,
            fontWeight: 700,
            fontSize: 12,
          }}>
            Stations by Line · {stationsByLine.reduce((n, [, v]) => n + v.stops.length, 0)} total
          </div>

          {stationsByLine.length === 0 && (
            <div style={{ padding: 12, color: "#999", textAlign: "center" }}>
              {anyLoading ? "Loading…" : "No station data"}
            </div>
          )}

          {stationsByLine.map(([ref, line]) => (
            <div key={ref} style={{ borderBottom: `1px solid ${isDark ? "#27272a" : "#f0f0f0"}` }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "6px 10px 4px",
                background: isDark ? "#18181b" : "#fafafa",
                position: "sticky", top: 0,
              }}>
                <span style={{
                  display: "inline-block", width: 14, height: 14,
                  borderRadius: 3, background: line.colour,
                  border: "1px solid rgba(0,0,0,0.2)", flexShrink: 0,
                }} />
                <span style={{ fontWeight: 700, fontSize: 12 }}>{ref} Line</span>
                <span style={{ color: "#888", fontSize: 10, marginLeft: "auto" }}>
                  {line.stops.length} stations
                </span>
              </div>
              {line.stops.map((stop, idx) => (
                <div key={stop.stationName + idx} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "3px 10px 3px 24px",
                  borderTop: `1px solid ${isDark ? "#27272a" : "#f5f5f5"}`,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: line.colour,
                    border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0,
                  }} />
                  <span style={{ flex: 1 }}>{stop.stationName}</span>
                  <span style={{ color: "#aaa", fontSize: 10, flexShrink: 0 }}>
                    {stop.distanceAlong.toFixed(1)} km
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

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
