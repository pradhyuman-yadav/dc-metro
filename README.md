# DC Metro Live

A real-time Washington DC Metro simulation running in the browser. Every train, station, and passenger is simulated on a single authoritative Node.js server and broadcast live to all connected clients via Server-Sent Events. Track geometry is fetched directly from OpenStreetMap — no hardcoded coordinates.

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript) ![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet) ![Tests](https://img.shields.io/badge/tests-265%20passing-22c55e)

---

## What It Is

DC Metro Live simulates the Washington Metropolitan Area Transit Authority (WMATA) rail network in real time. Six Metro lines (Red, Orange, Silver, Blue, Yellow, Green) run simultaneously with physically modelled trains, autonomous passenger demand, and spontaneous surge events — all without central coordination.

---

## Why It Was Built

The project explores what happens when you build a transit simulation from first principles rather than from pre-packaged tools:

- Can a single Node.js event loop reliably drive ~60 trains at 100 ms ticks?
- Does a purely physics-based headway model produce realistic train spacing without timetables?
- Can OSM Overpass data be stitched into continuous polylines robust enough for animation?
- How do autonomous passengers and surge events interact with train capacity without being told what to do?

The result is a coherent, self-regulating system where emergent behaviour (trains backing up at busy stations, passengers overflowing during surges) arises naturally from simple per-object rules.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│                                                                 │
│  MapInner.tsx ──► TrainLayer   (Canvas, 100 ms rAF)            │
│               ──► StationLayer (Leaflet markers)               │
│               ──► SubwayLayer  (Leaflet polylines)             │
│               ──► SidePanel    (Stats, fleet, line info)       │
│               ──► AboutPanel   (Collapsible left panel)        │
│                                                                 │
│  useSimulation ──► EventSource ──────────────────────────────┐  │
│  useSubwayRoutes ──► /api/subway/routes                      │  │
│  useSubwayStations ──► /api/subway/stations                  │  │
└──────────────────────────────────────────────────────────────┼──┘
                                                               │ SSE
┌──────────────────────────────────────────────────────────────▼──┐
│                      Next.js Server (Node.js)                   │
│                                                                 │
│  SimServer (global singleton)                                   │
│  ├── tickSimulation() ──► 100 ms setInterval                   │
│  ├── surgeEvents ──► fires every 45–90 min, lasts 5 min        │
│  └── SSE broadcast ──► all connected EventSource clients       │
│                                                                 │
│  API Routes                                                     │
│  ├── /api/subway/stream          SSE broadcast                 │
│  ├── /api/subway/routes          Overpass cache                │
│  ├── /api/subway/stations        Overpass cache                │
│  ├── /api/subway/trains          Persist/load train state      │
│  ├── /api/subway/trains/add      Spawn train on route          │
│  ├── /api/subway/trains/remove   Remove train from route       │
│  ├── /api/subway/paths           Persist/load stitched paths   │
│  ├── /api/subway/station-passengers   Passenger state          │
│  └── /api/subway/refresh         Force Overpass re-fetch       │
│                                                                 │
│  SQLite (better-sqlite3, WAL mode)                             │
│  └── data/subway.db                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  OpenStreetMap    │
                    │  Overpass API     │
                    │  (24 h TTL cache) │
                    └───────────────────┘
```

---

## System Design

### 1. Single Source of Truth

One `SimServer` singleton runs on the Next.js server process (stored in `global.__dcMetroSim`). It owns the authoritative train array and ticks the simulation every 100 ms. Every browser that opens the page connects to the same simulation state — they don't get their own copy. 100 simultaneous visitors all see the same trains in the same positions.

### 2. Physics Engine (`lib/simulation.ts`)

`tickSimulation(trains, paths, passengers, config, dt)` is a pure function: given current state and elapsed time, it returns new state. No mutation. Rules enforced every tick:

| Rule | Detail |
|---|---|
| Speed | `speedKmPerMs × dt` (~88 km/h equivalent) |
| Station approach | Linear deceleration over 250 m slow-zone; min 8% speed at threshold |
| Hard stop | Train stops if < 20 m from an occupied station |
| Headway | Train stops if < 150 m behind the train ahead on the same path |
| Platform capacity | 1 train per station per direction (keyed `stationName:direction`) |
| Multi-level stations | Separate occupancy key per physical level (Metro Center, Gallery Place, L'Enfant Plaza, Fort Totten) |
| Dwell | Regular station: 60 s; terminus: 5 min |
| Terminus bounce | Train flips direction and transfers to the paired reverse-direction route |
| Passenger boarding | Proportional to station demand; capped by train capacity (1 050) |
| Passenger alighting | Fraction exits at each stop |
| Surge response | Station demand spikes 3–5× during active surge; trains fill faster |

### 3. Track Geometry (`lib/overpass.ts` + `lib/simulation.ts`)

Track geometry comes from OpenStreetMap via the Overpass API. Raw data is a set of disconnected `way` segments per route. Building a continuous polyline requires:

1. **Endpoint graph** — each segment contributes its two endpoints as graph nodes
2. **BFS stitching** (`stitchSegments`) — walks the graph from an arbitrary start, reversing segments as needed, tolerating gaps < 300 m, producing one continuous ordered coordinate array
3. **Haversine distances** — cumulative kilometre marks pre-computed along the stitched path; `distanceAlong` maps to `[lat, lng]` via binary search at render time

No route coordinates are hardcoded. If OSM data changes, a `POST /api/subway/refresh` rebuilds everything.

### 4. Station Assignment

Stations are matched to routes by **proximity (350 m radius) AND line-colour membership**. A station close to multiple lines is only assigned to the lines whose colour it carries in OSM data. A manual correction map overrides OSM for three downtown stations where raw data has cross-contamination:

| Station | Correct Lines |
|---|---|
| Farragut North | Red only |
| Farragut West | Blue, Orange, Silver |
| McPherson Square | Blue, Orange, Silver |

### 5. Persistence (`lib/db.ts`)

SQLite (better-sqlite3, WAL mode) stores:

- Overpass API responses with a 24-hour TTL so the app does not hammer OSM
- Stitched route paths (expensive BFS — reused across restarts)
- Live train state snapshot (saved every 60 s; trains resume exact km position after restart)
- Station passenger state

The database file lives at `data/subway.db` inside the container, mounted as a named Docker volume so it survives container restarts.

### 6. Client Rendering

**Trains** — HTML5 Canvas layer (`TrainLayer.tsx`) via `requestAnimationFrame`. Each train is a filled rectangle rotated to match track bearing, coloured by route, scaled with zoom. Canvas avoids DOM thrashing when redrawing 60+ objects at 60 fps.

**Stations** — Leaflet `CircleMarker` instances with coloured dot badges per served line.

**Routes** — Leaflet `Polyline` instances from stitched waypoints.

**Hover tooltip** — `TrainHoverLayer` detects mouse proximity to train positions and renders a floating tooltip: line, status, dwell countdown, prev/next station, passenger load bar.

**Theme** — CartoDB light/dark tile layers swap on theme change without remounting the map.

---

## API Reference

All routes are under `/api/subway/`. All return JSON. All are `force-dynamic` (no Next.js cache).

### `GET /api/subway/routes`

Returns all six Metro lines with full waypoint geometry.

```json
[
  {
    "id": 1234567,
    "name": "Red Line",
    "ref": "RD",
    "colour": "#BF0D3E",
    "segments": [[38.921, -77.031], "..."]
  }
]
```

### `GET /api/subway/stations`

Returns all Metro stations with their served line colours.

```json
[
  {
    "id": 9876543,
    "name": "Metro Center",
    "lat": 38.8983,
    "lng": -77.0281,
    "colours": ["#BF0D3E", "#009CDE", "#ED8B00", "#919D9D"]
  }
]
```

### `GET /api/subway/stream`

Server-Sent Events stream. Emits a JSON snapshot approximately every 100 ms.

```
data: {"trains":[...],"stationPassengers":[...],"surgeEvents":[...],"serviceActive":true}
```

**TrainState fields**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique train ID (e.g. `RD-3`) |
| `routeRef` | `string` | Line code (`RD` `OR` `SV` `BL` `YL` `GR`) |
| `routeColour` | `string` | Hex colour |
| `distanceAlong` | `number` | Kilometres along stitched path |
| `direction` | `1 \| -1` | Forward / reverse along path |
| `status` | `"moving" \| "at_station"` | Current state |
| `currentStation` | `string \| null` | Station name if dwelling |
| `platform` | `"A" \| "B"` | Platform identifier |
| `dwellRemaining` | `number` | Milliseconds left at station |
| `passengers` | `number` | Current passenger count (max 1 050) |

### `GET /api/subway/trains`

Returns persisted train state array from SQLite.

### `POST /api/subway/trains`

Persists the full train state array. Body: `{ trains: TrainState[] }`

### `POST /api/subway/trains/add`

Spawns a new train on the specified route. Body: `{ routeRef: "RD" }`

### `POST /api/subway/trains/remove`

Removes the last train from the specified route. Body: `{ routeRef: "RD" }`

### `GET /api/subway/paths`

Returns stitched route paths (waypoints + cumulative distances) from cache.

### `POST /api/subway/paths`

Persists stitched route paths.

### `GET /api/subway/station-passengers`

Returns per-station passenger state `{ capacity, currentPassengers }`.

### `POST /api/subway/station-passengers`

Persists station passenger state.

### `POST /api/subway/refresh`

Forces a fresh Overpass API fetch, bypassing the 24-hour TTL.

Body: `{ target: "all" | "routes" | "stations" }`

---

## Database Schema

```sql
-- Cached Overpass route data (24 h TTL)
subway_routes (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  ref         TEXT,        -- "RD", "OR", etc.
  colour      TEXT,        -- hex
  segments    TEXT,        -- JSON [[lat,lng], ...]
  fetched_at  INTEGER      -- Unix timestamp
)

-- Cached Overpass station data (24 h TTL)
subway_stations (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  lat         REAL,
  lng         REAL,
  fetched_at  INTEGER
)

-- Many-to-many: stations × lines
station_lines (
  station_id  INTEGER REFERENCES subway_stations(id),
  route_ref   TEXT,
  colour      TEXT,
  PRIMARY KEY (station_id, route_ref)
)

-- Pre-computed stitched paths (expensive BFS — reused across restarts)
route_paths (
  route_id        INTEGER PRIMARY KEY,
  route_ref       TEXT,
  route_colour    TEXT,
  route_name      TEXT,
  waypoints       TEXT,        -- JSON [[lat,lng], ...]
  distances       TEXT,        -- JSON [km, ...]
  total_distance  REAL,
  fetched_at      INTEGER
)

-- Live train state (snapshotted every 60 s)
train_states (
  id               TEXT PRIMARY KEY,
  route_id         INTEGER,
  ref              TEXT,
  colour           TEXT,
  name             TEXT,
  dist             REAL,    -- km along path
  direction        INTEGER,
  status           TEXT,
  station          TEXT,
  platform         TEXT,
  dwell            REAL,
  partner_route_id INTEGER,
  passengers       INTEGER,
  saved_at         INTEGER
)

-- Station passenger state
station_passengers (
  station_name       TEXT PRIMARY KEY,
  capacity           INTEGER,
  current_passengers INTEGER,
  updated_at         INTEGER
)
```

---

## Simulation Constants

| Constant | Value | Meaning |
|---|---|---|
| Tick interval | 100 ms | Server simulation frequency |
| Train speed | 0.0000244 km/ms | ~88 km/h max speed |
| Station dwell | 60 000 ms | 1 min regular stop |
| Terminus dwell | 300 000 ms | 5 min turnaround |
| Train capacity | 1 050 | Max passengers per train |
| Slow zone | 0.25 km | Station approach deceleration starts |
| Min speed factor | 8% | Lowest speed in slow zone |
| Hard stop | 0.020 km | Full stop distance from blocked station |
| Min headway | 0.15 km | Gap enforcement between trains |
| Station snap | 0.15 km | Radius for path stop matching |
| Surge duration | 5 min | How long a surge event lasts |
| Surge interval | 45–90 min | How often surge events fire |
| Surge multiplier | 3–5× | Passenger demand spike factor |
| Overpass TTL | 86 400 s | 24-hour OSM cache |
| DB snapshot | 60 s | Train state persistence interval |

---

## Metro Lines

| Code | Name | Colour | Terminals |
|---|---|---|---|
| RD | Red | `#BF0D3E` | Shady Grove ↔ Glenmont |
| OR | Orange | `#ED8B00` | Vienna/Fairfax-GMU ↔ New Carrollton |
| SV | Silver | `#919D9D` | Ashburn ↔ Downtown Largo |
| BL | Blue | `#009CDE` | Franconia-Springfield ↔ Downtown Largo |
| YL | Yellow | `#FFD100` | Huntington ↔ Greenbelt |
| GR | Green | `#00B140` | Branch Ave ↔ Greenbelt |

### Multi-Level Interchange Stations

Four stations have physically separate platforms for different lines. The simulation tracks platform occupancy independently per level:

| Station | Level 0 | Level 1 |
|---|---|---|
| Metro Center | Red Line | Blue / Orange / Silver |
| Gallery Place-Chinatown | Red Line | Green / Yellow |
| L'Enfant Plaza | Blue / Orange / Silver | Green / Yellow |
| Fort Totten | Red Line | Green / Yellow |

---

## Project Structure

```
train-sim-app/
├── app/
│   ├── api/subway/
│   │   ├── routes/route.ts           GET routes
│   │   ├── stations/route.ts         GET stations
│   │   ├── stream/route.ts           GET SSE stream
│   │   ├── trains/
│   │   │   ├── route.ts              GET/POST train state
│   │   │   ├── add/route.ts          POST add train
│   │   │   └── remove/route.ts       POST remove train
│   │   ├── paths/route.ts            GET/POST paths
│   │   ├── station-passengers/route.ts
│   │   └── refresh/route.ts          POST force refresh
│   ├── layout.tsx                    ThemeProvider root
│   ├── page.tsx                      Full-viewport map
│   └── globals.css
├── components/
│   ├── Map.tsx                       Dynamic import wrapper (no SSR)
│   ├── MapInner.tsx                  Leaflet map + all overlay layers
│   ├── SubwayLayer.tsx               Route polylines
│   ├── StationLayer.tsx              Station markers with line badges
│   ├── TrainLayer.tsx                Canvas train animation
│   ├── TrainHoverLayer.tsx           Mouse hover detection + tooltip
│   ├── SidePanel.tsx                 Dashboard sidebar (desktop + mobile)
│   └── LoadingScreen.tsx
├── hooks/
│   ├── useSimulation.ts              SSE client, train ref, add/remove
│   ├── useSubwayRoutes.ts            Fetches + caches route data
│   └── useSubwayStations.ts          Fetches + caches station data
├── lib/
│   ├── simulation.ts                 Core physics engine (pure functions)
│   ├── sim-server.ts                 Server singleton + 100 ms tick loop
│   ├── overpass.ts                   OSM Overpass API fetch + parse
│   ├── db.ts                         SQLite schema + WAL connection
│   ├── stations.ts                   DB CRUD + cache TTL checks
│   ├── station-capacities.ts         Per-station capacity constants
│   └── utils.ts                      cn() helper
├── __tests__/                        265 Vitest tests
│   ├── lib/
│   └── components/
├── data/                             SQLite database (gitignored)
├── Dockerfile                        3-stage Alpine build, port 3009
├── next.config.ts                    Standalone output, external sqlite3
├── vitest.config.ts
└── package.json
```

---

## Getting Started

### Local Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

### Production (Docker)

```bash
# Build image
docker build -t dc-metro .

# Run with persistent database volume
docker run -p 3009:3009 -v dc-metro-data:/app/data dc-metro

# Open http://localhost:3009
```

The Dockerfile uses a three-stage Alpine build:

1. **deps** — installs production + dev dependencies
2. **builder** — runs `next build` (standalone output)
3. **runner** — copies only the standalone bundle and static assets

The `data/` volume persists train positions and passenger state across container restarts.

---

## Testing

```bash
npm test                 # 265 tests across 19 suites
npm run test:watch       # watch mode
npm run test:coverage    # coverage report
```

Test coverage includes simulation physics, Overpass parser, DB operations, API routes, hooks, and components.

---

## Changelog

### `e6e4e45` — Latest
- Fix station line assignments: Farragut North, Farragut West, McPherson Square via `STATION_LINE_CORRECTIONS`
- Fix simulation routing: `mapStopsToRoute` now checks colour membership, preventing Red Line trains from stopping at BL/OR/SV-only stations
- Multi-level occupancy: independent platform slots per physical level at Metro Center, Gallery Place, L'Enfant Plaza, Fort Totten
- Train hover tooltip: line, status, dwell countdown, prev/next station, passenger load bar
- Custom zoom control: Leaflet default zoom removed, replaced with Zoom −/+ in bottom bar
- Left About panel: collapsible desktop panel on left side; removed duplicate from right panel
- Attribution repositioned to bottom-left
- UI cleanup: duplicate train controls removed from bottom bar

### Previous
| Commit | Change |
|---|---|
| `3199dda` | Fix tickSimulation map callback return type |
| `9ba56dd` | Strict TypeScript: type `dir` as `TrainDirection` |
| `85f0267` | Cast status literals to `TrainStatus` |
| `130325d` | Add expandable AccordionCards for Line Info panel |
| `d858211` | Match Live Fleet card padding and row spacing |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, standalone build) |
| UI | React 19, TypeScript 5 |
| Map | Leaflet 1.9, react-leaflet 5 |
| Animation | Framer Motion 12, HTML5 Canvas |
| Styling | Tailwind CSS 4, next-themes |
| Database | SQLite via better-sqlite3 12 |
| Testing | Vitest 2, @testing-library/react 16 |
| Container | Docker (Alpine, multi-stage) |
| Map tiles | CartoDB (light/dark) |
| Geodata | OpenStreetMap Overpass API |

---

Built by [Pradhyuman Yadav](https://github.com/pradhyuman-yadav)
