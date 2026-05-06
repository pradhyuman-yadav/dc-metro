"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BonusesIncentivesCard } from "@/components/ui/animated-dashboard-card";
import { AccordionCards } from "@/components/ui/expandable-card";
import { getMetroServiceLabel } from "@/lib/simulation";
import type { TrainState, StationPassengerState, RoutePath } from "@/lib/simulation";
import type { SurgeEvent, ConnectionStatus } from "@/hooks/useSimulation";

function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// WMATA multi-level intersecting stations — two physically separate platforms/levels.
// Each entry: [stationName, [groupA routeRefs, groupB routeRefs]]
// Count as 2 only when both groups have at least one active route serving that station.
const MULTI_LEVEL_STATIONS: [string, [string[], string[]]][] = [
  ["Metro Center",            [["RD"],            ["BL", "OR", "SV"]]],
  ["Gallery Place-Chinatown", [["RD"],            ["GR", "YL"]]],
  ["L'Enfant Plaza",          [["BL", "OR", "SV"], ["GR", "YL"]]],
  ["Fort Totten",             [["RD"],            ["GR", "YL"]]],
];

// WMATA line colours → display names
const LINE_META: Record<string, { label: string; colour: string }> = {
  RD: { label: "Red",    colour: "#BF0D3E" },
  OR: { label: "Orange", colour: "#ED8B00" },
  SV: { label: "Silver", colour: "#919D9D" },
  BL: { label: "Blue",   colour: "#009CDE" },
  YL: { label: "Yellow", colour: "#FFD100" },
  GR: { label: "Green",  colour: "#00B140" },
};

const METRO_LINE_INFO = [
  {
    title: "Red Line",
    description: "Shady Grove to Glenmont · 27 stations",
    content: (
      <p>
        The Red Line runs through the heart of DC, connecting Montgomery County, MD at Shady
        Grove through downtown stations including Dupont Circle, Farragut North, Metro Center,
        Judiciary Square, and Union Station, terminating at Glenmont.
      </p>
    ),
  },
  {
    title: "Blue / Orange / Silver Lines",
    description: "Shared Rosslyn–Addison Rd corridor",
    content: (
      <p>
        Three lines share the trunk between Rosslyn and Stadium-Armory. Blue runs
        Franconia-Springfield to Largo; Orange runs Vienna to New Carrollton; Silver
        runs Ashburn (via Dulles Airport) to Largo Town Center.
      </p>
    ),
  },
  {
    title: "Green / Yellow Lines",
    description: "Branch Ave / Huntington to Greenbelt",
    content: (
      <p>
        Green runs Branch Ave to Greenbelt via Anacostia, L&apos;Enfant Plaza, and Gallery
        Place. Yellow shares the segment from Huntington through Pentagon to Mt Vernon
        Sq/7th St-Convention Center, then splits toward Greenbelt.
      </p>
    ),
  },
];

const cardStyle: React.CSSProperties = {
  background: "var(--card, rgba(255,255,255,0.95))",
  border: "1px solid var(--color-border, rgba(0,0,0,0.1))",
  borderRadius: 12,
  padding: 20,
};

// ─── Toast ───────────────────────────────────────────────────────────────────

interface Toast { id: number; message: string }

let _toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((message: string) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  return { toasts, addToast };
}

// ─── SidePanelProps ──────────────────────────────────────────────────────────

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, colour, width = 60, height = 18 }: {
  data: number[];
  colour: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (v / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      style={{ verticalAlign: "middle", overflow: "visible" }}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  );
}

// ─── SidePanelProps ──────────────────────────────────────────────────────────

