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
  padding: 16,
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
        width: 272,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* ── Header card ──────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--color-foreground)" }}>
            DC Metro Sim
          </span>
          <ThemeToggle />
        </div>

        {/* EST clock + service status */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12,
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 9, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 10,
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
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
      />

      {/* Passenger sub-stats */}
      <div style={{ ...cardStyle, padding: "10px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <PassengerStat label="Aboard"  value={totalAboard.toLocaleString()} />
          <PassengerStat label="Waiting" value={totalWaiting.toLocaleString()} />
          <PassengerStat label="Avg load" value={`${avgLoad}%`} />
        </div>
      </div>

      {/* ── Active lines card ─────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <p style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 10,
        }}>
          Active Lines
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activeRefs.map((ref) => {
            const meta      = LINE_META[ref];
            const label     = meta?.label ?? ref;
            const colour    = meta?.colour ?? "#666";
            const trainsCnt = trains.filter((t) => t.routeRef === ref).length;
            const staCnt    = stationCountByRef.get(ref) ?? 0;
            const maxTrains = Math.max(1, staCnt - 1);

            return (
              <div key={ref} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  flexShrink: 0, width: 10, height: 10,
                  borderRadius: "50%", background: colour,
                }} />
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "var(--color-foreground)" }}>
                  {label}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-muted-foreground)", whiteSpace: "nowrap" }}>
                  {trainsCnt} trains · {staCnt} sta
                </span>
                {/* +/- controls */}
                <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
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
            letterSpacing: "0.06em", color: "#92400e", marginBottom: 8,
          }}>
            Active Surge Events
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {surgeEvents.map((event) => {
              const minsLeft = Math.max(0, Math.ceil((event.expiresAt - Date.now()) / 60_000));
              return (
                <div key={event.id} style={{
                  fontSize: 11, color: "#78350f",
                  padding: "3px 0",
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
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 8,
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
            cursor: "pointer", padding: 0, marginBottom: stationsOpen ? 10 : 0,
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
              <div key={ref} style={{ marginBottom: 8 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 0", marginBottom: 2,
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
                    padding: "2px 0 2px 14px",
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
          padding: "12px 16px",
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
          letterSpacing: "0.06em", color: "var(--color-muted-foreground)", marginBottom: 10,
        }}>
          About This Project
        </p>

        <p style={{ fontSize: 11, lineHeight: 1.6, color: "var(--color-foreground)", marginBottom: 10 }}>
          A fully autonomous DC Metro simulation — trains run, board passengers, and respond
          to real-world events <em>without any human input</em>.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <AboutLine title="Real track data" detail="Live OSM Overpass API — actual WMATA geometry, not hardcoded paths" />
          <AboutLine title="Physics engine" detail="Headway enforcement, deceleration zones, terminus switching, 88 km/h top speed" />
          <AboutLine title="Passenger model" detail="Per-station capacity tiers, boarding/alighting dynamics, surge events" />
          <AboutLine title="Persistent state" detail="SQLite survives page refreshes — trains restore to exact saved position" />
          <AboutLine title="Service hours" detail="Simulation pauses midnight–5 AM matching real WMATA schedule" />
          <AboutLine title="Stack" detail="Next.js 15, React 19, Leaflet, Framer Motion, better-sqlite3, Vitest" />
        </div>

        <p style={{ fontSize: 10, lineHeight: 1.5, color: "var(--color-muted-foreground)", borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
          Built by{" "}
          <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>Pradhanand</span>
          {" "}at{" "}
          <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>Colaberry</span>
          {" "}to demonstrate production-grade agentic systems: real data pipelines, autonomous simulation loops, and zero-intervention operation.
        </p>
      </div>
    </div>
  );
}

// ─── Small sub-components ────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "6px 4px", borderRadius: 8,
      background: "var(--color-muted, rgba(0,0,0,0.05))",
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-foreground)", lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 9, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>
        {label}
      </span>
    </div>
  );
}

function PassengerStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-foreground)", lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 9, color: "var(--color-muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>
        {label}
      </span>
    </div>
  );
}

function AboutLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
      <span style={{
        flexShrink: 0, width: 4, height: 4, borderRadius: "50%", marginTop: 5,
        background: "var(--color-muted-foreground)",
      }} />
      <span style={{ fontSize: 11, lineHeight: 1.45, color: "var(--color-foreground)" }}>
        <span style={{ fontWeight: 600 }}>{title}:</span>{" "}
        <span style={{ color: "var(--color-muted-foreground)" }}>{detail}</span>
      </span>
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
        width: 20, height: 20,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 4,
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
