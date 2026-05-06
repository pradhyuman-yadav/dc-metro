"use client";
import { useMemo, useEffect, useRef, useState, useCallback } from "react";
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
import TrainHoverLayer, { type HoveredTrainInfo } from "@/components/TrainHoverLayer";
import LoadingScreen from "@/components/LoadingScreen";
import SidePanel from "@/components/SidePanel";

// ─── Line metadata (colours + display names) ─────────────────────────────────
const LINE_META: Record<string, { label: string; colour: string }> = {
  RD: { label: "Red",    colour: "#BF0D3E" },
  OR: { label: "Orange", colour: "#ED8B00" },
  SV: { label: "Silver", colour: "#919D9D" },
  BL: { label: "Blue",   colour: "#009CDE" },
  YL: { label: "Yellow", colour: "#FFD100" },
  GR: { label: "Green",  colour: "#00B140" },
};

export const DC_CENTER: [number, number] = [38.9072, -77.0369];
export const DEFAULT_ZOOM = 12;

// ~50 km radius from DC center
const MAX_BOUNDS = L.latLngBounds(
  L.latLng(38.45, -77.6),
  L.latLng(39.35, -76.5)
);

/** Captures the Leaflet map instance into a ref for use outside MapContainer. */
function MapRefCapture({ mapRef }: { mapRef: { current: L.Map | null } }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

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

/** Moves the built-in Leaflet attribution control from bottom-right to bottom-left. */
function AttributionBottomLeft() {
  const map = useMap();
  useEffect(() => {
    if (map.attributionControl) {
      map.attributionControl.setPosition("bottomleft");
    }
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

  const { trainsRef, pathsMap, stationPassengers, surgeEvents, connectionStatus, addTrain, removeTrain } =
    useSimulation(routes, stations);

  const anyLoading = loading || stationsLoading;

  // Live snapshot of trains for the side panel (refreshed every second)
  const [trainSnapshot, setTrainSnapshot] = useState<ReturnType<typeof trainsRef.current.slice>>([]);
  useEffect(() => {
    const id = setInterval(() => setTrainSnapshot([...trainsRef.current]), 1000);
    return () => clearInterval(id);
  }, [trainsRef]);

  const isDark = resolvedTheme === "dark";

  // Map ref for custom zoom controls
  const mapRef = useRef<L.Map | null>(null);
  const handleZoomIn  = useCallback(() => mapRef.current?.zoomIn(),  []);
  const handleZoomOut = useCallback(() => mapRef.current?.zoomOut(), []);

  // Train hover tooltip
  const [hoveredTrain, setHoveredTrain] = useState<HoveredTrainInfo | null>(null);
  const handleHover = useCallback((info: HoveredTrainInfo | null) => {
    setHoveredTrain(info);
  }, []);

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
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
        data-testid="map-container"
      >
        <BoundsEnforcer />
        <AttributionBottomLeft />
        <TileThemeSwitcher />
        <MapRefCapture mapRef={mapRef} />
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
        <TrainHoverLayer trainsRef={trainsRef} pathsMap={pathsMap} onHover={handleHover} />
      </MapContainer>

      {/* ── Train hover tooltip ───────────────────────────────────────────────── */}
      {hoveredTrain && (
        <TrainTooltip info={hoveredTrain} isDark={isDark} />
      )}

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
        connectionStatus={connectionStatus}
        stationsByLine={stationsByLine}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
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

// ─── Train hover tooltip ──────────────────────────────────────────────────────

function TrainTooltip({
  info,
  isDark,
}: {
  info: HoveredTrainInfo;
  isDark: boolean;
}) {
  const { train, containerX, containerY, nextStation, prevStation } = info;
  const meta = LINE_META[train.routeRef];
  const colour = meta?.colour ?? train.routeColour ?? "#888";
  const lineName = meta?.label ?? train.routeRef;

  const isAtStation = train.status === "at_station";
  const loadPct = Math.round(((train.passengers ?? 0) / 1050) * 100);
  const barColour = loadPct >= 85 ? "#ef4444" : loadPct >= 60 ? "#f59e0b" : "#22c55e";
  const dwellSec = isAtStation ? Math.ceil(train.dwellRemaining / 1000) : 0;
  const direction = train.platform === "A" ? "Inbound" : "Outbound";

  // Tooltip size ~220px wide, ~auto height — position above+right of train
  const OFFSET_X = 14;
  const OFFSET_Y = -8;

  const bg = isDark ? "rgba(24,24,27,0.97)" : "rgba(255,255,255,0.97)";
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const fg = isDark ? "#f4f4f5" : "#111827";
  const muted = isDark ? "#a1a1aa" : "#6b7280";

  return (
    <div
      style={{
        position: "absolute",
        left: containerX + OFFSET_X,
        top: containerY + OFFSET_Y,
        zIndex: 1100,
        pointerEvents: "none",
        width: 220,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Header: line dot + name + train id */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{
          flexShrink: 0, width: 10, height: 10, borderRadius: "50%",
          background: colour,
          boxShadow: `0 0 0 2px ${colour}40`,
        }} />
        <span style={{ fontWeight: 700, fontSize: 12, color: fg, flex: 1 }}>
          {lineName} Line
        </span>
        <span style={{
          fontSize: 9, fontWeight: 600, color: muted,
          fontFamily: "monospace", letterSpacing: "0.04em",
        }}>
          {train.id}
        </span>
      </div>

      {/* Status badge */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 8,
        alignSelf: "flex-start",
        background: isAtStation ? "rgba(245,158,11,0.14)" : "rgba(34,197,94,0.14)",
        color: isAtStation ? "#b45309" : "#16a34a",
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
          background: isAtStation ? "#f59e0b" : "#22c55e",
        }} />
        {isAtStation
          ? `At ${train.currentStation ?? "Platform"}${dwellSec > 0 ? ` · ${dwellSec}s` : ""}`
          : `Moving · ${direction}`}
      </div>

      {/* Stations */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {prevStation && (
          <StationRow label="Prev" name={prevStation} colour={colour} muted={muted} fg={fg} />
        )}
        {nextStation && (
          <StationRow label="Next" name={nextStation} colour={colour} muted={muted} fg={fg} />
        )}
      </div>

      {/* Passenger load bar */}
      <div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          marginBottom: 4, fontSize: 9, color: muted,
        }}>
          <span>Passenger load</span>
          <span style={{ fontWeight: 600, color: barColour }}>{loadPct}%</span>
        </div>
        <div style={{
          height: 4, borderRadius: 2, overflow: "hidden",
          background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        }}>
          <div style={{
            height: "100%", width: `${loadPct}%`,
            background: barColour, borderRadius: 2,
            transition: "width 0.3s ease",
          }} />
        </div>
        <div style={{ fontSize: 9, color: muted, marginTop: 3 }}>
          {train.passengers ?? 0} / 1050 passengers
        </div>
      </div>
    </div>
  );
}

function StationRow({
  label,
  name,
  colour,
  muted,
  fg,
}: {
  label: string;
  name: string;
  colour: string;
  muted: string;
  fg: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 8, fontWeight: 700, color: muted,
        textTransform: "uppercase", letterSpacing: "0.06em",
        width: 28, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        width: 4, height: 4, borderRadius: "50%",
        background: colour, flexShrink: 0,
      }} />
      <span style={{ fontSize: 10, color: fg, lineHeight: 1.3 }}>{name}</span>
    </div>
  );
}