interface SidePanelProps {
  trains: TrainState[];
  pathsMap: Map<number, RoutePath>;
  stationPassengers: Map<string, StationPassengerState>;
  surgeEvents: SurgeEvent[];
  connectionStatus: ConnectionStatus;
  addTrain: (routeRef: string, onError?: (err: Error) => void) => void;
  removeTrain: (routeRef: string, onError?: (err: Error) => void) => void;
  /** Last 60 s of total-waiting-passengers samples (1 per second) */
  passengerHistory?: number[];
  stationsByLine: Array<[string, { colour: string; stops: { stationName: string; distanceAlong: number }[] }]>;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

export default function SidePanel({
  trains,
  pathsMap,
  stationPassengers,
  surgeEvents,
  connectionStatus,
  addTrain,
  removeTrain,
  stationsByLine,
  passengerHistory = [],
  onZoomIn,
  onZoomOut,
}: SidePanelProps) {
  const { toasts, addToast } = useToasts();
  const movingCount   = trains.filter((t) => t.status === "moving").length;
  const dwellingCount = trains.filter((t) => t.status === "at_station").length;

  const activeRefs = Array.from(new Set(trains.map((t) => t.routeRef))).sort();

  const stationCountByRef = useMemo(() => {
    const m = new Map<string, number>();
    for (const path of pathsMap.values()) {
      const prev = m.get(path.routeRef) ?? 0;
      if (path.stops.length > prev) m.set(path.routeRef, path.stops.length);
    }
    return m;
  }, [pathsMap]);

  const totalStations = useMemo(() => {
    // Build: station name → set of routeRefs actively serving it
    const stationRefs = new Map<string, Set<string>>();
    for (const path of pathsMap.values()) {
      for (const stop of path.stops) {
        if (!stationRefs.has(stop.stationName)) stationRefs.set(stop.stationName, new Set());
        stationRefs.get(stop.stationName)!.add(path.routeRef);
      }
    }
    // Base: unique physical station names
    let count = stationRefs.size;
    // Add +1 for each multi-level station where both level groups are active
    for (const [name, [groupA, groupB]] of MULTI_LEVEL_STATIONS) {
      if (!stationRefs.has(name)) continue;
      const active = stationRefs.get(name)!;
      if (groupA.some((r) => active.has(r)) && groupB.some((r) => active.has(r))) count += 1;
    }
    return count;
  }, [pathsMap]);

  // Passenger totals
  const totalAboard  = trains.reduce((s, t) => s + (t.passengers ?? 0), 0);
  const totalWaiting = Math.floor(
    Array.from(stationPassengers.values()).reduce((s, v) => s + v.current, 0)
  );
  const avgLoad = trains.length > 0
    ? Math.round((totalAboard / (trains.length * 1050)) * 100)
    : 0;

  // Network stats
  const totalTrackKm = useMemo(() => {
    let km = 0;
    const seenRefs = new Set<string>();
    for (const path of pathsMap.values()) {
      if (!seenRefs.has(path.routeRef)) {
        seenRefs.add(path.routeRef);
        km += path.totalDistance;
      }
    }
    return Math.round(km);
  }, [pathsMap]);

  const peakLoad = useMemo(() => {
    let max = 0;
    for (const sp of stationPassengers.values()) {
      if (sp.capacity > 0) max = Math.max(max, sp.current / sp.capacity);
    }
    return Math.round(max * 100);
  }, [stationPassengers]);

  const busiestStation = useMemo(() => {
    let maxPct = 0;
    let name = "";
    for (const [n, sp] of stationPassengers.entries()) {
      const pct = sp.capacity > 0 ? sp.current / sp.capacity : 0;
      if (pct > maxPct) { maxPct = pct; name = n; }
    }
    return name ? `${name.split("-")[0].trim()} ${Math.round(maxPct * 100)}%` : "—";
  }, [stationPassengers]);

  const atCapacity = trains.filter((t) => (t.passengers ?? 0) >= 900).length;

  // EST clock + service status
  const [estTime, setEstTime] = useState("");
  const [serviceLabel, setServiceLabel] = useState<{ active: boolean; label: string }>({ active: true, label: "In Service" });
  useEffect(() => {
    const update = () => {
      setEstTime(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
      setServiceLabel(getMetroServiceLabel());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Accordion state for line info
  const [lineInfoActive, setLineInfoActive] = useState<string | null>(null);

  // Stations panel open state + search filter
  const [stationsOpen, setStationsOpen] = useState(false);
  const [stationSearch, setStationSearch] = useState("");

  const isMobile = useMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const cardStack = (
    <>
      {/* ── Header card ──────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--color-foreground)", lineHeight: 1.2 }}>
              DC Metro Live
            </div>
            <div style={{ fontSize: 10, color: "var(--color-muted-foreground)", marginTop: 1 }}>
              by Pradhyuman
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* SSE connection status badge */}
            <ConnectionBadge status={connectionStatus} />
            <ThemeToggle />
          </div>
        </div>

        {/* EST clock + service status */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 14,
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 9, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 10,
            background: serviceLabel.active ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: serviceLabel.active ? "#16a34a" : "#dc2626",
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
              background: serviceLabel.active ? "#22c55e" : "#ef4444",
            }} />
            {serviceLabel.active ? "In Service" : "Out of Service"}
          </span>
          <span style={{
            fontFamily: "monospace", fontSize: 11,
            color: "var(--color-muted-foreground)", letterSpacing: "0.04em",
          }}>
            EST {estTime}
          </span>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <StatChip label="Trains"   value={trains.length} />
          <StatChip label="Stations" value={totalStations} />
          <StatChip label="Lines"    value={activeRefs.length} />
        </div>
      </div>

      {/* ── Fleet activity card ───────────────────────────────────────────────── */}
      <BonusesIncentivesCard
        bonusesValue={movingCount}
        incentivesValue={dwellingCount}
        total={trains.length}
        totalPassengers={totalAboard}
        capacityTotal={trains.length * 1050}
      />

      {/* ── Per-train detail list ─────────────────────────────────────────────── */}
      <TrainDetailsList trains={trains} pathsMap={pathsMap} />

      {/* ── Network stats card ────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: "14px 20px" }}>
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 12,
        }}>
          Network Stats
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <NetworkStat label="Aboard trains"   value={totalAboard.toLocaleString()} unit="pax" />
          <NetworkStat label="Waiting at sta." value={totalWaiting.toLocaleString()} unit="pax" />
          <NetworkStat label="Avg train load"  value={`${avgLoad}%`} />
          <NetworkStat label="Peak stn. load"  value={`${peakLoad}%`} />
          <NetworkStat label="Track covered"   value={`${totalTrackKm} km`} />
          <NetworkStat label="At capacity"     value={`${atCapacity}`} unit="trains" />
        </div>
        {passengerHistory.length >= 2 && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 9, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Waiting (60 s)
            </span>
            <Sparkline data={passengerHistory} colour="#6366f1" width={70} height={20} />
          </div>
        )}
        {busiestStation !== "—" && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: "1px solid var(--color-border)",
            fontSize: 10, color: "var(--color-muted-foreground)",
          }}>
            Busiest station: <span style={{ fontWeight: 600, color: "var(--color-foreground)" }}>{busiestStation}</span>
          </div>
        )}
      </div>

      {/* ── Active lines card ─────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 12,
        }}>
          Active Lines
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activeRefs.map((ref) => {
            const meta      = LINE_META[ref];
            const label     = meta?.label ?? ref;
            const colour    = meta?.colour ?? "#666";
            const trainsCnt = trains.filter((t) => t.routeRef === ref).length;
            const aboard    = trains.filter((t) => t.routeRef === ref).reduce((s, t) => s + (t.passengers ?? 0), 0);
            const staCnt    = stationCountByRef.get(ref) ?? 0;
            const maxTrains = Math.max(1, staCnt - 1);

            return (
              <div key={ref} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  flexShrink: 0, width: 10, height: 10,
                  borderRadius: "50%", background: colour,
                }} />
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "var(--color-foreground)" }}>
                  {label}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-muted-foreground)", whiteSpace: "nowrap" }}>
                  {trainsCnt} trains · {aboard} pax
                </span>
              </div>
            );
          })}

          {activeRefs.length === 0 && (
            <p style={{ fontSize: 11, color: "var(--color-muted-foreground)", fontStyle: "italic" }}>
              Loading...
            </p>
          )}
        </div>
      </div>

      {/* ── Surge events card (only when active) ─────────────────────────────── */}
      {(() => {
        const now = Date.now();
        // Filter out events that have already expired client-side
        const activeSurges = surgeEvents.filter((e) => e.expiresAt > now);
        if (activeSurges.length === 0) return null;
        return (
          <div style={{ ...cardStyle, borderColor: "rgba(234,179,8,0.4)", background: "rgba(254,252,232,0.97)" }}>
            <p style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.06em", color: "#92400e", marginBottom: 10,
            }}>
              Active Surge Events
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {activeSurges.map((event) => {
                const msLeft = event.expiresAt - now;
                const minsLeft = Math.max(0, Math.ceil(msLeft / 60_000));
                const endingSoon = msLeft < 60_000;
                return (
                  <div key={event.id} style={{
                    fontSize: 11, color: "#78350f",
                    padding: "4px 0",
                    borderBottom: "1px solid rgba(234,179,8,0.2)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span>{event.label}</span>
                    <span style={{
                      fontSize: 10, flexShrink: 0, marginLeft: 8,
                      fontWeight: endingSoon ? 700 : 400,
                      color: endingSoon ? "#b45309" : "#78350f",
                      opacity: endingSoon ? 1 : 0.7,
                    }}>
                      {minsLeft}m left
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Line info accordion ───────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 10,
        }}>
          Line Info
        </p>
        <AccordionCards
          items={METRO_LINE_INFO}
          activeId={lineInfoActive}
          onToggle={setLineInfoActive}
        />
      </div>

      {/* ── Stations accordion ────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <button
          onClick={() => setStationsOpen((v) => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            justifyContent: "space-between", background: "none", border: "none",
            cursor: "pointer", padding: 0, marginBottom: stationsOpen ? 12 : 0,
          }}
        >
          <p style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", color: "var(--color-muted-foreground)", margin: 0,
          }}>
            Stations by Line ({totalStations} total)
          </p>
          <span style={{
            fontSize: 14, color: "var(--color-muted-foreground)",
            transform: stationsOpen ? "rotate(90deg)" : "none",
            transition: "transform 0.2s", display: "inline-block",
          }}>
            {">"}
          </span>
        </button>

        {stationsOpen && (
          <>
            {/* Station search input */}
            <div style={{ marginBottom: 8 }}>
              <input
                type="text"
                placeholder="Search stations…"
                value={stationSearch}
                onChange={(e) => setStationSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "5px 10px",
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--background, #fff)",
                  color: "var(--color-foreground)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div className="no-scrollbar" style={{ maxHeight: 260, overflowY: "auto" }}>
            {stationsByLine.length === 0 && (
              <p style={{ fontSize: 11, color: "var(--color-muted-foreground)", fontStyle: "italic" }}>
                Loading...
              </p>
            )}
            {stationsByLine
              .map(([ref, line]) => {
                const filteredStops = stationSearch.trim()
                  ? line.stops.filter((s) =>
                      s.stationName.toLowerCase().includes(stationSearch.toLowerCase())
                    )
                  : line.stops;
                return [ref, { ...line, stops: filteredStops }] as [string, typeof line];
              })
              .filter(([, line]) => line.stops.length > 0)
              .map(([ref, line]) => (
              <div key={ref} style={{ marginBottom: 10 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 0", marginBottom: 2,
                  position: "sticky", top: 0,
                  background: "var(--card, rgba(255,255,255,0.97))",
                }}>
                  <span style={{
                    display: "inline-block", width: 10, height: 10,
                    borderRadius: 2, background: line.colour, flexShrink: 0,
                  }} />
                  <span style={{ fontWeight: 700, fontSize: 11, color: "var(--color-foreground)" }}>
                    {ref} Line
                  </span>
                  <span style={{ fontSize: 10, color: "var(--color-muted-foreground)", marginLeft: "auto" }}>
                    {line.stops.length} sta
                  </span>
                </div>
                {line.stops.map((stop, idx) => (
                  <div key={stop.stationName + idx} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 0 3px 14px",
                    borderTop: "1px solid var(--color-border)",
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: line.colour, flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, fontSize: 10, color: "var(--color-foreground)" }}>
                      {stop.stationName}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--color-muted-foreground)", flexShrink: 0 }}>
                      {stop.distanceAlong.toFixed(1)} km
                    </span>
                  </div>
                ))}
              </div>
            ))}
            </div>
          </>
        )}
      </div>

      {/* ── Out-of-service banner ────────────────────────────────────────────── */}
      {!serviceLabel.active && (
        <div style={{
          ...cardStyle,
          background: "rgba(239,68,68,0.06)",
          borderColor: "rgba(239,68,68,0.3)",
          textAlign: "center",
          padding: "14px 20px",
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", marginBottom: 4 }}>
            Metro Closed
          </p>
          <p style={{ fontSize: 11, color: "#9f1239", lineHeight: 1.45 }}>
            WMATA service runs 05:00 AM – midnight EST.
            Trains resume at next service start.
          </p>
        </div>
      )}

      {/* ── Train controls (mobile only — desktop uses the bottom bar) ─────── */}
      <div style={cardStyle}>
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 10,
        }}>
          Train Controls
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activeRefs.map((ref) => {
            const meta = LINE_META[ref];
            const colour = meta?.colour ?? "#666";
            const label = meta?.label ?? ref;
            const trainsCnt = trains.filter((t) => t.routeRef === ref).length;
            const staCnt = stationCountByRef.get(ref) ?? 0;
            const maxTrains = Math.max(1, staCnt - 1);
            return (
              <div key={ref} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flexShrink: 0, width: 10, height: 10, borderRadius: "50%", background: colour }} />
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "var(--color-foreground)" }}>{label}</span>
                <span style={{ fontSize: 10, color: "var(--color-muted-foreground)", whiteSpace: "nowrap" }}>{trainsCnt} trains</span>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <ControlBtn label="−" disabled={trainsCnt <= 1}        onClick={() => removeTrain(ref, (err) => addToast(`Remove failed: ${err.message}`))} />
                  <ControlBtn label="+" disabled={trainsCnt >= maxTrains} onClick={() => addTrain(ref, (err) => addToast(`Add failed: ${err.message}`))} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </>
  );

  if (!isMobile) {
    return (
      <>
        <ToastStack toasts={toasts} />
        {/* ── Right panel ───────────────────────────────────────────────────── */}
        <div
          className="no-scrollbar"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1000,
            width: 296,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {cardStack}
        </div>

        {/* ── Left about panel ──────────────────────────────────────────────── */}
        <AboutPanel />

        {/* ── Bottom train controls bar ─────────────────────────────────────── */}
        <TrainControlsBar
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
        />
      </>
    );
  }

  return (
    <>
      <ToastStack toasts={toasts} />
      <AnimatePresence>
        {!sheetOpen && (
          <SheetHandle key="handle" onClick={() => setSheetOpen(true)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sheetOpen && (
          <BottomSheet key="sheet" onClose={() => setSheetOpen(false)}>
            {cardStack}
            <AboutCardMobile />
          </BottomSheet>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Bottom train controls bar (desktop) ─────────────────────────────────────

function TrainControlsBar({
  onZoomIn,
  onZoomOut,
}: {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 32,
        left: 296,   // clears the About panel (12px margin + 272px width + 12px gap)
        right: 320,  // clears the right panel (12px margin + 296px width + 12px gap)
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        background: "var(--card, rgba(255,255,255,0.95))",
        border: "1px solid var(--color-border, rgba(0,0,0,0.1))",
        borderRadius: 12,
        padding: "8px 14px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 600, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Zoom</span>
      <ControlBtn label="−" onClick={onZoomOut ?? (() => {})} disabled={!onZoomOut} />
      <ControlBtn label="+" onClick={onZoomIn  ?? (() => {})} disabled={!onZoomIn}  />
    </div>
  );
}

// ─── About card for mobile bottom sheet ──────────────────────────────────────

function AboutCardMobile() {
  const [open, setOpen] = useState(false);
  return (
    <div style={cardStyle}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", background: "none", border: "none",
          cursor: "pointer", padding: 0, marginBottom: open ? 14 : 0,
        }}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)",
        }}>
          About This Project
        </span>
        <span style={{
          fontSize: 13, color: "var(--color-muted-foreground)",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.22s ease", display: "inline-block", lineHeight: 1,
        }}>
          ▾
        </span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 11, lineHeight: 1.7, color: "var(--color-foreground)", margin: 0 }}>
            Three fully independent systems — <em>trains</em>, <em>passengers</em>, and <em>track infrastructure</em> —
            run autonomously with zero human intervention. Pure emergent behavior.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <AboutLine title="Train physics"        detail="Headway enforcement, deceleration zones, and station approach — 100 ms ticks" />
            <AboutLine title="Passenger model"      detail="Dynamic boarding/alighting, capacity tiers, and surge multipliers 3–5×" />
            <AboutLine title="Live geometry"        detail="Real WMATA waypoints from OpenStreetMap Overpass API" />
            <AboutLine title="Stack"                detail="Next.js 15 · React 19 · Leaflet · Framer Motion · better-sqlite3" />
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-foreground)", margin: 0 }}>
            Built by Pradhyuman
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Left-side About panel (desktop) ─────────────────────────────────────────

function AboutPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 1000,
        width: 272,
      }}
    >
      <div style={cardStyle}>
        {/* Header / toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            marginBottom: open ? 14 : 0,
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
            letterSpacing: "0.06em", color: "var(--color-muted-foreground)",
          }}>
            About This Project
          </span>
          <span style={{
            fontSize: 13,
            color: "var(--color-muted-foreground)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.22s ease",
            display: "inline-block",
            lineHeight: 1,
          }}>
            ▾
          </span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="about-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              <div
                className="no-scrollbar"
                style={{
                  maxHeight: "calc(100vh - 120px)",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <p style={{ fontSize: 11, lineHeight: 1.7, color: "var(--color-foreground)", margin: 0 }}>
                  Three fully independent systems — <em>trains</em>, <em>passengers</em>, and <em>track infrastructure</em> —
                  run autonomously and interact in real time, 24/7, with zero human intervention.
                  No scripted sequences. Pure emergent behavior.
                </p>

                {/* System pillars */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {[
                    { label: "Train Physics", sub: "Independent agents" },
                    { label: "Passenger Model", sub: "Per-station dynamics" },
                    { label: "Track Network", sub: "Live OSM geometry" },
                  ].map(({ label, sub }) => (
                    <div key={label} style={{
                      background: "var(--color-muted)",
                      borderRadius: 8, padding: "8px 6px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-foreground)", lineHeight: 1.3 }}>{label}</div>
                      <div style={{ fontSize: 9, color: "var(--color-muted-foreground)", marginTop: 2 }}>{sub}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <AboutLine title="Emergent cohesion"        detail="Trains, passengers, and surge events run on separate loops — yet self-regulate into a coherent, realistic system without central coordination" />
                  <AboutLine title="Train physics engine"     detail="Headway enforcement, hard-stop gaps, smooth deceleration zones, station approach, and terminus bounce — all computed every 100 ms" />
                  <AboutLine title="Autonomous passengers"    detail="300–1200 capacity tiers per station, dynamic boarding/alighting, surge multipliers 3–5×, firing independently of train state" />
                  <AboutLine title="Live track geometry"      detail="Fetched from OpenStreetMap Overpass API — real WMATA waypoints stitched via topology graph BFS, not hardcoded coordinates" />
                  <AboutLine title="Surge event engine"       detail="Autonomous surge events fire every 45–90 min, spike demand at stations, and expire on their own — trains respond without being told to" />
                  <AboutLine title="Persistent world state"   detail="SQLite snapshots every 60 s — trains resume exact km position and passenger count after any server restart" />
                  <AboutLine title="Single source of truth"   detail="One Node.js server loop broadcasts authoritative state via SSE — every visitor sees the same live world simultaneously" />
                  <AboutLine title="Stack"                    detail="Next.js 15 · React 19 · Leaflet · Framer Motion · better-sqlite3 · Vitest · Docker" />
                </div>

                <div style={{
                  borderTop: "1px solid var(--color-border)", paddingTop: 12,
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <p style={{ fontSize: 11, lineHeight: 1.55, color: "var(--color-foreground)", margin: 0 }}>
                    Built by <span style={{ fontWeight: 700 }}>Pradhyuman</span> — a demonstration of
                    production-grade autonomous systems engineering: multi-agent coordination,
                    real data pipelines, and emergent behavior at scale.
                  </p>
                  <p style={{ fontSize: 10, color: "var(--color-muted-foreground)", lineHeight: 1.5, margin: 0 }}>
                    Every subsystem was designed to operate independently, yet together they produce
                    a simulation indistinguishable from a real transit network — built from scratch,
                    running continuously, requiring no maintenance.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Mobile bottom sheet components ──────────────────────────────────────────

function SheetHandle({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.22 }}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1001,
        background: "var(--card, rgba(255,255,255,0.97))",
        borderTop: "1px solid var(--color-border)",
        borderRadius: "16px 16px 0 0",
        padding: "14px 20px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
        width: "100%",
      }}
    >
      {/* Drag indicator */}
      <div style={{
        width: 40, height: 4, borderRadius: 2,
        background: "var(--color-muted-foreground)",
        opacity: 0.35,
      }} />
      {/* Title row */}
      <div style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{
            fontSize: 14, fontWeight: 700,
            color: "var(--color-foreground)", lineHeight: 1.2,
          }}>
            DC Metro Live
          </span>
          <span style={{
            fontSize: 10, color: "var(--color-muted-foreground)",
          }}>
            Tap to open dashboard
          </span>
        </div>
        <span style={{
          fontSize: 18, color: "var(--color-muted-foreground)",
          lineHeight: 1,
        }}>
          ↑
        </span>
      </div>
    </motion.button>
  );
}

function BottomSheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1001,
          background: "rgba(0,0,0,0.35)",
        }}
      />

      {/* Sheet */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.1, bottom: 0.4 }}
        onDragEnd={(_e, info) => {
          if (info.offset.y > 100 || info.velocity.y > 500) {
            onClose();
          }
        }}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="no-scrollbar"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "85vh",
          zIndex: 1002,
          background: "var(--card, rgba(255,255,255,0.98))",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Drag indicator */}
        <div style={{
          flexShrink: 0,
          padding: "12px 0 8px",
          display: "flex",
          justifyContent: "center",
          cursor: "grab",
        }}>
          <div style={{
            width: 40, height: 4, borderRadius: 2,
            background: "var(--color-muted-foreground)",
            opacity: 0.4,
          }} />
        </div>

        {/* Scrollable content */}
        <div
          className="no-scrollbar"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 12px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {children}
        </div>
      </motion.div>
    </>
  );
}

