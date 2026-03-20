import { describe, it, expect } from "vitest";
import {
  haversineKm,
  stitchSegments,
  smoothPath,
  buildRoutePaths,
  mapStopsToRoute,
  initTrains,
  getTrainLatLng,
  getTrainSegmentBearing,
  tickSimulation,
  detectPathGaps,
  DEFAULT_CONFIG,
  type RoutePath,
  type TrainState,
} from "@/lib/simulation";
import type { SubwayRoute, SubwayStation } from "@/lib/overpass";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RED_ROUTE: SubwayRoute = {
  id: 1,
  name: "Red Line",
  ref: "RED",
  colour: "#BF0000",
  segments: [
    [[38.90, -77.03], [38.91, -77.02]],
    [[38.91, -77.02], [38.92, -77.01]],
  ],
};

const SINGLE_SEG_ROUTE: SubwayRoute = {
  id: 2,
  name: "Blue Line",
  ref: "BLUE",
  colour: "#0076A8",
  segments: [[[38.80, -77.10], [38.85, -77.05], [38.90, -77.00]]],
};

const EMPTY_ROUTE: SubwayRoute = {
  id: 3,
  name: "Empty Line",
  ref: "EMPTY",
  colour: "#999999",
  segments: [],
};

// Station positions are placed within ~40 m of the nearest RED_ROUTE waypoint
// so they pass the MAX_STATION_DIST_KM (0.35 km) proximity filter.
// RED_ROUTE waypoints: [38.90,-77.03], [38.91,-77.02], [38.92,-77.01]
const STATION_A: SubwayStation = {
  id: 101, name: "Station A",
  lat: 38.9003, lng: -77.0297, // ~40 m from [38.90, -77.03]
  colours: ["#BF0000"],
};

const STATION_B: SubwayStation = {
  id: 102, name: "Station B",
  lat: 38.9202, lng: -77.0098, // ~30 m from [38.92, -77.01]
  colours: ["#BF0000"],
};

// Station far from the Red route — used to verify proximity exclusion.
// SINGLE_SEG_ROUTE passes through (38.85, -77.05), so STATION_BLUE is
// ON that route but NOT near RED_ROUTE.
const STATION_BLUE: SubwayStation = {
  id: 103, name: "Blue Station",
  lat: 38.85, lng: -77.05,
  colours: ["#0076A8"],
};

