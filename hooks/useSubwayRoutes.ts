"use client";
import { useState, useEffect } from "react";
import type { SubwayRoute } from "@/lib/overpass";
import { DC_BBOX } from "@/lib/overpass";

export interface UseSubwayRoutesResult {
  routes: SubwayRoute[];
  loading: boolean;
  error: Error | null;
}

/**
 * Session cache — DC Metro routes never change during a page session.
 * Fetch once from the API, reuse forever.
 */
let sessionCache: { bbox: string; routes: SubwayRoute[] } | null = null;

export function _clearCache() {
  sessionCache = null;
}

async function fetchRoutesFromApi(
  bbox: [number, number, number, number]
): Promise<SubwayRoute[]> {
  const res = await fetch(`/api/subway/routes?bbox=${bbox.join(",")}`);
  if (!res.ok) throw new Error(`Routes API error: ${res.status}`);
  const { routes } = await res.json();
  return routes as SubwayRoute[];
}

export function useSubwayRoutes(
  bbox: [number, number, number, number] = DC_BBOX
): UseSubwayRoutesResult {
  const [routes, setRoutes] = useState<SubwayRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const bboxKey = bbox.join(",");

  useEffect(() => {
    if (sessionCache && sessionCache.bbox === bboxKey) {
      setRoutes(sessionCache.routes);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchRoutesFromApi(bbox)
      .then((data) => {
        if (!cancelled) {
          sessionCache = { bbox: bboxKey, routes: data };
          setRoutes(data);
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

  return { routes, loading, error };
}
