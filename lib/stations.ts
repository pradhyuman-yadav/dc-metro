import { getDb, isCacheStale } from "@/lib/db";
import type { SubwayRoute } from "@/lib/overpass";
import type { SubwayStation } from "@/lib/overpass";
import type { TrainState, RoutePath } from "@/lib/simulation";

// ─── Routes ──────────────────────────────────────────────────────────────────

interface RouteRow {
  id: number;
  name: string;
  ref: string;
  colour: string;
  segments: string;
  fetched_at: number;
}

export function getRoutesFetchedAt(): number {
  const db = getDb();
  const row = db.prepare("SELECT MIN(fetched_at) as t FROM subway_routes").get() as
    | { t: number | null }
    | undefined;
  return row?.t ?? 0;
}

export function getCachedRoutes(): SubwayRoute[] | null {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM subway_routes").all() as RouteRow[];
  if (rows.length === 0) return null;
  if (isCacheStale(rows[0].fetched_at)) return null;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ref: r.ref,
    colour: r.colour,
    segments: JSON.parse(r.segments) as [number, number][][],
  }));
}

export function upsertRoutes(routes: SubwayRoute[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO subway_routes (id, name, ref, colour, segments, fetched_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    db.prepare("DELETE FROM subway_routes").run();
    for (const r of routes) {
      insert.run(r.id, r.name, r.ref, r.colour, JSON.stringify(r.segments), now);
    }
  })();
}

// ─── Stations ─────────────────────────────────────────────────────────────────

interface StationRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  fetched_at: number;
}

interface StationLineRow {
  station_id: number;
  route_ref: string;
  colour: string;
}

export function getStationsFetchedAt(): number {
  const db = getDb();
  const row = db.prepare("SELECT MIN(fetched_at) as t FROM subway_stations").get() as
    | { t: number | null }
    | undefined;
  return row?.t ?? 0;
}

export function getCachedStations(): SubwayStation[] | null {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM subway_stations").all() as StationRow[];
  if (rows.length === 0) return null;
  if (isCacheStale(rows[0].fetched_at)) return null;

  const lineRows = db.prepare("SELECT * FROM station_lines").all() as StationLineRow[];
  const colourMap = new Map<number, string[]>();
  for (const lr of lineRows) {
    const list = colourMap.get(lr.station_id) ?? [];
    list.push(lr.colour);
    colourMap.set(lr.station_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    colours: colourMap.get(r.id) ?? [],
  }));
}

export function upsertStations(stations: SubwayStation[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const insertStation = db.prepare(
    "INSERT OR REPLACE INTO subway_stations (id, name, lat, lng, fetched_at) VALUES (?, ?, ?, ?, ?)"
  );
  const insertLine = db.prepare(
    "INSERT OR REPLACE INTO station_lines (station_id, route_ref, colour) VALUES (?, ?, ?)"
  );
  db.transaction(() => {
    db.prepare("DELETE FROM subway_stations").run();
    for (const s of stations) {
      insertStation.run(s.id, s.name, s.lat, s.lng, now);
      for (const colour of s.colours) {
        insertLine.run(s.id, colour, colour);
      }
    }
  })();
}

// ─── Train states ─────────────────────────────────────────────────────────────

interface TrainStateRow {
  id: string; route_id: number; ref: string; colour: string; name: string;
  dist: number; direction: number; status: string; station: string | null;
  platform: string; dwell: number; saved_at: number;
}

/** Returns saved train states, or null if table is empty / stale (> 24 h). */
export function getTrainStates(): { states: TrainState[]; savedAt: number } | null {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM train_states").all() as TrainStateRow[];
  if (rows.length === 0) return null;
  if (isCacheStale(rows[0].saved_at)) return null;

  return {
    savedAt: rows[0].saved_at,
    states: rows.map((r) => ({
      id:                r.id,
      routeId:           r.route_id,
      routeRef:          r.ref,
      routeColour:       r.colour,
      routeName:         r.name,
      distanceTravelled: r.dist,
      direction:         r.direction as 1 | -1,
      status:            r.status as "moving" | "at_station",
      currentStation:    r.station ?? null,
      platform:          r.platform as "A" | "B",
      dwellRemaining:    r.dwell,
    })),
  };
}

/** Upserts all train states in a single transaction. */
export function upsertTrainStates(states: TrainState[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO train_states
     (id, route_id, ref, colour, name, dist, direction, status, station, platform, dwell, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare("DELETE FROM train_states").run();
    for (const s of states) {
      stmt.run(
        s.id, s.routeId, s.routeRef, s.routeColour, s.routeName,
        s.distanceTravelled, s.direction, s.status,
        s.currentStation, s.platform, s.dwellRemaining, now
      );
    }
  })();
}

// ─── Route paths (stitched + smoothed geometry) ───────────────────────────────

interface RoutePathRow {
  route_id: number;
  route_ref: string;
  route_colour: string;
  route_name: string;
  waypoints: string;
  distances: string;
  total_distance: number;
  fetched_at: number;
}

/**
 * Returns stitched + smoothed route paths from SQLite, or null if empty/stale.
 * Stops are NOT stored — they are recomputed from current station data on load.
 */
export function getCachedRoutePaths(): Omit<RoutePath, "stops">[] | null {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM route_paths").all() as RoutePathRow[];
  if (rows.length === 0) return null;
  if (isCacheStale(rows[0].fetched_at)) return null;
  return rows.map((r) => ({
    routeId:       r.route_id,
    routeRef:      r.route_ref,
    routeColour:   r.route_colour,
    routeName:     r.route_name,
    waypoints:     JSON.parse(r.waypoints) as [number, number][],
    distances:     JSON.parse(r.distances) as number[],
    totalDistance: r.total_distance,
  }));
}

/** Persists stitched + smoothed route paths (stops excluded) in one transaction. */
export function upsertRoutePaths(paths: RoutePath[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO route_paths
     (route_id, route_ref, route_colour, route_name, waypoints, distances, total_distance, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare("DELETE FROM route_paths").run();
    for (const p of paths) {
      stmt.run(
        p.routeId, p.routeRef, p.routeColour, p.routeName,
        JSON.stringify(p.waypoints), JSON.stringify(p.distances),
        p.totalDistance, now
      );
    }
  })();
}

// ─── Cache control ────────────────────────────────────────────────────────────

export function clearAll(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM train_states").run();
    db.prepare("DELETE FROM route_paths").run();
    db.prepare("DELETE FROM station_lines").run();
    db.prepare("DELETE FROM subway_stations").run();
    db.prepare("DELETE FROM subway_routes").run();
  })();
}
