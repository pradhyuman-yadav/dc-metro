"use client";
import { useState, useEffect } from "react";
import type { SubwayStation } from "@/lib/overpass";
import { DC_BBOX } from "@/lib/overpass";

export interface UseSubwayStationsResult {
  stations: SubwayStation[];
  loading: boolean;
  error: Error | null;
}

let sessionCache: { bbox: string; stations: SubwayStation[] } | null = null;

export function _clearStationCache() {
  sessionCache = null;
}

async function fetchStationsFromApi(
  bbox: [number, number, number, number]
): Promise<SubwayStation[]> {
  const res = await fetch(`/api/subway/stations?bbox=${bbox.join(",")}`);
  if (!res.ok) throw new Error(`Stations API error: ${res.status}`);
  const { stations } = await res.json();
  return stations as SubwayStation[];
}

export function useSubwayStations(
  bbox: [number, number, number, number] = DC_BBOX
): UseSubwayStationsResult {
  const [stations, setStations] = useState<SubwayStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const bboxKey = bbox.join(",");

  useEffect(() => {
    if (sessionCache && sessionCache.bbox === bboxKey) {
      setStations(sessionCache.stations);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchStationsFromApi(bbox)
      .then((data) => {
        if (!cancelled) {
          sessionCache = { bbox: bboxKey, stations: data };
          setStations(data);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);

  return { stations, loading, error };
}
