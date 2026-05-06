"use client";
import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { useMapEvents } from "react-leaflet";
import L from "leaflet";
import { getTrainLatLng } from "@/lib/simulation";
import type { TrainState, RoutePath } from "@/lib/simulation";
import { getTrainSize, MIN_TRAIN_ZOOM } from "./TrainLayer";

export interface HoveredTrainInfo {
  train: TrainState;
  containerX: number;
  containerY: number;
  nextStation: string | null;
  prevStation: string | null;
}

interface TrainHoverLayerProps {
  trainsRef: MutableRefObject<TrainState[]>;
  pathsMap: Map<number, RoutePath>;
  onHover: (info: HoveredTrainInfo | null) => void;
}

export function getAdjacentStations(
  train: TrainState,
  path: RoutePath
): { next: string | null; prev: string | null } {
  const stops = path.stops;
  if (!stops.length) return { next: null, prev: null };

  const d = train.distanceTravelled;

  if (train.direction === 1) {
    const nextStop = stops.find((s) => s.distanceAlong > d);
    const prevStop = [...stops].reverse().find((s) => s.distanceAlong <= d);
    return {
      next: nextStop?.stationName ?? null,
      prev: prevStop?.stationName ?? null,
    };
  } else {
    const nextStop = [...stops].reverse().find((s) => s.distanceAlong < d);
    const prevStop = stops.find((s) => s.distanceAlong >= d);
    return {
      next: nextStop?.stationName ?? null,
      prev: prevStop?.stationName ?? null,
    };
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
        const { next, prev } = getAdjacentStations(train, path);
        closest = {
          train,
          containerX: trainContainer.x,
          containerY: trainContainer.y,
          nextStation: next,
          prevStation: prev,
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
