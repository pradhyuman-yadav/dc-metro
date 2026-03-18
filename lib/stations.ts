import { getDb, isCacheStale } from "@/lib/db";
import type { SubwayRoute } from "@/lib/overpass";
import type { SubwayStation } from "@/lib/overpass";

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

// ─── Cache control ────────────────────────────────────────────────────────────

export function clearAll(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM station_lines").run();
    db.prepare("DELETE FROM subway_stations").run();
    db.prepare("DELETE FROM subway_routes").run();
  })();
}
