"use client";
import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { useMapEvents } from "react-leaflet";
import L from "leaflet";
import { getTrainLatLng, DEFAULT_CONFIG } from "@/lib/simulation";
import type { TrainState, RoutePath } from "@/lib/simulation";
import { getTrainSize, MIN_TRAIN_ZOOM } from "./TrainLayer";

// Mirror of simulation constants (avoids exporting private values from lib/simulation)
const SLOW_ZONE_KM = 0.25;
const MIN_SPEED_FACTOR = 0.08;
const MAX_SPEED_KMH = Math.round(DEFAULT_CONFIG.speedKmPerMs * 1_000 * 3_600); // ~88

export interface HoveredTrainInfo {
  train: TrainState;
  containerX: number;
  containerY: number;
  nextStation: string | null;
  prevStation: string | null;
  /** Approximate ETA to next stop in seconds; null if at station or no next stop */
  etaSeconds: number | null;
  /** Approximate current speed in km/h (0 when stopped) */
  speedKmh: number;
}

interface TrainHoverLayerProps {
  trainsRef: MutableRefObject<TrainState[]>;
  pathsMap: Map<number, RoutePath>;
  onHover: (info: HoveredTrainInfo | null) => void;
}

export function getAdjacentStations(
  train: TrainState,
  path: RoutePath
): { next: string | null; prev: string | null; nextDistKm: number | null } {
  const stops = path.stops;
  if (!stops.length) return { next: null, prev: null, nextDistKm: null };

  const d = train.distanceTravelled;

  if (train.direction === 1) {
    const nextStop = stops.find((s) => s.distanceAlong > d);
    const prevStop = [...stops].reverse().find((s) => s.distanceAlong <= d);
    return {
      next: nextStop?.stationName ?? null,
      prev: prevStop?.stationName ?? null,
      nextDistKm: nextStop ? nextStop.distanceAlong - d : null,
    };
  } else {
    const nextStop = [...stops].reverse().find((s) => s.distanceAlong < d);
    const prevStop = stops.find((s) => s.distanceAlong >= d);
    return {
      next: nextStop?.stationName ?? null,
      prev: prevStop?.stationName ?? null,
      nextDistKm: nextStop ? d - nextStop.distanceAlong : null,
    };
  }
}

/** Estimate current speed in km/h based on proximity to next stop. */
function estimateSpeedKmh(train: TrainState, nextDistKm: number | null): number {
  if (train.status === "at_station") return 0;
  if (nextDistKm !== null && nextDistKm < SLOW_ZONE_KM) {
    const factor = Math.max(nextDistKm / SLOW_ZONE_KM, MIN_SPEED_FACTOR);
    return Math.round(DEFAULT_CONFIG.speedKmPerMs * factor * 1_000 * 3_600);
  }
  return MAX_SPEED_KMH;
}

/** Estimate ETA to next stop in seconds using a simple integration over the slow zone. */
function estimateEta(train: TrainState, nextDistKm: number | null): number | null {
  if (train.status === "at_station" || nextDistKm === null) return null;
  const v0 = DEFAULT_CONFIG.speedKmPerMs * 1_000; // km/s at max speed

  if (nextDistKm >= SLOW_ZONE_KM) {
    // Free-run portion + average over slow zone
    const freeTime = (nextDistKm - SLOW_ZONE_KM) / v0;
    const avgFactor = (1 + MIN_SPEED_FACTOR) / 2;
    const slowTime = SLOW_ZONE_KM / (v0 * avgFactor);
    return Math.ceil(freeTime + slowTime);
  } else {
    // Already inside slow zone
    const entryFactor = nextDistKm / SLOW_ZONE_KM; // factor at current position
    const avgFactor = Math.max((entryFactor + MIN_SPEED_FACTOR) / 2, MIN_SPEED_FACTOR);
    return Math.ceil(nextDistKm / (v0 * avgFactor));
  }
}

export default function TrainHoverLayer({
  trainsRef,
  pathsMap,
  onHover,
}: TrainHoverLayerProps) {
  const pathsRef = useRef(pathsMap);
  pathsRef.current = pathsMap;

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  // RAF gate: only run hit-detection once per animation frame regardless of
  // how fast mousemove events fire (can be >100 Hz on high-refresh screens).
  const rafPending = useRef(false);
  const lastLatLng = useRef<L.LatLng | null>(null);

  const runHitDetection = useCallback((map: L.Map) => {
    rafPending.current = false;
    const latlng = lastLatLng.current;
    if (!latlng) return;

    const zoom = map.getZoom();
    if (zoom < MIN_TRAIN_ZOOM) {
      onHoverRef.current(null);
      return;
    }

    const { w, h } = getTrainSize(zoom);
    const hitRadius = Math.max(w, h) / 2 + 6; // px threshold
    const mouseContainer = map.latLngToContainerPoint(latlng);

    let closest: HoveredTrainInfo | null = null;
    let closestDist = Infinity;

    for (const train of trainsRef.current) {
      const path = pathsRef.current.get(train.routeId);
      if (!path) continue;

      const pos = getTrainLatLng(train, path);
      const trainContainer = map.latLngToContainerPoint(L.latLng(pos[0], pos[1]));

      const dx = mouseContainer.x - trainContainer.x;
      const dy = mouseContainer.y - trainContainer.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < hitRadius && dist < closestDist) {
        closestDist = dist;
        const { next, prev, nextDistKm } = getAdjacentStations(train, path);
        closest = {
          train,
          containerX: trainContainer.x,
          containerY: trainContainer.y,
          nextStation: next,
          prevStation: prev,
          etaSeconds: estimateEta(train, nextDistKm),
          speedKmh: estimateSpeedKmh(train, nextDistKm),
        };
      }
    }

    onHoverRef.current(closest);
  }, [trainsRef]);

  const map = useMapEvents({
    mousemove(e) {
      lastLatLng.current = e.latlng;
      if (!rafPending.current) {
        rafPending.current = true;
        requestAnimationFrame(() => runHitDetection(map));
      }
    },
    mouseout() {
      lastLatLng.current = null;
      onHoverRef.current(null);
    },
  });

  useEffect(() => {
    return () => {
      onHoverRef.current(null);
    };
  }, []);

  return null;
}
