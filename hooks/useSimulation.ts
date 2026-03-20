"use client";
import { useEffect, useRef, useMemo, useState, useCallback, type MutableRefObject } from "react";
import type { SubwayRoute, SubwayStation } from "@/lib/overpass";
import { pairRoutes } from "@/lib/overpass";
import {
  buildRoutePaths,
  mapStopsToRoute,
  initTrains,
  tickSimulation,
  isMetroInService,
  DEFAULT_CONFIG,
  type RoutePath,
  type TrainState,
  type SimulationConfig,
  type StationPassengerState,
} from "@/lib/simulation";
import { getStationCapacity } from "@/lib/station-capacities";

export interface SurgeEvent {
  id: string;
  stationName: string;
  label: string;
  multiplier: number;
  startedAt: number;
  expiresAt: number;
}

export interface UseSimulationResult {
  /** Live train states — updated every RAF frame, never triggers React renders */
  trainsRef: MutableRefObject<TrainState[]>;
  pathsMap: Map<number, RoutePath>;
  /** Passenger state per station — React state snapshot, updated every ~1 s */
  stationPassengers: Map<string, StationPassengerState>;
  /** Currently active surge events */
  surgeEvents: SurgeEvent[];
  /** Add one train to a route (capped at stops-1) */
  addTrain: (routeRef: string) => void;
  /** Remove the last train from a route (floor at 1) */
  removeTrain: (routeRef: string) => void;
}

const SAVE_INTERVAL_MS = 60_000;
const PATH_SAVE_INTERVAL_MS = 3_600_000;
const SURGE_DURATION_MS = 5 * 60_000;   // 5 minutes active
const SURGE_MIN_INTERVAL_MS = 45 * 60_000;  // minimum 45 minutes between surges
const SURGE_MAX_INTERVAL_MS = 90 * 60_000;  // maximum 90 minutes between surges

const SURGE_TEMPLATES = [
  { station: "Metro Center",            label: "Metro Center: Rush hour surge" },
  { station: "Navy Yard-Ballpark",      label: "Navy Yard: Baseball game starting" },
  { station: "Gallery Place-Chinatown", label: "Gallery Place: Concert crowd" },
  { station: "Union Station",           label: "Union Station: Event crowd" },
  { station: "Pentagon City",           label: "Pentagon City: Shopping surge" },
];