// ─── Connection badge ─────────────────────────────────────────────────────────

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const cfg = {
    connected:    { dot: "#22c55e", label: "Live" },
    reconnecting: { dot: "#f59e0b", label: "Reconnecting" },
    error:        { dot: "#ef4444", label: "Error" },
  }[status];

  return (
    <span
      data-testid="connection-badge"
      data-status={status}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.05em", padding: "2px 6px", borderRadius: 8,
        background: "var(--color-muted, rgba(0,0,0,0.06))",
        color: "var(--color-muted-foreground)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{
        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
        background: cfg.dot,
        boxShadow: status === "reconnecting" ? `0 0 0 2px ${cfg.dot}40` : "none",
      }} />
      {cfg.label}
    </span>
  );
}

// ─── Toast stack ─────────────────────────────────────────────────────────────

function ToastStack({ toasts }: { toasts: Array<{ id: number; message: string }> }) {
  if (toasts.length === 0) return null;
  return (
    <div
      data-testid="toast-stack"
      style={{
        position: "fixed",
        bottom: 80,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2000,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            style={{
              background: "rgba(239,68,68,0.95)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: 10,
              boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
              whiteSpace: "nowrap",
            }}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Small sub-components ────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "8px 4px", borderRadius: 8,
      background: "var(--color-muted, rgba(0,0,0,0.05))",
    }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-foreground)", lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 9, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 3 }}>
        {label}
      </span>
    </div>
  );
}

function NetworkStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-foreground)", lineHeight: 1.2 }}>
        {value}
        {unit && <span style={{ fontSize: 10, fontWeight: 400, color: "var(--color-muted-foreground)", marginLeft: 3 }}>{unit}</span>}
      </span>
      <span style={{ fontSize: 9, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>
        {label}
      </span>
    </div>
  );
}

function AboutLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{
        flexShrink: 0, width: 4, height: 4, borderRadius: "50%", marginTop: 6,
        background: "var(--color-muted-foreground)",
      }} />
      <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--color-foreground)" }}>
        <span style={{ fontWeight: 600 }}>{title}:</span>{" "}
        <span style={{ color: "var(--color-muted-foreground)" }}>{detail}</span>
      </span>
    </div>
  );
}

function TrainDetailsList({
  trains,
  pathsMap,
}: {
  trains: TrainState[];
  pathsMap: Map<number, RoutePath>;
}) {
  const [open, setOpen] = useState(false);

  // Sort by routeRef then train number extracted from id
  const sorted = [...trains].sort((a, b) => {
    if (a.routeRef !== b.routeRef) return a.routeRef.localeCompare(b.routeRef);
    const na = parseInt(a.id.split("-")[1] ?? "0", 10);
    const nb = parseInt(b.id.split("-")[1] ?? "0", 10);
    return na - nb;
  });

  return (
    <div style={cardStyle}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", background: "none", border: "none",
          cursor: "pointer", padding: 0, marginBottom: open ? 10 : 0,
        }}
      >
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", margin: 0,
        }}>
          Train Details ({trains.length})
        </p>
        <span style={{
          fontSize: 14, color: "var(--color-muted-foreground)",
          transform: open ? "rotate(90deg)" : "none",
          transition: "transform 0.2s", display: "inline-block",
        }}>
          {">"}
        </span>
      </button>

      {open && (
        <div className="no-scrollbar" style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
          {sorted.length === 0 && (
            <p style={{ fontSize: 11, color: "var(--color-muted-foreground)", fontStyle: "italic" }}>
              No trains active
            </p>
          )}
          {sorted.map((train) => {
            const path = pathsMap.get(train.routeId);
            const totalDist = path?.totalDistance ?? 1;
            const pct = Math.round((train.distanceTravelled / totalDist) * 100);
            const utilPct = Math.round(((train.passengers ?? 0) / 1050) * 100);
            return (
              <TrainRow
                key={train.id}
                train={train}
                routePct={pct}
                utilPct={utilPct}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrainRow({
  train,
  routePct,
  utilPct,
}: {
  train: TrainState;
  routePct: number;
  utilPct: number;
}) {
  const isAtStation = train.status === "at_station";
  const dwellSec = isAtStation ? Math.ceil(train.dwellRemaining / 1000) : 0;
  const meta = LINE_META[train.routeRef];
  const colour = meta?.colour ?? train.routeColour ?? "#888";

  // Utilization colour: green → amber → red
  const barColour =
    utilPct >= 85 ? "#ef4444" :
    utilPct >= 60 ? "#f59e0b" : "#22c55e";

  return (
    <div style={{
      padding: "8px 0",
      borderBottom: "1px solid var(--color-border)",
    }}>
      {/* Row 1: ID + status badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{
          flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: colour,
        }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-foreground)", letterSpacing: "0.02em" }}>
          {train.id}
        </span>
        <span style={{
          marginLeft: "auto",
          fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 8,
          background: isAtStation ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)",
          color: isAtStation ? "#b45309" : "#16a34a",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {isAtStation
            ? `◉ ${train.currentStation ?? "Platform"}${dwellSec > 0 ? ` ${dwellSec}s` : ""}`
            : `▶ Moving · ${train.platform === "A" ? "Inbound" : "Outbound"}`}
        </span>
      </div>

      {/* Row 2: route progress + utilization bars */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {/* Route progress */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 8, color: "var(--color-muted-foreground)" }}>Route</span>
            <span style={{ fontSize: 8, color: "var(--color-muted-foreground)" }}>{routePct}%</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, overflow: "hidden", background: "var(--color-muted, rgba(0,0,0,0.08))" }}>
            <div style={{ height: "100%", width: `${routePct}%`, background: colour, borderRadius: 2 }} />
          </div>
        </div>
        {/* Passenger utilization */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 8, color: "var(--color-muted-foreground)" }}>Load</span>
            <span style={{ fontSize: 8, color: "var(--color-muted-foreground)" }}>{train.passengers ?? 0} pax</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, overflow: "hidden", background: "var(--color-muted, rgba(0,0,0,0.08))" }}>
            <div style={{ height: "100%", width: `${utilPct}%`, background: barColour, borderRadius: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlBtn({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22, height: 22,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 5,
        border: "1px solid var(--color-border, rgba(0,0,0,0.12))",
        background: "var(--color-muted, rgba(0,0,0,0.05))",
        color: disabled ? "var(--color-muted-foreground)" : "var(--color-foreground)",
        fontSize: 14,
        lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        padding: 0,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}
