"use client";
import { useState, useEffect, useMemo } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BonusesIncentivesCard } from "@/components/ui/animated-dashboard-card";
import { AccordionCards } from "@/components/ui/expandable-card";
import { getMetroServiceLabel } from "@/lib/simulation";
import type { TrainState, StationPassengerState, RoutePath } from "@/lib/simulation";
import type { SurgeEvent } from "@/hooks/useSimulation";

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

interface SidePanelProps {
  trains: TrainState[];
  pathsMap: Map<number, RoutePath>;
  stationPassengers: Map<string, StationPassengerState>;
  surgeEvents: SurgeEvent[];
  addTrain: (routeRef: string) => void;
  removeTrain: (routeRef: string) => void;
  stationsByLine: Array<[string, { colour: string; stops: { stationName: string; distanceAlong: number }[] }]>;
}

export default function SidePanel({
  trains,
  pathsMap,
  stationPassengers,
  surgeEvents,
  addTrain,
  removeTrain,
  stationsByLine,
}: SidePanelProps) {
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

  const totalStations = Array.from(stationCountByRef.values()).reduce((a, b) => a + b, 0);

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

  // Stations panel open state
  const [stationsOpen, setStationsOpen] = useState(false);

  return (
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
          <ThemeToggle />
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
                {/* +/- controls */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <ControlBtn
                    label="-"
                    disabled={trainsCnt <= 1}
                    onClick={() => removeTrain(ref)}
                  />
                  <ControlBtn
                    label="+"
                    disabled={trainsCnt >= maxTrains}
                    onClick={() => addTrain(ref)}
                  />
                </div>
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
      {surgeEvents.length > 0 && (
        <div style={{ ...cardStyle, borderColor: "rgba(234,179,8,0.4)", background: "rgba(254,252,232,0.97)" }}>
          <p style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", color: "#92400e", marginBottom: 10,
          }}>
            Active Surge Events
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {surgeEvents.map((event) => {
              const minsLeft = Math.max(0, Math.ceil((event.expiresAt - Date.now()) / 60_000));
              return (
                <div key={event.id} style={{
                  fontSize: 11, color: "#78350f",
                  padding: "4px 0",
                  borderBottom: "1px solid rgba(234,179,8,0.2)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span>{event.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.7, flexShrink: 0, marginLeft: 8 }}>
                    {minsLeft}m left
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            Stations by Line ({stationsByLine.reduce((n, [, v]) => n + v.stops.length, 0)} total)
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
          <div className="no-scrollbar" style={{ maxHeight: 280, overflowY: "auto" }}>
            {stationsByLine.length === 0 && (
              <p style={{ fontSize: 11, color: "var(--color-muted-foreground)", fontStyle: "italic" }}>
                Loading...
              </p>
            )}
            {stationsByLine.map(([ref, line]) => (
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

      {/* ── About card ───────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 12,
        }}>
          About This Project
        </p>

        <p style={{ fontSize: 11, lineHeight: 1.65, color: "var(--color-foreground)", marginBottom: 12 }}>
          A fully autonomous DC Metro simulation running 24/7 — trains move, board passengers,
          and respond to real-world events <em>without any human intervention</em>.
          Every visitor sees the same live state, powered by a single server-side simulation loop.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <AboutLine
            title="Real track geometry"
            detail="Live OpenStreetMap Overpass API — actual WMATA waypoints, not hardcoded paths" />
          <AboutLine
            title="Physics engine"
            detail="Headway enforcement, deceleration zones, station approach, terminus switching at 88 km/h" />
          <AboutLine
            title="Passenger model"
            detail="Per-station capacity tiers (300–1200), boarding/alighting dynamics, surge multipliers 3–5×" />
          <AboutLine
            title="Server-side singleton"
            detail="Node.js setInterval tick at 100 ms — one authoritative loop, broadcast via SSE to all clients" />
          <AboutLine
            title="Persistent state"
            detail="SQLite (better-sqlite3) persists every 60 s — trains resume exact position after server restart" />
          <AboutLine
            title="WMATA service hours"
            detail="Simulation pauses midnight–5 AM EST matching real schedule; resumes automatically at open" />
          <AboutLine
            title="Zero manual operation"
            detail="Surge events fire autonomously every 45–90 min; trains self-regulate spacing and platform occupancy" />
          <AboutLine
            title="Stack"
            detail="Next.js 15 · React 19 · Leaflet · Framer Motion · better-sqlite3 · Vitest · Docker" />
        </div>

        <div style={{
          borderTop: "1px solid var(--color-border)", paddingTop: 12,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <p style={{ fontSize: 11, lineHeight: 1.55, color: "var(--color-foreground)" }}>
            Built by{" "}
            <span style={{ fontWeight: 700 }}>Pradhyuman</span>
            {" "}as a personal showcase of production-grade autonomous systems:
            real data pipelines, server-side simulation, and zero-intervention 24/7 operation.
          </p>
          <p style={{ fontSize: 10, color: "var(--color-muted-foreground)", lineHeight: 1.5 }}>
            This project demonstrates skills in full-stack engineering, real-time systems, geospatial data,
            and agentic software design — built independently, from scratch.
          </p>
        </div>
      </div>
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
