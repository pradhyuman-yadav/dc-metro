"use client";
import { Train, MapPin, Layers, Clock } from "lucide-react";
import { GridPatternCard, GridPatternCardBody } from "@/components/ui/card-with-grid-pattern";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { TrainState } from "@/lib/simulation";
import type { RoutePath } from "@/lib/simulation";

// WMATA line colours → display names
const LINE_META: Record<string, { label: string; colour: string }> = {
  RD: { label: "Red",    colour: "#BF0D3E" },
  OR: { label: "Orange", colour: "#ED8B00" },
  SV: { label: "Silver", colour: "#919D9D" },
  BL: { label: "Blue",   colour: "#009CDE" },
  YL: { label: "Yellow", colour: "#FFD100" },
  GR: { label: "Green",  colour: "#00B140" },
};

interface SidePanelProps {
  trains: TrainState[];
  pathsMap: Map<number, RoutePath>;
}

export default function SidePanel({ trains, pathsMap }: SidePanelProps) {
  const movingCount  = trains.filter((t) => t.status === "moving").length;
  const dwellingCount = trains.filter((t) => t.status === "at_station").length;

  // Unique lines currently active
  const activeRefs = Array.from(new Set(trains.map((t) => t.routeRef))).sort();

  // Station count from pathsMap (pick longest stops list per ref)
  const stationCountByRef = new Map<string, number>();
  for (const path of pathsMap.values()) {
    const prev = stationCountByRef.get(path.routeRef) ?? 0;
    if (path.stops.length > prev) stationCountByRef.set(path.routeRef, path.stops.length);
  }
  const totalStations = Array.from(stationCountByRef.values()).reduce((a, b) => a + b, 0);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 1000,
        width: 240,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* ── Header card ─────────────────────────────────────────────────────── */}
      <GridPatternCard>
        <GridPatternCardBody className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Train className="w-5 h-5 text-zinc-700 dark:text-zinc-300" strokeWidth={1.5} />
              <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100 tracking-tight">
                DC Metro Sim
              </span>
            </div>
            <ThemeToggle />
          </div>

          {/* Live stats row */}
          <div className="grid grid-cols-3 gap-2 mb-1">
            <Stat
              icon={<Train className="w-3.5 h-3.5" />}
              value={movingCount}
              label="Moving"
              colour="#22c55e"
            />
            <Stat
              icon={<Clock className="w-3.5 h-3.5" />}
              value={dwellingCount}
              label="At station"
              colour="#f59e0b"
            />
            <Stat
              icon={<MapPin className="w-3.5 h-3.5" />}
              value={totalStations}
              label="Stations"
              colour="#6366f1"
            />
          </div>
        </GridPatternCardBody>
      </GridPatternCard>

      {/* ── Lines card ──────────────────────────────────────────────────────── */}
      <GridPatternCard>
        <GridPatternCardBody className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
              Active Lines
            </span>
          </div>

          <div className="space-y-2">
            {activeRefs.map((ref) => {
              const meta      = LINE_META[ref];
              const label     = meta?.label ?? ref;
              const colour    = meta?.colour ?? "#666";
              const trainsCnt = trains.filter((t) => t.routeRef === ref).length;
              const staCnt    = stationCountByRef.get(ref) ?? 0;

              return (
                <div key={ref} className="flex items-center gap-2">
                  <span
                    style={{ background: colour }}
                    className="flex-shrink-0 w-3 h-3 rounded-full"
                  />
                  <span className="flex-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    {label} Line
                  </span>
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {trainsCnt}🚆 {staCnt}🚉
                  </span>
                </div>
              );
            })}

            {activeRefs.length === 0 && (
              <p className="text-xs text-zinc-400 italic">Loading…</p>
            )}
          </div>
        </GridPatternCardBody>
      </GridPatternCard>

      {/* ── About card ──────────────────────────────────────────────────────── */}
      <GridPatternCard>
        <GridPatternCardBody className="p-4">
          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Live simulation of the WMATA Metro rail system. Track data from{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              OpenStreetMap
            </span>
            . Trains run at scale speed with realistic station dwell times.
          </p>
        </GridPatternCardBody>
      </GridPatternCard>
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
  colour,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  colour: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md py-2 px-1 bg-zinc-50 dark:bg-zinc-900">
      <span style={{ color: colour }}>{icon}</span>
      <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 tabular-nums leading-none">
        {value}
      </span>
      <span className="text-[9px] text-zinc-400 uppercase tracking-wide leading-none">
        {label}
      </span>
    </div>
  );
}