function randomBetween(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function generateSurge(): SurgeEvent {
  const template = SURGE_TEMPLATES[Math.floor(Math.random() * SURGE_TEMPLATES.length)];
  const now = Date.now();
  return {
    id: `surge-${now}-${Math.random().toString(36).slice(2, 7)}`,
    stationName: template.station,
    label: template.label,
    multiplier: 3 + Math.random() * 2, // 3–5×
    startedAt: now,
    expiresAt: now + SURGE_DURATION_MS,
  };
}

/**
 * Runs a synthetic train simulation using requestAnimationFrame.
 *
 * All simulation state lives in `trainsRef` (a mutable ref). The RAF loop
 * advances physics every frame without ever calling `setState`, so there are
 * zero React re-renders from the animation loop.
 *
 * On mount the hook fetches any previously-saved states from
 * GET /api/subway/trains and restores trains that match the current routes.
 * Every 60 s it posts the live states back so they survive page refreshes.
 */
export function useSimulation(
  routes: SubwayRoute[],
  stations: SubwayStation[],
  config: Partial<SimulationConfig> = {}
): UseSimulationResult {
  const cfg: SimulationConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const routePairs = useMemo(() => pairRoutes(routes), [routes]);

  const pathsMap = useMemo<Map<number, RoutePath>>(() => {
    if (routes.length === 0) return new Map();
    const raw = buildRoutePaths(routes);
    const enriched = raw.map((p) => mapStopsToRoute(p, stations));
    return new Map(enriched.map((p) => [p.routeId, p]));
  }, [routes, stations]);

  const trainsRef = useRef<TrainState[]>([]);

  // ── Station passenger state ───────────────────────────────────────────────
  const stationPassengersRef = useRef<Map<string, StationPassengerState>>(new Map());
  const [stationPassengers, setStationPassengers] = useState<Map<string, StationPassengerState>>(new Map());

  // ── Surge event state ─────────────────────────────────────────────────────
  const surgeEventsRef = useRef<SurgeEvent[]>([]);
  const [surgeEvents, setSurgeEvents] = useState<SurgeEvent[]>([]);
  const surgeMultipliersRef = useRef<Map<string, number>>(new Map());
  const nextSurgeAtRef = useRef<number>(
    Date.now() + randomBetween(SURGE_MIN_INTERVAL_MS, SURGE_MAX_INTERVAL_MS)
  );

  // ── Service hours ─────────────────────────────────────────────────────────
  // Checked once per minute inside the RAF loop to avoid toLocaleString overhead
  const serviceActiveRef = useRef(true);
  const lastServiceCheckRef = useRef(0);

  // ── Initialize station passenger map when pathsMap is ready ──────────────
  useEffect(() => {
    if (pathsMap.size === 0) return;

    // Collect unique station names from all paths
    const allStations = new Set<string>();
    for (const path of pathsMap.values()) {
      for (const stop of path.stops) {
        allStations.add(stop.stationName);
      }
    }

    // Start with defaults; will be overwritten by seed if saved data exists
    const initial = new Map<string, StationPassengerState>();
    for (const name of allStations) {
      initial.set(name, { capacity: getStationCapacity(name), current: 0 });
    }
    stationPassengersRef.current = initial;
    setStationPassengers(new Map(initial));
  }, [pathsMap]);

  // ── Seed trains (restore from DB or initialise fresh) ────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) {
      trainsRef.current = [];
      return;
    }

    async function seed() {
      try {
        // Restore trains
        const res = await fetch("/api/subway/trains");
        if (res.ok) {
          const data = (await res.json()) as { states: TrainState[] };
          const valid = data.states.filter((s) => pathsMap.has(s.routeId));
          if (valid.length > 0) {
            const seenRoutes = new Set(valid.map((s) => s.routeId));
            const fresh: TrainState[] = [];
            for (const [routeId, path] of pathsMap) {
              if (!seenRoutes.has(routeId)) {
                fresh.push(...initTrains([path], cfg, routePairs));
              }
            }
            trainsRef.current = [...valid, ...fresh];
          } else {
            trainsRef.current = initTrains(Array.from(pathsMap.values()), cfg, routePairs);
          }
        } else {
          trainsRef.current = initTrains(Array.from(pathsMap.values()), cfg, routePairs);
        }

        // Restore station passengers
        const spRes = await fetch("/api/subway/station-passengers");
        if (spRes.ok) {
          const spData = (await spRes.json()) as {
            entries: Array<{ stationName: string; capacity: number; current: number }>;
          };
          const merged = new Map(stationPassengersRef.current);
          for (const e of spData.entries) {
            merged.set(e.stationName, { capacity: e.capacity, current: e.current });
          }
          stationPassengersRef.current = merged;
          setStationPassengers(new Map(merged));
        }
      } catch {
        trainsRef.current = initTrains(Array.from(pathsMap.values()), cfg, routePairs);
      }
    }

    seed();
  }, [pathsMap, cfg, routePairs]);

  // ── RAF animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) return;

    let lastTime: number | null = null;
    let rafId: number;

    function frame(now: number) {
      const dt = lastTime !== null ? Math.min(now - lastTime, 100) : 0;
      lastTime = now;

      // ── Service hours check (once per minute) ──────────────────────────
      if (now - lastServiceCheckRef.current > 60_000) {
        lastServiceCheckRef.current = now;
        serviceActiveRef.current = isMetroInService();
      }
      // Outside WMATA service hours: keep RAF alive but pause simulation
      if (!serviceActiveRef.current) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      // ── Generate / expire surge events ─────────────────────────────────
      if (now >= nextSurgeAtRef.current) {
        const surge = generateSurge();
        const updated = [...surgeEventsRef.current.slice(-9), surge];
        surgeEventsRef.current = updated;
        surgeMultipliersRef.current = new Map(updated.map((s) => [s.stationName, s.multiplier]));
        setSurgeEvents([...updated]);
        nextSurgeAtRef.current = now + randomBetween(SURGE_MIN_INTERVAL_MS, SURGE_MAX_INTERVAL_MS);
      }

      // Expire old surges
      const active = surgeEventsRef.current.filter((s) => s.expiresAt > now);
      if (active.length !== surgeEventsRef.current.length) {
        surgeEventsRef.current = active;
        surgeMultipliersRef.current = new Map(active.map((s) => [s.stationName, s.multiplier]));
        setSurgeEvents([...active]);
      }

      // ── Tick simulation ────────────────────────────────────────────────
      const result = tickSimulation(
        trainsRef.current,
        pathsMap,
        dt,
        cfg,
        stationPassengersRef.current,
        surgeMultipliersRef.current
      );
      trainsRef.current = result.trains;

      // Apply station deltas
      const updated = new Map(stationPassengersRef.current);
      for (const [name, delta] of result.stationDeltas) {
        const sp = updated.get(name);
        if (sp) {
          updated.set(name, {
            capacity: sp.capacity,
            current: Math.min(sp.capacity, Math.max(0, sp.current + delta)),
          });
        }
      }
      stationPassengersRef.current = updated;

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [pathsMap, cfg]);

  // ── Periodic persistence ──────────────────────────────────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) return;

    const intervalId = setInterval(async () => {
      if (trainsRef.current.length === 0) return;
      try {
        await fetch("/api/subway/trains", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trainsRef.current),
        });
      } catch { /* best-effort */ }

      // Persist station passengers
      const entries = Array.from(stationPassengersRef.current.entries()).map(
        ([stationName, v]) => ({ stationName, capacity: v.capacity, current: v.current })
      );
      try {
        await fetch("/api/subway/station-passengers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entries),
        });
      } catch { /* best-effort */ }
    }, SAVE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [pathsMap]);

  // ── Snapshot for React renders (every 1 s) ────────────────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) return;
    const id = setInterval(() => {
      setStationPassengers(new Map(stationPassengersRef.current));
    }, 1000);
    return () => clearInterval(id);
  }, [pathsMap]);

  // ── Route path persistence ────────────────────────────────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) return;
    const save = async () => {
      try {
        await fetch("/api/subway/paths", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Array.from(pathsMap.values())),
        });
      } catch { /* non-critical */ }
    };
    save();
    const intervalId = setInterval(save, PATH_SAVE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [pathsMap]);

  // ── addTrain / removeTrain ────────────────────────────────────────────────
  const addTrain = useCallback(
    (routeRef: string) => {
      // Find a path matching the routeRef
      const entry = Array.from(pathsMap.entries()).find(([, p]) => p.routeRef === routeRef);
      if (!entry) return;
      const [routeId, path] = entry;
      const maxTrains = Math.max(1, path.stops.length - 1);
      const current = trainsRef.current.filter((t) => t.routeId === routeId).length;
      if (current >= maxTrains) return;

      const partnerRouteId = routePairs.get(routeId) ?? null;
      const nextIdx = current + 1;
      const newTrain: TrainState = {
        id: `${routeId}-added-${nextIdx}-${Date.now()}`,
        routeId,
        routeRef: path.routeRef,
        routeColour: path.routeColour,
        routeName: path.routeName,
        distanceTravelled: 0,
        direction: 1,
        status: "moving",
        currentStation: null,
        platform: "A",
        dwellRemaining: 0,
        partnerRouteId,
        passengers: 0,
      };
      trainsRef.current = [...trainsRef.current, newTrain];
    },
    [pathsMap, routePairs]
  );

  const removeTrain = useCallback(
    (routeRef: string) => {
      const entry = Array.from(pathsMap.entries()).find(([, p]) => p.routeRef === routeRef);
      if (!entry) return;
      const [routeId] = entry;
      const routeTrains = trainsRef.current.filter((t) => t.routeId === routeId);
      if (routeTrains.length <= 1) return;
      const last = routeTrains[routeTrains.length - 1];
      trainsRef.current = trainsRef.current.filter((t) => t.id !== last.id);
    },
    [pathsMap]
  );

  return { trainsRef, pathsMap, stationPassengers, surgeEvents, addTrain, removeTrain };
}