// ─── haversineKm ─────────────────────────────────────────────────────────────

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm([38.9, -77.0], [38.9, -77.0])).toBe(0);
  });

  it("returns a positive distance for different points", () => {
    expect(haversineKm([38.9, -77.0], [38.91, -77.01])).toBeGreaterThan(0);
  });

  it("is symmetric", () => {
    const a: [number, number] = [38.9, -77.0];
    const b: [number, number] = [39.0, -77.1];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it("returns ~111 km per degree of latitude", () => {
    const d = haversineKm([0, 0], [1, 0]);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

// ─── stitchSegments ───────────────────────────────────────────────────────────

describe("stitchSegments", () => {
  it("returns empty array for no segments", () => {
    expect(stitchSegments([])).toHaveLength(0);
  });

  it("returns segment as-is when there is only one", () => {
    const seg: [number, number][] = [[38.9, -77.0], [38.91, -77.01]];
    expect(stitchSegments([seg])).toEqual(seg);
  });

  it("connects two segments that share an endpoint (drops duplicate)", () => {
    const a: [number, number][] = [[38.9, -77.0], [38.91, -77.01]];
    const b: [number, number][] = [[38.91, -77.01], [38.92, -77.02]];
    const result = stitchSegments([a, b]);
    expect(result).toHaveLength(3); // 2 + 2 - 1 duplicate
    expect(result[0]).toEqual([38.9, -77.0]);
    expect(result[2]).toEqual([38.92, -77.02]);
  });

  it("reverses a segment when its end is closer to the tail", () => {
    const a: [number, number][] = [[38.9, -77.0], [38.91, -77.01]];
    // b is stored backwards: its END connects to the tail of a
    const b: [number, number][] = [[38.92, -77.02], [38.91, -77.01]];
    const result = stitchSegments([a, b]);
    // After reversing b: [38.91,-77.01],[38.92,-77.02]
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual([38.92, -77.02]);
  });

  it("does not mutate the original segments", () => {
    const a: [number, number][] = [[38.9, -77.0], [38.91, -77.01]];
    const b: [number, number][] = [[38.92, -77.02], [38.91, -77.01]]; // reversed
    const origA = JSON.stringify(a);
    const origB = JSON.stringify(b);
    stitchSegments([a, b]);
    expect(JSON.stringify(a)).toBe(origA);
    expect(JSON.stringify(b)).toBe(origB);
  });
});

// ─── smoothPath ───────────────────────────────────────────────────────────────

describe("smoothPath", () => {
  it("returns the input unchanged for fewer than 3 points", () => {
    const two: [number, number][] = [[38.9, -77.0], [38.91, -77.01]];
    expect(smoothPath(two)).toEqual(two);
  });

  it("doubles the number of points per iteration (n → 2n) for n >= 3", () => {
    const three: [number, number][] = [[38.9, -77.0], [38.91, -77.01], [38.92, -77.02]];
    // 1 iteration: 2*3 = 6
    expect(smoothPath(three, 1)).toHaveLength(6);
    // 2 iterations: 2*6 = 12
    expect(smoothPath(three, 2)).toHaveLength(12);
  });

  it("preserves the start and end points exactly", () => {
    const pts: [number, number][] = [[38.9, -77.0], [38.95, -77.05], [39.0, -77.1]];
    const result = smoothPath(pts, 3);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("returns a valid path for a single point", () => {
    const one: [number, number][] = [[38.9, -77.0]];
    expect(smoothPath(one)).toEqual(one);
  });

  it("does not mutate the original array", () => {
    const pts: [number, number][] = [[38.9, -77.0], [38.95, -77.05], [39.0, -77.1]];
    const orig = JSON.stringify(pts);
    smoothPath(pts, 2);
    expect(JSON.stringify(pts)).toBe(orig);
  });
});

// ─── buildRoutePaths ──────────────────────────────────────────────────────────

describe("buildRoutePaths", () => {
  it("returns one path per route", () => {
    expect(buildRoutePaths([RED_ROUTE, SINGLE_SEG_ROUTE])).toHaveLength(2);
  });

  it("stitches two segments, removing the duplicate junction point", () => {
    const [path] = buildRoutePaths([RED_ROUTE]);
    // Segment 0: [38.90,-77.03],[38.91,-77.02] → 2 pts
    // Segment 1: [38.91,-77.02],[38.92,-77.01] → skip first (duplicate junction)
    // Total: 3 unique waypoints — exact OSM coordinates, no smoothing applied
    expect(path.waypoints).toHaveLength(3);
  });

  it("preserves all points in a single-segment route", () => {
    const [path] = buildRoutePaths([SINGLE_SEG_ROUTE]);
    expect(path.waypoints).toHaveLength(3);
  });

  it("sets totalDistance > 0 for a non-trivial route", () => {
    const [path] = buildRoutePaths([RED_ROUTE]);
    expect(path.totalDistance).toBeGreaterThan(0);
  });

  it("sets cumulative distances with first entry = 0", () => {
    const [path] = buildRoutePaths([RED_ROUTE]);
    expect(path.distances[0]).toBe(0);
    expect(path.distances).toHaveLength(path.waypoints.length);
  });

  it("distances are monotonically increasing", () => {
    const [path] = buildRoutePaths([SINGLE_SEG_ROUTE]);
    for (let i = 1; i < path.distances.length; i++) {
      expect(path.distances[i]).toBeGreaterThan(path.distances[i - 1]);
    }
  });

  it("empty segments produce empty waypoints", () => {
    const [path] = buildRoutePaths([EMPTY_ROUTE]);
    expect(path.waypoints).toHaveLength(0);
    expect(path.totalDistance).toBe(0);
  });

  it("initialises stops as empty array", () => {
    const [path] = buildRoutePaths([RED_ROUTE]);
    expect(path.stops).toEqual([]);
  });
});

// ─── mapStopsToRoute ──────────────────────────────────────────────────────────

describe("mapStopsToRoute", () => {
  const [redPath] = buildRoutePaths([RED_ROUTE]);

  it("attaches stations within proximity of the route path", () => {
    const enriched = mapStopsToRoute(redPath, [STATION_A, STATION_B, STATION_BLUE]);
    // STATION_A and STATION_B are within 350 m of a RED_ROUTE waypoint.
    // STATION_BLUE is ~5 km away — must be excluded.
    expect(enriched.stops).toHaveLength(2);
    expect(enriched.stops.map((s) => s.stationName)).toContain("Station A");
    expect(enriched.stops.map((s) => s.stationName)).toContain("Station B");
  });

  it("ignores stations farther than MAX_STATION_DIST_KM from the route", () => {
    const enriched = mapStopsToRoute(redPath, [STATION_BLUE]);
    expect(enriched.stops).toHaveLength(0);
  });

  it("matches regardless of station colour tag (proximity-only)", () => {
    // Station is geographically on the Red route but has a different colour —
    // should still be included because matching is proximity-based.
    const wrongColourStation: SubwayStation = {
      id: 200, name: "Colourless Station",
      lat: 38.9003, lng: -77.0297, // same position as STATION_A
      colours: ["#009CDE"], // Blue line colour — irrelevant for matching
    };
    const enriched = mapStopsToRoute(redPath, [wrongColourStation]);
    expect(enriched.stops).toHaveLength(1);
    expect(enriched.stops[0].stationName).toBe("Colourless Station");
  });

  it("stops are sorted by distanceAlong", () => {
    const enriched = mapStopsToRoute(redPath, [STATION_B, STATION_A]);
    for (let i = 1; i < enriched.stops.length; i++) {
      expect(enriched.stops[i].distanceAlong).toBeGreaterThanOrEqual(
        enriched.stops[i - 1].distanceAlong
      );
    }
  });

  it("returns path unchanged for empty stations list", () => {
    const enriched = mapStopsToRoute(redPath, []);
    expect(enriched.stops).toHaveLength(0);
  });
});

// ─── initTrains ───────────────────────────────────────────────────────────────

describe("initTrains", () => {
  const paths = buildRoutePaths([RED_ROUTE]);

  it("creates trainsPerRoute trains per route", () => {
    const trains = initTrains(paths, { ...DEFAULT_CONFIG, trainsPerRoute: 4 });
    expect(trains).toHaveLength(4);
  });

  it("assigns correct routeId and colour", () => {
    const trains = initTrains(paths, { ...DEFAULT_CONFIG, trainsPerRoute: 2 });
    expect(trains.every((t) => t.routeId === RED_ROUTE.id)).toBe(true);
    expect(trains.every((t) => t.routeColour === RED_ROUTE.colour)).toBe(true);
  });

  it("alternates direction between trains", () => {
    const trains = initTrains(paths, { ...DEFAULT_CONFIG, trainsPerRoute: 4 });
    expect(trains[0].direction).toBe(1);
    expect(trains[1].direction).toBe(-1);
    expect(trains[2].direction).toBe(1);
    expect(trains[3].direction).toBe(-1);
  });

  it("all trains start with status 'moving'", () => {
    const trains = initTrains(paths, DEFAULT_CONFIG);
    expect(trains.every((t) => t.status === "moving")).toBe(true);
  });

  it("skips routes with empty waypoints", () => {
    const emptyPaths = buildRoutePaths([EMPTY_ROUTE]);
    expect(initTrains(emptyPaths, DEFAULT_CONFIG)).toHaveLength(0);
  });
});

// ─── getTrainLatLng ───────────────────────────────────────────────────────────

describe("getTrainLatLng", () => {
  const [path] = buildRoutePaths([RED_ROUTE]);

  const makeTrain = (dist: number): TrainState => ({
    id: "t1", routeId: 1, routeRef: "RED", routeColour: "#BF0000",
    routeName: "Red Line", distanceTravelled: dist,
    direction: 1, status: "moving", currentStation: null,
    platform: "A", dwellRemaining: 0, partnerRouteId: null,
  });

  it("returns first waypoint when distanceTravelled=0", () => {
    const pos = getTrainLatLng(makeTrain(0), path);
    expect(pos[0]).toBeCloseTo(path.waypoints[0][0], 5);
    expect(pos[1]).toBeCloseTo(path.waypoints[0][1], 5);
  });

  it("returns last waypoint when distanceTravelled=totalDistance", () => {
    const pos = getTrainLatLng(makeTrain(path.totalDistance), path);
    const last = path.waypoints[path.waypoints.length - 1];
    expect(pos[0]).toBeCloseTo(last[0], 5);
    expect(pos[1]).toBeCloseTo(last[1], 5);
  });

  it("returns a midpoint between first and last waypoints for intermediate distance", () => {
    const mid = path.totalDistance / 2;
    const pos = getTrainLatLng(makeTrain(mid), path);
    expect(pos[0]).toBeGreaterThan(path.waypoints[0][0]);
    expect(pos[0]).toBeLessThan(path.waypoints[path.waypoints.length - 1][0]);
  });

  it("handles single-waypoint path without throwing", () => {
    const singlePath: RoutePath = {
      routeId: 99, routeRef: "X", routeColour: "#000", routeName: "X",
      waypoints: [[38.9, -77.0]], distances: [0], totalDistance: 0, stops: [],
    };
    expect(() => getTrainLatLng(makeTrain(0), singlePath)).not.toThrow();
  });
});

// ─── tickSimulation ───────────────────────────────────────────────────────────

describe("tickSimulation", () => {
  const [rawPath] = buildRoutePaths([RED_ROUTE]);
  const path = mapStopsToRoute(rawPath, [STATION_A, STATION_B]);
  const pathsMap = new Map([[RED_ROUTE.id, path]]);

  const movingTrain: TrainState = {
    id: "RED-1", routeId: RED_ROUTE.id, routeRef: "RED",
    routeColour: "#BF0000", routeName: "Red Line",
    distanceTravelled: 0.1, direction: 1,
    status: "moving", currentStation: null,
    platform: "A", dwellRemaining: 0, partnerRouteId: null, passengers: 0,
  };

  it("advances distanceTravelled for a moving train", () => {
    const cfg = { ...DEFAULT_CONFIG, speedKmPerMs: 0.01 };
    const [next] = tickSimulation([movingTrain], pathsMap, 10, cfg).trains;
    expect(next.distanceTravelled).toBeGreaterThan(movingTrain.distanceTravelled);
  });

  it("does not exceed totalDistance", () => {
    const farTrain: TrainState = { ...movingTrain, distanceTravelled: path.totalDistance - 0.001 };
    const cfg = { ...DEFAULT_CONFIG, speedKmPerMs: 1 };
    const [next] = tickSimulation([farTrain], pathsMap, 100, cfg).trains;
    expect(next.distanceTravelled).toBeLessThanOrEqual(path.totalDistance);
  });

  it("bounces direction at the end of the line", () => {
    const atEnd: TrainState = { ...movingTrain, distanceTravelled: path.totalDistance - 0.001, direction: 1 };
    const cfg = { ...DEFAULT_CONFIG, speedKmPerMs: 1 };
    const [next] = tickSimulation([atEnd], pathsMap, 100, cfg).trains;
    expect(next.direction).toBe(-1);
  });

  it("bounces direction at the start of the line", () => {
    const atStart: TrainState = { ...movingTrain, distanceTravelled: 0.001, direction: -1 };
    const cfg = { ...DEFAULT_CONFIG, speedKmPerMs: 1 };
    const [next] = tickSimulation([atStart], pathsMap, 100, cfg).trains;
    expect(next.direction).toBe(1);
  });

  it("counts down dwellRemaining for an at_station train", () => {
    const dwellingTrain: TrainState = {
      ...movingTrain,
      status: "at_station", currentStation: "Station A",
      dwellRemaining: 1000,
    };
    const [next] = tickSimulation([dwellingTrain], pathsMap, 200, DEFAULT_CONFIG).trains;
    expect(next.dwellRemaining).toBe(800);
    expect(next.status).toBe("at_station");
  });

  it("resumes moving after dwell expires", () => {
    const dwellingTrain: TrainState = {
      ...movingTrain,
      status: "at_station", currentStation: "Station A",
      dwellRemaining: 100,
    };
    const [next] = tickSimulation([dwellingTrain], pathsMap, 200, DEFAULT_CONFIG).trains;
    expect(next.status).toBe("moving");
    expect(next.currentStation).toBeNull();
    expect(next.dwellRemaining).toBe(0);
  });

  it("returns the same count of trains", () => {
    const trains = initTrains([path], { ...DEFAULT_CONFIG, trainsPerRoute: 3 });
    const result = tickSimulation(trains, pathsMap, 16, DEFAULT_CONFIG);
    expect(result.trains).toHaveLength(3);
  });
});

// ─── getTrainSegmentBearing ───────────────────────────────────────────────────

describe("getTrainSegmentBearing", () => {
  const makeTrain = (dist: number, dir: 1 | -1 = 1): TrainState => ({
    id: "t1", routeId: 1, routeRef: "RED", routeColour: "#BF0000",
    routeName: "Red Line", distanceTravelled: dist,
    direction: dir, status: "moving", currentStation: null,
    platform: "A", dwellRemaining: 0, partnerRouteId: null, passengers: 0,
  });

  it("returns 0 for a path with fewer than 2 waypoints", () => {
    const singlePath: RoutePath = {
      routeId: 1, routeRef: "X", routeColour: "#000", routeName: "X",
      waypoints: [[38.9, -77.0]], distances: [0], totalDistance: 0, stops: [],
    };
    expect(getTrainSegmentBearing(makeTrain(0), singlePath)).toBe(0);
  });

  it("returns ~0 (north) for a northward segment", () => {
    // Increasing lat, same lng = heading north
    const northPath: RoutePath = {
      routeId: 1, routeRef: "X", routeColour: "#000", routeName: "X",
      waypoints: [[38.9, -77.0], [39.0, -77.0]],
      distances: [0, haversineKm([38.9, -77.0], [39.0, -77.0])],
      totalDistance: haversineKm([38.9, -77.0], [39.0, -77.0]),
      stops: [],
    };
    const bearing = getTrainSegmentBearing(makeTrain(0), northPath);
    // North ≈ 0 radians (small ±ε from floating point is fine)
    expect(Math.abs(bearing)).toBeLessThan(0.01);
  });

  it("returns ~π/2 (east) for an eastward segment", () => {
    // Same lat, increasing lng (less negative) = heading east
    const eastPath: RoutePath = {
      routeId: 1, routeRef: "X", routeColour: "#000", routeName: "X",
      waypoints: [[38.9, -77.0], [38.9, -76.0]],
      distances: [0, haversineKm([38.9, -77.0], [38.9, -76.0])],
      totalDistance: haversineKm([38.9, -77.0], [38.9, -76.0]),
      stops: [],
    };
    const bearing = getTrainSegmentBearing(makeTrain(0), eastPath);
    // Great-circle bearing at 38.9°N is close to π/2 but not exact due to spherical geometry
    expect(bearing).toBeCloseTo(Math.PI / 2, 1);
  });

  it("flips bearing by π for direction=-1", () => {
    const [path] = buildRoutePaths([RED_ROUTE]);
    const fwd = getTrainSegmentBearing(makeTrain(0, 1), path);
    const bwd = getTrainSegmentBearing(makeTrain(0, -1), path);
    // Difference should be ±π (mod 2π)
    const diff = Math.abs(fwd - bwd) % (2 * Math.PI);
    expect(Math.min(diff, 2 * Math.PI - diff)).toBeCloseTo(Math.PI, 2);
  });

  it("returns a finite number for all positions along a real route", () => {
    const [path] = buildRoutePaths([RED_ROUTE]);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const dist = (path.totalDistance / steps) * i;
      const bearing = getTrainSegmentBearing(makeTrain(dist), path);
      expect(isFinite(bearing)).toBe(true);
    }
  });
});

// ─── detectPathGaps ───────────────────────────────────────────────────────────

describe("detectPathGaps", () => {
  const makeSimplePath = (waypoints: [number, number][]): RoutePath => {
    const distances: number[] = [0];
    for (let i = 1; i < waypoints.length; i++) {
      distances.push(distances[i - 1] + haversineKm(waypoints[i - 1], waypoints[i]));
    }
    return {
      routeId: 1, routeRef: "X", routeColour: "#000", routeName: "X",
      waypoints, distances, totalDistance: distances[distances.length - 1] ?? 0, stops: [],
    };
  };

  it("returns empty array when path has no jumps", () => {
    // Steps of 0.001° ≈ 110 m — well below the 0.3 km threshold
    const path = makeSimplePath([
      [38.900, -77.030],
      [38.901, -77.029],
      [38.902, -77.028],
    ]);
    expect(detectPathGaps(path)).toHaveLength(0);
  });

  it("detects a large jump between two waypoints", () => {
    // Place two points ~10 km apart (well above the 0.3 km threshold)
    const path = makeSimplePath([
      [38.90, -77.03],
      [39.00, -77.10], // ~11 km jump
    ]);
    const gaps = detectPathGaps(path);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].distanceKm).toBeGreaterThan(0.3);
  });

  it("does not report a gap below the threshold", () => {
    // Two consecutive waypoints ~0.15 km apart (below 0.3 km default threshold)
    const path = makeSimplePath([
      [38.90, -77.030],
      [38.901, -77.029], // ~0.13 km
    ]);
    expect(detectPathGaps(path, 0.3)).toHaveLength(0);
  });

  it("uses a custom threshold", () => {
    // Two points ~0.15 km apart — below default but above a 0.1 km custom threshold
    const path = makeSimplePath([
      [38.90, -77.030],
      [38.901, -77.029],
    ]);
    expect(detectPathGaps(path, 0.1)).toHaveLength(1);
  });

  it("reports the correct midpoint lat/lng", () => {
    const a: [number, number] = [38.90, -77.03];
    const b: [number, number] = [39.00, -77.10];
    const path = makeSimplePath([a, b]);
    const [gap] = detectPathGaps(path);
    expect(gap.lat).toBeCloseTo((a[0] + b[0]) / 2, 5);
    expect(gap.lng).toBeCloseTo((a[1] + b[1]) / 2, 5);
  });

  it("reports correct fromIdx and toIdx", () => {
    // First step ≈ 0.14 km (no gap); second step ≈ 11 km (gap)
    const path = makeSimplePath([
      [38.900, -77.030],  // idx 0
      [38.901, -77.029],  // idx 1 — ~0.14 km, no gap
      [39.000, -77.100],  // idx 2 — ~11 km jump from idx 1
    ]);
    const gaps = detectPathGaps(path);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].fromIdx).toBe(1);
    expect(gaps[0].toIdx).toBe(2);
  });

  it("returns empty for a path with a single waypoint", () => {
    const path = makeSimplePath([[38.9, -77.0]]);
    expect(detectPathGaps(path)).toHaveLength(0);
  });
});

// ─── mapStopsToRoute — proximity boundary ─────────────────────────────────────

describe("mapStopsToRoute (proximity boundary)", () => {
  const [redPath] = buildRoutePaths([RED_ROUTE]);

  it("includes a station just inside MAX_STATION_DIST_KM (≤350 m)", () => {
    // ~300 m from waypoint [38.90, -77.03]: well within threshold
    const nearStation: SubwayStation = {
      id: 200, name: "Near Station",
      lat: 38.9027, lng: -77.0300, // Δlat~300m, Δlng=0
      colours: [],
    };
    const enriched = mapStopsToRoute(redPath, [nearStation]);
    expect(enriched.stops).toHaveLength(1);
  });

  it("excludes a station just outside MAX_STATION_DIST_KM (>350 m)", () => {
    // ~560 m from nearest waypoint — beyond 350 m threshold
    const farStation: SubwayStation = {
      id: 201, name: "Far Station",
      lat: 38.905, lng: -77.025, // midpoint between waypoints, ~700m from each
      colours: [],
    };
    const enriched = mapStopsToRoute(redPath, [farStation]);
    expect(enriched.stops).toHaveLength(0);
  });

  it("includes a station with no colour tag if it is geographically close", () => {
    // station=subway nodes fetched from OSM may have no colours
    const noColourStation: SubwayStation = {
      id: 202, name: "No Colour Station",
      lat: 38.9202, lng: -77.0098, // ~30 m from waypoint [38.92, -77.01]
      colours: [],
    };
    const enriched = mapStopsToRoute(redPath, [noColourStation]);
    expect(enriched.stops).toHaveLength(1);
  });
});
