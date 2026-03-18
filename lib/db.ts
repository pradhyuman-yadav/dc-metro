import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "subway.db");

export const CACHE_TTL_SECONDS = 86_400; // 24 hours

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS subway_routes (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      ref        TEXT    NOT NULL,
      colour     TEXT    NOT NULL,
      segments   TEXT    NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subway_stations (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      lat        REAL    NOT NULL,
      lng        REAL    NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_lines (
      station_id INTEGER NOT NULL REFERENCES subway_stations(id) ON DELETE CASCADE,
      route_ref  TEXT    NOT NULL,
      colour     TEXT    NOT NULL,
      PRIMARY KEY (station_id, route_ref)
    );
  `);

  return db;
}

export function isCacheStale(fetchedAt: number): boolean {
  return Math.floor(Date.now() / 1000) - fetchedAt > CACHE_TTL_SECONDS;
}
