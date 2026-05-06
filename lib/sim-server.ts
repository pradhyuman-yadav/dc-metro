/**
 * Server-side simulation singleton.
 *
 * Runs one authoritative tickSimulation loop for the entire server process.
 * All connected SSE clients receive identical state snapshots every 100 ms.
 *
 * Singleton survives Next.js HMR in development via the `global.__dcMetroSim`
 * pattern. In production (Docker, single Node.js process) it lives for the
 * container's lifetime.
 */

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
import { pairRoutes, fetchSubwayRoutes, fetchSubwayStations } from "@/lib/overpass";
import {
  getCachedRoutes,
  upsertRoutes,
  getCachedStations,
  upsertStations,
  getTrainStates,
  upsertTrainStates,
  getStationPassengers,
  upsertStationPassengers,
  getCachedRoutePaths,
  upsertRoutePaths,
} from "@/lib/stations";
import { getStationCapacity } from "@/lib/station-capacities";

// ─── Surge types (mirrors useSimulation.ts) ───────────────────────────────────

export interface SurgeEvent {
  id: string;
  stationName: string;
  label: string;
  multiplier: number;
  startedAt: number;
  expiresAt: number;
}

const SURGE_DURATION_MS = 5 * 60_000;
const SURGE_MIN_INTERVAL_MS = 45 * 60_000;
const SURGE_MAX_INTERVAL_MS = 90 * 60_000;

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
    multiplier: 3 + Math.random() * 2,
    startedAt: now,
    expiresAt: now + SURGE_DURATION_MS,
  };
}

// ─── SSE message type ─────────────────────────────────────────────────────────

export interface SimSnapshot {
  trains: TrainState[];
  /** Array of [stationName, {capacity, current}] entries (Map serialises cleanly) */
  stationPassengers: [string, StationPassengerState][];
  surgeEvents: SurgeEvent[];
  serviceActive: boolean;
}

// ─── SimServer class ──────────────────────────────────────────────────────────

class SimServer {
  private trains: TrainState[] = [];
  private pathsMap: Map<number, RoutePath> = new Map();
  private stationPassengers: Map<string, StationPassengerState> = new Map();
  private surgeEvents: SurgeEvent[] = [];
  private surgeMultipliers: Map<string, number> = new Map();
  private nextSurgeAt: number = Date.now() + randomBetween(SURGE_MIN_INTERVAL_MS, SURGE_MAX_INTERVAL_MS);
  private serviceActive: boolean = true;
  private lastServiceCheck: number = 0;
  private subscribers: Set<(data: string) => void> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickCount: number = 0;
  private cfg: SimulationConfig = DEFAULT_CONFIG;

  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Idempotent: resolves immediately if already initialised.
   *  Resets the in-flight promise on failure so the next caller can retry —
   *  important when transient upstream errors (e.g. Overpass 406) caused the
   *  first attempt to fail before the underlying fix was in place. */
  async ensureInitialized(): Promise<void> {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._init()
      .then(() => { this._initialized = true; })
      .catch((err) => {
        this._initPromise = null; // allow next caller to retry
        throw err;
      });
    return this._initPromise;
  }

