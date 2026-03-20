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

    CREATE TABLE IF NOT EXISTS route_paths (
      route_id       INTEGER PRIMARY KEY,
      route_ref      TEXT    NOT NULL,
      route_colour   TEXT    NOT NULL,
      route_name     TEXT    NOT NULL,
      waypoints      TEXT    NOT NULL,
      distances      TEXT    NOT NULL,
      total_distance REAL    NOT NULL,
      fetched_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS train_states (
      id                TEXT    PRIMARY KEY,
      route_id          INTEGER NOT NULL,
      ref               TEXT    NOT NULL,
      colour            TEXT    NOT NULL,
      name              TEXT    NOT NULL,
      dist              REAL    NOT NULL,
      direction         INTEGER NOT NULL,
      status            TEXT    NOT NULL,
      station           TEXT,
      platform          TEXT    NOT NULL,
      dwell             REAL    NOT NULL,
      partner_route_id  INTEGER,
      saved_at          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_passengers (
      station_name       TEXT    PRIMARY KEY,
      capacity           INTEGER NOT NULL,
      current_passengers INTEGER NOT NULL DEFAULT 0,
      updated_at         REAL    NOT NULL
    );
  `);

  // Safe migration: add passengers column to existing train_states tables
  try {
    db.prepare(
      "ALTER TABLE train_states ADD COLUMN passengers INTEGER NOT NULL DEFAULT 0"
    ).run();
  } catch {
    // Column already exists — safe to ignore
  }

  return db;
}

export function isCacheStale(fetchedAt: number): boolean {
  return Math.floor(Date.now() / 1000) - fetchedAt > CACHE_TTL_SECONDS;
}
