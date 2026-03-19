"use client";
import { useEffect, useRef, useMemo, type MutableRefObject } from "react";
import type { SubwayRoute, SubwayStation } from "@/lib/overpass";
import { pairRoutes } from "@/lib/overpass";
import {
  buildRoutePaths,
  mapStopsToRoute,
  initTrains,
  tickSimulation,
  DEFAULT_CONFIG,
  type RoutePath,
  type TrainState,
  type SimulationConfig,
} from "@/lib/simulation";

export interface UseSimulationResult {
  /** Live train states — updated every RAF frame, never triggers React renders */
  trainsRef: MutableRefObject<TrainState[]>;
  pathsMap: Map<number, RoutePath>;
}

const SAVE_INTERVAL_MS = 60_000; // persist train states every 60 s
const PATH_SAVE_INTERVAL_MS = 3_600_000; // re-persist route paths every hour

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

  // Pair outbound ↔ inbound relations for each physical line so trains
  // transition to the return route at the terminus instead of reversing.
  const routePairs = useMemo(() => pairRoutes(routes), [routes]);

  const pathsMap = useMemo<Map<number, RoutePath>>(() => {
    if (routes.length === 0) return new Map();
    const raw = buildRoutePaths(routes);
    const enriched = raw.map((p) => mapStopsToRoute(p, stations));
    return new Map(enriched.map((p) => [p.routeId, p]));
  }, [routes, stations]);

  const trainsRef = useRef<TrainState[]>([]);

  // ── Seed trains (restore from DB or initialise fresh) ────────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) {
      trainsRef.current = [];
      return;
    }

    async function seed() {
      try {
        const res = await fetch("/api/subway/trains");
        if (res.ok) {
          const data = (await res.json()) as { states: TrainState[] };
          // Only restore trains whose route is still present
          const valid = data.states.filter((s) => pathsMap.has(s.routeId));
          if (valid.length > 0) {
            // Fill any routes that have no saved train with fresh ones
            const seenRoutes = new Set(valid.map((s) => s.routeId));
            const fresh: TrainState[] = [];
            for (const [routeId, path] of pathsMap) {
              if (!seenRoutes.has(routeId)) {
                fresh.push(...initTrains([path], cfg, routePairs));
              }
            }
            trainsRef.current = [...valid, ...fresh];
            return;
          }
        }
      } catch {
        // Network error — fall through to fresh init
      }
      // Fresh initialisation
      trainsRef.current = initTrains(Array.from(pathsMap.values()), cfg, routePairs);
    }

    seed();
  }, [pathsMap, cfg, routePairs]);

  // ── RAF animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (pathsMap.size === 0) return;

    let lastTime: number | null = null;
    let rafId: number;

    function frame(now: number) {
      const dt = lastTime !== null ? Math.min(now - lastTime, 100) : 0;
      lastTime = now;
      trainsRef.current = tickSimulation(trainsRef.current, pathsMap, dt, cfg);
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [pathsMap, cfg]);

  // ── Periodic train state persistence ─────────────────────────────────────────
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
      } catch {
        // Non-critical — best-effort persistence
      }
    }, SAVE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [pathsMap]);

  // ── Route path persistence ─────────────────────────────────────────────────
  // Persist stitched+smoothed paths to SQLite so SubwayLayer can render the
  // exact same geometry as the simulation (no track/train mismatch on reload).
  // Best-effort: runs once on mount, then hourly.
  useEffect(() => {
    if (pathsMap.size === 0) return;

    const save = async () => {
      try {
        await fetch("/api/subway/paths", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Array.from(pathsMap.values())),
        });
      } catch {
        // Non-critical
      }
    };

    save();
    const intervalId = setInterval(save, PATH_SAVE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [pathsMap]);

  return { trainsRef, pathsMap };
}