  subscribe(cb: (data: string) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  snapshot(): string {
    return JSON.stringify(this._buildSnapshot());
  }

  getPathsMap(): Map<number, RoutePath> {
    return this.pathsMap;
  }

  addTrain(routeRef: string): void {
    const entry = Array.from(this.pathsMap.entries()).find(([, p]) => p.routeRef === routeRef);
    if (!entry) return;
    const [routeId, path] = entry;
    const maxTrains = Math.max(1, path.stops.length - 1);
    const current = this.trains.filter((t) => t.routeId === routeId).length;
    if (current >= maxTrains) return;
    const routePairs = this._buildRoutePairs();
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
    this.trains = [...this.trains, newTrain];
    // Persist immediately so the new train survives a crash before the next 60 s snapshot
    this._persist().catch(() => {/* best-effort */});
    this._broadcast();
  }

  removeTrain(routeRef: string): void {
    const entry = Array.from(this.pathsMap.entries()).find(([, p]) => p.routeRef === routeRef);
    if (!entry) return;
    const [routeId] = entry;
    const routeTrains = this.trains.filter((t) => t.routeId === routeId);
    if (routeTrains.length <= 1) return;
    const last = routeTrains[routeTrains.length - 1];
    this.trains = this.trains.filter((t) => t.id !== last.id);
    this._persist().catch(() => {/* best-effort */});
    this._broadcast();
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    // 1. Load routes
    let routes = getCachedRoutes();
    if (!routes) {
      routes = await fetchSubwayRoutes();
      upsertRoutes(routes);
    }
    if (routes.length === 0) return; // no data, skip

    // 2. Load stations
    let stations = getCachedStations();
    if (!stations) {
      stations = await fetchSubwayStations();
      upsertStations(stations);
    }

    // 3. Build pathsMap — try cached geometry first, fall back to recompute
    const cachedPaths = getCachedRoutePaths();
    let paths: RoutePath[];
    if (cachedPaths && cachedPaths.length > 0) {
      paths = cachedPaths.map((p) => mapStopsToRoute(p as RoutePath, stations!));
    } else {
      const raw = buildRoutePaths(routes);
      paths = raw.map((p) => mapStopsToRoute(p, stations!));
      upsertRoutePaths(paths);
    }
    this.pathsMap = new Map(paths.map((p) => [p.routeId, p]));

    // 4. Restore station passengers
    const savedPassengers = getStationPassengers();
    const allStationNames = new Set<string>();
    for (const path of paths) {
      for (const stop of path.stops) allStationNames.add(stop.stationName);
    }
    const sp = new Map<string, StationPassengerState>();
    for (const name of allStationNames) {
      const saved = savedPassengers.get(name);
      sp.set(name, saved ?? { capacity: getStationCapacity(name), current: 0 });
    }
    this.stationPassengers = sp;

    // 5. Restore trains
    const routePairs = this._buildRoutePairs();
    const saved = getTrainStates();
    if (saved && saved.states.length > 0) {
      const valid = saved.states.filter((s) => this.pathsMap.has(s.routeId));
      if (valid.length > 0) {
        const seenRoutes = new Set(valid.map((s) => s.routeId));
        const fresh: TrainState[] = [];
        for (const [routeId, path] of this.pathsMap) {
          if (!seenRoutes.has(routeId)) {
            fresh.push(...initTrains([path], this.cfg, routePairs));
          }
        }
        this.trains = [...valid, ...fresh];
      } else {
        this.trains = initTrains(paths, this.cfg, routePairs);
      }
    } else {
      this.trains = initTrains(paths, this.cfg, routePairs);
    }

    // 6. Start tick loop
    this.intervalId = setInterval(() => this._tick(), 100);
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  private _tick(): void {
    const now = Date.now();

    // Service hours check — once per minute
    if (now - this.lastServiceCheck > 60_000) {
      this.lastServiceCheck = now;
      this.serviceActive = isMetroInService();
    }

    if (this.serviceActive) {
      // Surge generation
      if (now >= this.nextSurgeAt) {
        const surge = generateSurge();
        const updated = [...this.surgeEvents.slice(-9), surge];
        this.surgeEvents = updated;
        this.surgeMultipliers = new Map(updated.map((s) => [s.stationName, s.multiplier]));
        this.nextSurgeAt = now + randomBetween(SURGE_MIN_INTERVAL_MS, SURGE_MAX_INTERVAL_MS);
      }

      // Expire surges
      const active = this.surgeEvents.filter((s) => s.expiresAt > now);
      if (active.length !== this.surgeEvents.length) {
        this.surgeEvents = active;
        this.surgeMultipliers = new Map(active.map((s) => [s.stationName, s.multiplier]));
      }

      // Physics tick
      const result = tickSimulation(
        this.trains,
        this.pathsMap,
        100,
        this.cfg,
        this.stationPassengers,
        this.surgeMultipliers
      );
      this.trains = result.trains;

      // Apply station deltas
      const updated = new Map(this.stationPassengers);
      for (const [name, delta] of result.stationDeltas) {
        const s = updated.get(name);
        if (s) {
          updated.set(name, {
            capacity: s.capacity,
            current: Math.min(s.capacity, Math.max(0, s.current + delta)),
          });
        }
      }
      this.stationPassengers = updated;
    }

    // Broadcast to all SSE subscribers
    this._broadcast();

    // Persist every 60 s (600 ticks at 100 ms)
    this.tickCount++;
    if (this.tickCount % 600 === 0) {
      this._persist().catch(() => {/* best-effort */});
    }
  }

  // ── Broadcast ────────────────────────────────────────────────────────────────

  private _broadcast(): void {
    if (this.subscribers.size === 0) return;
    const data = JSON.stringify(this._buildSnapshot());
    for (const cb of this.subscribers) {
      try { cb(data); } catch { /* ignore broken subscriber */ }
    }
  }

  private _buildSnapshot(): SimSnapshot {
    return {
      trains: this.trains,
      stationPassengers: Array.from(this.stationPassengers.entries()),
      surgeEvents: this.surgeEvents,
      serviceActive: this.serviceActive,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private async _persist(): Promise<void> {
    if (this.trains.length > 0) {
      upsertTrainStates(this.trains);
    }
    const entries = Array.from(this.stationPassengers.entries()).map(
      ([stationName, v]) => ({ stationName, capacity: v.capacity, current: v.current })
    );
    if (entries.length > 0) {
      upsertStationPassengers(entries);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private _routePairs: Map<number, number> | null = null;
  private _buildRoutePairs(): Map<number, number> {
    if (this._routePairs) return this._routePairs;
    // Reconstruct from pathsMap routeRefs — pair routes sharing the same ref prefix
    // Use the existing pairRoutes utility which takes SubwayRoute[]-like objects
    const pseudoRoutes = Array.from(this.pathsMap.values()).map((p) => ({
      id: p.routeId,
      ref: p.routeRef,
      name: p.routeName,
      colour: p.routeColour,
      segments: [] as [number, number][][],
    }));
    this._routePairs = pairRoutes(pseudoRoutes);
    return this._routePairs;
  }
}

// ─── Global singleton ─────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __dcMetroSim: SimServer | undefined;
}

export function getSimServer(): SimServer {
  if (!global.__dcMetroSim) {
    global.__dcMetroSim = new SimServer();
  }
  return global.__dcMetroSim;
}
