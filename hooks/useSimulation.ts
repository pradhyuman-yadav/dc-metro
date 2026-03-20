"use client";
import { useEffect, useRef, useMemo, useState, useCallback, type MutableRefObject } from "react";
import type { SubwayRoute, SubwayStation } from "@/lib/overpass";
import { pairRoutes } from "@/lib/overpass";
import {
  buildRoutePaths,
  mapStopsToRoute,
  type RoutePath,
  type TrainState,
  type SimulationConfig,
  type StationPassengerState,
} from "@/lib/simulation";

// Re-export SurgeEvent so callers (SidePanel, MapInner) don't need to change imports
export interface SurgeEvent {
  id: string;
  stationName: string;
  label: string;
  multiplier: number;
  startedAt: number;
  expiresAt: number;
}

export interface UseSimulationResult {
  /** Live train states — written by SSE handler, read by RAF render loop */
  trainsRef: MutableRefObject<TrainState[]>;
  pathsMap: Map<number, RoutePath>;
  /** Passenger state per station — React state snapshot from SSE */
  stationPassengers: Map<string, StationPassengerState>;
  /** Currently active surge events from server */
  surgeEvents: SurgeEvent[];
  /** Add one train to a route (enforced server-side) */
  addTrain: (routeRef: string) => void;
  /** Remove the last train from a route (enforced server-side) */
  removeTrain: (routeRef: string) => void;
}

/**
 * Connects to the server-side simulation via SSE.
 *
 * The server runs one authoritative tickSimulation loop and broadcasts state
 * every 100 ms. All clients that open this hook see identical train positions
 * and station passenger counts. Refreshing reconnects instantly to the live
 * server state — no client-side physics loop runs.
 *
 * pathsMap is still built client-side from routes + stations (deterministic,
 * same inputs → same output) so the TrainLayer can interpolate positions.
 */
export function useSimulation(
  routes: SubwayRoute[],
  stations: SubwayStation[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config: Partial<SimulationConfig> = {}
): UseSimulationResult {
  // ── pathsMap: built client-side for rendering (TrainLayer interpolation) ────
  const routePairs = useMemo(() => pairRoutes(routes), [routes]);

  const pathsMap = useMemo<Map<number, RoutePath>>(() => {
    if (routes.length === 0) return new Map();
    const raw = buildRoutePaths(routes);
    const enriched = raw.map((p) => mapStopsToRoute(p, stations));
    return new Map(enriched.map((p) => [p.routeId, p]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, stations]);

  // Suppress unused variable warning — routePairs kept for type parity
  void routePairs;

  // ── SSE state ────────────────────────────────────────────────────────────────
  const trainsRef = useRef<TrainState[]>([]);
  const [stationPassengers, setStationPassengers] = useState<Map<string, StationPassengerState>>(new Map());
  const [surgeEvents, setSurgeEvents] = useState<SurgeEvent[]>([]);

  useEffect(() => {
    if (routes.length === 0) return;

    const es = new EventSource("/api/subway/stream");

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as {
          trains: TrainState[];
          stationPassengers: [string, StationPassengerState][];
          surgeEvents: SurgeEvent[];
          serviceActive: boolean;
        };
        trainsRef.current = msg.trains;
        setStationPassengers(new Map(msg.stationPassengers));
        setSurgeEvents(msg.surgeEvents);
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — no manual retry needed
    };

    return () => es.close();
  }, [routes.length]);

  // ── Train management (POST to server singleton) ───────────────────────────
  const addTrain = useCallback((routeRef: string) => {
    fetch("/api/subway/trains/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeRef }),
    }).catch(() => {/* best-effort */});
  }, []);

  const removeTrain = useCallback((routeRef: string) => {
    fetch("/api/subway/trains/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeRef }),
    }).catch(() => {/* best-effort */});
  }, []);

  return { trainsRef, pathsMap, stationPassengers, surgeEvents, addTrain, removeTrain };
}
