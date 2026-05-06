# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next.js dev server with Turbopack (http://localhost:3000)
npm run build        # Production build
npm test             # Run all 265 Vitest tests
npm run test:watch   # Watch mode
npm run test:coverage

# Docker
docker build -t dc-metro .
docker run -p 3009:3009 -v dc-metro-data:/app/data dc-metro
```

Run a single test file:
```bash
npx vitest run __tests__/lib/simulation.test.ts
```

**Post-change rule:** Run `npm test` after every code change. All tests must pass (exit 0) before proceeding.

## Architecture

DC Metro Live is a real-time transit simulation. One authoritative Node.js singleton ticks a physics engine every 100 ms and broadcasts state to all clients via Server-Sent Events. Clients render only — no local simulation.

### Server-side flow

`lib/sim-server.ts` holds a global singleton (`global.__dcMetroSim`) that owns the live `TrainState[]` array. It calls `tickSimulation()` every 100 ms, then SSE-broadcasts the result through `/api/subway/stream`.

`lib/simulation.ts` — pure function: `tickSimulation(trains, paths, passengers, config, dt) → TrainState[]`. No side effects. All physics lives here (speed, deceleration, headway, dwell, boarding/alighting, surge).

`lib/overpass.ts` — fetches Metro line geometry from OpenStreetMap Overpass API, stitches disconnected `way` segments into continuous polylines via BFS (`stitchSegments`), computes cumulative km marks. 24-hour TTL cache in SQLite.

`lib/db.ts` — SQLite via `better-sqlite3` in WAL mode. Stores Overpass responses, stitched paths, live train snapshots (every 60 s), and station passenger state. DB file: `data/subway.db` (Docker volume).

`lib/stations.ts` — station CRUD + 350 m proximity + line-colour matching. Three stations have hardcoded corrections in `STATION_LINE_CORRECTIONS` (Farragut North → Red only; Farragut West, McPherson Square → BL/OR/SV only).

Multi-level stations (Metro Center, Gallery Place, L'Enfant Plaza, Fort Totten) have independent occupancy keys per physical level so trains on different lines don't block each other.

### Client-side flow

`hooks/useSimulation.ts` opens an `EventSource` to `/api/subway/stream` and exposes the live `TrainState[]` ref, plus `addTrain`/`removeTrain` helpers.

`hooks/useSubwayRoutes.ts` and `hooks/useSubwayStations.ts` fetch static geometry once on mount.

`components/MapInner.tsx` composes all layers inside a Leaflet map. Train positions are rendered on an HTML5 Canvas (`TrainLayer.tsx`) via `requestAnimationFrame` — not as DOM elements — to handle 60+ objects at 60 fps without thrashing. Stations use Leaflet `CircleMarker`. Routes use Leaflet `Polyline`.

`components/TrainHoverLayer.tsx` detects mouse proximity to canvas train positions and shows a floating tooltip (line, status, dwell countdown, prev/next station, passenger load bar).

### Key invariants

- `tickSimulation` is pure — never mutate inputs, always return new state
- `Map.tsx` uses `dynamic(..., { ssr: false })` — Leaflet requires browser globals
- All API routes are `force-dynamic` (no Next.js static caching)
- Station snap radius: 0.15 km; headway enforcement: 0.15 km; slow zone: 0.25 km
- Train capacity: 1 050 passengers; terminus dwell: 5 min; regular dwell: 60 s

## Testing

Tests use Vitest + jsdom + `@testing-library/react`. Coverage spans simulation physics, Overpass parser, DB operations, all API routes, hooks, and components. `vitest.setup.ts` configures `@testing-library/jest-dom` matchers.

## Deployment

`next.config.ts` sets `output: 'standalone'` and externalises `better-sqlite3` (native binary). The Dockerfile is three-stage Alpine: deps → builder → runner. Port 3009. `data/` is a named Docker volume for DB persistence across restarts.
