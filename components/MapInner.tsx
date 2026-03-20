"use client";
import { useState, useMemo } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useSubwayRoutes } from "@/hooks/useSubwayRoutes";
import { useSubwayStations } from "@/hooks/useSubwayStations";
import { useSimulation } from "@/hooks/useSimulation";
import SubwayLayer, { SimPathDebugLayer, GapDebugLayer } from "@/components/SubwayLayer";
import StationLayer from "@/components/StationLayer";
import TrainLayer from "@/components/TrainLayer";
import LoadingScreen from "@/components/LoadingScreen";
import { detectPathGaps } from "@/lib/simulation";

export const DC_CENTER: [number, number] = [38.9072, -77.0369];
export const DEFAULT_ZOOM = 12;

export const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
export const TILE_SUBDOMAINS = "abcd";
export const TILE_MAX_ZOOM = 20;

export default function MapInner() {
  const { routes, loading, error } = useSubwayRoutes();
  const { stations, loading: stationsLoading, error: stationsError } = useSubwayStations();

  // Debug / stations panel state
  const [showDebug, setShowDebug]         = useState(false);
  const [showStations, setShowStations]   = useState(false);
  const [excludedIds, setExcludedIds]     = useState<Set<number>>(new Set());

  // Filter routes before passing to simulation so excluded routes
  // produce no trains and no sim-path overlay
  const activeRoutes = useMemo(
    () => routes.filter((r) => !excludedIds.has(r.id)),
    [routes, excludedIds]
  );

  const { trainsRef, pathsMap } = useSimulation(activeRoutes, stations);

  const anyLoading = loading || stationsLoading;

  // Build station list grouped by physical line (one entry per routeRef).
  // Pick the direction with more stops so the full station list is shown.
  const stationsByLine = useMemo(() => {
    const byRef = new Map<string, { colour: string; name: string; stops: { stationName: string; distanceAlong: number }[] }>();
    for (const path of pathsMap.values()) {
      const prev = byRef.get(path.routeRef);
      if (!prev || path.stops.length > prev.stops.length) {
        byRef.set(path.routeRef, {
          colour: path.routeColour,
          name: path.routeName.replace(/\s+(Inbound|Outbound|Direction.*)/i, ""),
          stops: path.stops.map((s) => ({ stationName: s.stationName, distanceAlong: s.distanceAlong })),
        });
      }
    }
    return Array.from(byRef.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pathsMap]);

  // Count how many routes have at least one stitching gap
  const routesWithGaps = useMemo(() => {
    let n = 0;
    for (const path of pathsMap.values()) {
      if (detectPathGaps(path).length > 0) n++;
    }
    return n;
  }, [pathsMap]);

  function toggleExclude(id: number) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <LoadingScreen visible={anyLoading} />
      <MapContainer
        center={DC_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        data-testid="map-container"
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          subdomains={TILE_SUBDOMAINS}
          maxZoom={TILE_MAX_ZOOM}
        />
        {/* Render only active (non-excluded) OSM track segments */}
        <SubwayLayer routes={activeRoutes} />
        {showDebug && <SimPathDebugLayer pathsMap={pathsMap} />}
        {showDebug && <GapDebugLayer pathsMap={pathsMap} />}
        <StationLayer stations={stations} />
        <TrainLayer trainsRef={trainsRef} pathsMap={pathsMap} />
      </MapContainer>

      {/* ── Control buttons ─────────────────────────────────────────────────── */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 1000, display: "flex", gap: 6 }}>
        <button
          data-testid="stations-toggle"
          onClick={() => { setShowStations((v) => !v); setShowDebug(false); }}
          style={{
            background: showStations ? "#14532d" : "rgba(255,255,255,0.92)",
            color: showStations ? "#fff" : "#333",
            border: "1px solid rgba(0,0,0,0.18)",
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

        <button
          data-testid="debug-toggle"
          onClick={() => { setShowDebug((v) => !v); setShowStations(false); }}
          style={{
            background: showDebug ? "#1a1a2e" : "rgba(255,255,255,0.92)",
            color: showDebug ? "#fff" : "#333",
            border: "1px solid rgba(0,0,0,0.18)",
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            letterSpacing: "0.02em",
            userSelect: "none",
          }}
          title="Toggle simulation path overlay and route inspector"
        >
          {showDebug
            ? `▶ Debug ON${routesWithGaps > 0 ? ` · ${routesWithGaps} ⚠` : ""}`
            : "▷ Debug"}
        </button>
      </div>

      {/* ── Route inspector panel ───────────────────────────────────────────── */}
      {showDebug && (
        <div
          data-testid="route-inspector"
          style={{
            position: "absolute",
            top: 46,
            right: 12,
            zIndex: 1000,
            background: "rgba(255,255,255,0.97)",
            borderRadius: 8,
            boxShadow: "0 2px 10px rgba(0,0,0,0.22)",
            fontSize: 11,
            width: 256,
            maxHeight: "calc(100vh - 120px)",
            overflowY: "auto",
          }}
        >
          {/* Panel header */}
          <div style={{
            padding: "7px 10px",
            borderBottom: "1px solid #e0e0e0",
            fontWeight: 700,
            fontSize: 12,
            color: "#111",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span>Route Inspector · {routes.length} relations</span>
            {routesWithGaps > 0 && (
              <span style={{ color: "#cc0000", fontWeight: 700 }}>
                {routesWithGaps} ⚠
              </span>
            )}
          </div>

          {/* Legend */}
          <div style={{
            padding: "4px 10px",
            borderBottom: "1px solid #f0f0f0",
            color: "#666",
            fontSize: 10,
            lineHeight: 1.6,
          }}>
            <span style={{ marginRight: 8 }}>— — dashed white = sim path</span>
            <span style={{ color: "#cc0000" }}>● = jump &gt;300 m</span>
          </div>

          {/* Route rows */}
          {routes.map((route) => {
            const excluded = excludedIds.has(route.id);
            const path     = pathsMap.get(route.id);
            const gaps     = path ? detectPathGaps(path) : [];
            const hasGaps  = gaps.length > 0;

            return (
              <div
                key={route.id}
                style={{
                  padding: "6px 10px",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 7,
                  opacity: excluded ? 0.45 : 1,
                  background: hasGaps && !excluded ? "rgba(255,0,0,0.04)" : "transparent",
                }}
              >
                {/* Visibility checkbox */}
                <input
                  type="checkbox"
                  checked={!excluded}
                  onChange={() => toggleExclude(route.id)}
                  title={excluded ? "Show this route" : "Hide this route"}
                  style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Route colour + name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{
                      display: "inline-block",
                      width: 11,
                      height: 11,
                      borderRadius: 2,
                      background: route.colour,
                      border: "1px solid rgba(0,0,0,0.25)",
                      flexShrink: 0,
                    }} />
                    <span style={{
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "#111",
                    }}>
                      {route.name}
                    </span>
                  </div>

                  {/* OSM id + segment / waypoint counts */}
                  <div style={{ color: "#777", marginTop: 2, lineHeight: 1.5 }}>
                    ID: {route.id} · {route.segments.length} segs
                    {path && ` · ${path.waypoints.length.toLocaleString()} pts`}
                  </div>

                  {/* Gap summary */}
                  {!excluded && hasGaps && (
                    <div style={{ color: "#cc0000", marginTop: 2 }}>
                      ⚠ {gaps.length} jump{gaps.length > 1 ? "s" : ""}:{" "}
                      {gaps.map((g) => `${g.distanceKm.toFixed(1)} km`).join(", ")}
                    </div>
                  )}
                  {!excluded && !hasGaps && path && (
                    <div style={{ color: "#008844", marginTop: 2 }}>✓ Path OK</div>
                  )}
                  {excluded && (
                    <div style={{ color: "#aaa", marginTop: 2, fontStyle: "italic" }}>
                      hidden
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {routes.length === 0 && (
            <div style={{ padding: 12, color: "#999", textAlign: "center" }}>
              {loading ? "Loading routes…" : "No routes loaded"}
            </div>
          )}
        </div>
      )}

      {/* ── Stations panel ──────────────────────────────────────────────────── */}
      {showStations && (
        <div
          data-testid="stations-panel"
          style={{
            position: "absolute",
            top: 46,
            right: 12,
            zIndex: 1000,
            background: "rgba(255,255,255,0.97)",
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
            borderBottom: "1px solid #e0e0e0",
            fontWeight: 700,
            fontSize: 12,
            color: "#111",
          }}>
            Stations by Line · {stationsByLine.reduce((n, [, v]) => n + v.stops.length, 0)} total
          </div>

          {stationsByLine.length === 0 && (
            <div style={{ padding: 12, color: "#999", textAlign: "center" }}>
              {anyLoading ? "Loading…" : "No station data"}
            </div>
          )}

          {stationsByLine.map(([ref, line]) => (
            <div key={ref} style={{ borderBottom: "1px solid #f0f0f0" }}>
              {/* Line header */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 10px 4px",
                background: "#fafafa",
                position: "sticky",
                top: 0,
              }}>
                <span style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: line.colour,
                  border: "1px solid rgba(0,0,0,0.2)",
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: 700, color: "#111", fontSize: 12 }}>
                  {ref} Line
                </span>
                <span style={{ color: "#888", fontSize: 10, marginLeft: "auto" }}>
                  {line.stops.length} stations
                </span>
              </div>

              {/* Station list */}
              {line.stops.map((stop, idx) => (
                <div
                  key={stop.stationName + idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "3px 10px 3px 24px",
                    borderTop: "1px solid #f5f5f5",
                  }}
                >
                  {/* Track dot */}
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: line.colour,
                    border: "1px solid rgba(0,0,0,0.15)",
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, color: "#222" }}>{stop.stationName}</span>
                  <span style={{ color: "#aaa", fontSize: 10, flexShrink: 0 }}>
                    {stop.distanceAlong.toFixed(1)} km
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Status banners ─────────────────────────────────────────────────── */}
      {/* Loading is handled by the full-screen LoadingScreen overlay above */}
      {anyLoading && <div data-testid="subway-loading" style={{ display: "none" }} />}

      {error && (
        <div
          data-testid="subway-error"
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "rgba(255,240,240,0.95)",
            color: "#c00",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          Could not load Metro lines
        </div>
      )}

      {stationsError && !error && (
        <div
          data-testid="stations-error"
          style={{
            position: "absolute",
            bottom: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "rgba(255,240,240,0.95)",
            color: "#c00",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          Could not load station markers
        </div>
      )}
    </div>
  );
}
