import type { SubwayRoute } from "@/lib/overpass";
import type { SubwayStation } from "@/lib/overpass";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoutePath {
  routeId: number;
  routeRef: string;
  routeColour: string;
  routeName: string;
  /** Flat stitched path: all route segments concatenated into one [lat,lng][] */
  waypoints: [number, number][];
  /** Cumulative distance in km at each waypoint index */
  distances: number[];
  totalDistance: number;
  /** Ordered station stops along this route */
  stops: RouteStop[];
}

export interface RouteStop {
  stationName: string;
  /** Index into waypoints[] of the closest point to this station */
  waypointIndex: number;
  /** km from route start */
  distanceAlong: number;
}

export interface PathGap {
  /** Waypoint index where the jump starts */
  fromIdx: number;
  /** Waypoint index where the jump ends */
  toIdx: number;
  /** Midpoint lat — used to place a map marker */
  lat: number;
  /** Midpoint lng — used to place a map marker */
  lng: number;
  /** Great-circle distance of the jump in km */
  distanceKm: number;
}

/**
 * Scan a stitched RoutePath for "jumps" — consecutive waypoints whose
 * great-circle distance exceeds `thresholdKm`.
 *
 * A jump indicates that the stitcher connected two segments that are not
 * actually adjacent on the track, producing a straight line across the map.
 * The default threshold of 0.3 km (300 m) is conservative enough to catch all
 * real jumps without triggering on legitimately long straight stretches.
 */
export function detectPathGaps(
  path: RoutePath,
  thresholdKm = 0.3
): PathGap[] {
  const gaps: PathGap[] = [];
  for (let i = 0; i + 1 < path.waypoints.length; i++) {
    const a = path.waypoints[i];
    const b = path.waypoints[i + 1];
    const d = haversineKm(a, b);
    if (d > thresholdKm) {
      gaps.push({
        fromIdx: i,
        toIdx: i + 1,
        lat: (a[0] + b[0]) / 2,
        lng: (a[1] + b[1]) / 2,
        distanceKm: d,
      });
    }
  }
  return gaps;
}

export type TrainStatus = "moving" | "at_station";
export type TrainDirection = 1 | -1;
export type Platform = "A" | "B";

export interface TrainState {
  id: string;
  routeId: number;
  routeRef: string;
  routeColour: string;
  routeName: string;
  /** km along route path (0..totalDistance) */
  distanceTravelled: number;
  /** 1 = towards end of path, -1 = towards start (only used for unpaired routes) */
  direction: TrainDirection;
  status: TrainStatus;
  /** Station name when status is 'at_station', null otherwise */
  currentStation: string | null;
  /** A = inbound (direction +1), B = outbound (direction -1) */
  platform: Platform;
  /** ms of dwell time remaining at station (0 when moving) */
  dwellRemaining: number;
  /**
   * ID of the paired route relation travelling in the opposite direction.
   * When a train reaches the terminus it switches to this route at position 0,
   * so it always travels forward (direction=1) on the physically correct track.
   * null for routes with no directional pair (falls back to in-path bouncing).
   */
  partnerRouteId: number | null;
  /** Current number of passengers aboard (0..1050) */
  passengers: number;
}

/** Current passenger state for one station */
export interface StationPassengerState {
  capacity: number;
  current: number;
}

/** Result returned by tickSimulation */
export interface TickResult {
  trains: TrainState[];
  /** Net passenger delta per station this tick (positive = more passengers waiting) */
  stationDeltas: Map<string, number>;
}

export interface SimulationConfig {
  trainsPerRoute: number;
  /** km per ms — at 0.04 a 30 km line takes ~12.5 min simulated */
  speedKmPerMs: number;
  /** ms train waits at a regular mid-route station (max 1 min) */
  dwellMs: number;
  /** ms train waits at a terminus station — first or last stop (max 5 min) */
  dwellTerminusMs: number;
  /** km — train triggers "at_station" when within this distance */
  stationRadiusKm: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  trainsPerRoute: 6,
  // DC Metro top speed ≈ 88 km/h → 88/3600/1000 km/ms ≈ 0.0000244
  speedKmPerMs: 0.0000244,
  // Regular station dwell: up to 1 minute
  dwellMs: 60_000,
  // Terminus station dwell: up to 5 minutes
  dwellTerminusMs: 300_000,
  // Snap to station when within 150 m
  stationRadiusKm: 0.15,
};

// ─── Geometry helpers ─────────────────────────────────────────────────────────

const RAD = Math.PI / 180;
const EARTH_KM = 6371;

/** Haversine great-circle distance in km */
export function haversineKm(
  a: [number, number],
  b: [number, number]
): number {
  const dLat = (b[0] - a[0]) * RAD;
  const dLng = (b[1] - a[1]) * RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * sinLng * sinLng;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// ─── Path smoothing ───────────────────────────────────────────────────────────

/**
 * One pass of Chaikin's corner-cutting algorithm.
 * Replaces each interior pair with two points at 1/4 and 3/4 of the segment,
 * rounding off sharp angles while preserving the start and end exactly.
 */
function chaikinIterate(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]]; // keep start
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
    out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  out.push(pts[pts.length - 1]); // keep end
  return out;
}

/**
 * Smooth a geographic polyline with Chaikin's corner-cutting algorithm.
 * Applied to both the visual track (SubwayLayer) and the simulation path
 * so trains are always positioned on the exact rendered line.
 *
 * @param pts      Array of [lat, lng] waypoints
 * @param iterations  Number of smoothing passes (2 is typically sufficient)
 */
export function smoothPath(
  pts: [number, number][],
  iterations = 2
): [number, number][] {
  let result = pts;
  for (let i = 0; i < iterations; i++) result = chaikinIterate(result);
  return result;
}

// ─── Path building ────────────────────────────────────────────────────────────

/**
 * Topology-based segment stitcher: builds an endpoint graph and walks the chain.
 *
 * DC Metro lines are simple open paths — no loops, no branches within a single
 * route relation. Trains run from one terminus to the other and back. This means
 * the OSM way-members of each route relation form a linear chain where:
 *   • every interior node (shared endpoint) has degree 2 (connects two segments)
 *   • the two terminus nodes have degree 1 (dead ends)
 *
 * By building an actual endpoint graph we can walk this chain exactly — no
 * distance-based guessing, no threshold parameters, zero risk of a long jump.
 *
 * Algorithm:
 *  1. Quantize each segment's start/end coordinate to a ~5 m grid so that OSM
 *     ways sharing a node (which store identical lat/lon) collapse to the same
 *     graph node.  Truly distinct endpoints remain separate.
 *  2. Build an adjacency map: node → list of edges (segIdx, direction, farNode).
 *  3. BFS on the node graph to find connected components; keep only the largest
 *     (the main track chain).  Any isolated spur/platform that does not touch the
 *     main track is dropped automatically.
 *  4. Find the terminus: the node with the fewest edges (ideally 1).
 *  5. Walk the chain from the terminus.  At every node there is normally only one
 *     unvisited edge to follow.  At the rare branch node (degree > 2, from a spur
 *     or maintenance track that shares a junction with the main line), prefer the
 *     edge whose far node has static degree > 1 — i.e. leads further along the
 *     main track rather than into a dead-end spur.
 *  6. Collect waypoints as we traverse, dropping the duplicate junction point
 *     between consecutive segments.
 */
export function stitchSegments(
  segments: [number, number][][]
): [number, number][] {
  if (segments.length === 0) return [];

  // Deep-copy so we never mutate the stored route data
  const pool: [number, number][][] = segments.map((s) =>
    s.map((p) => [p[0], p[1]] as [number, number])
  );

  if (pool.length === 1) return pool[0];

  // ── Step 1: build endpoint graph ─────────────────────────────────────────
  // Quantize to 0.00005° ≈ 5.5 m at DC latitude (38.9° N).
  // OSM ways that share a node carry the exact same float coordinates, so they
  // always land in the same cell.  Parallel track beds and station approaches
  // that are further than ~5 m away land in different cells and stay separate.
  const Q = 5e-5;
  const nodeKey = (p: [number, number]) =>
    `${Math.round(p[0] / Q)},${Math.round(p[1] / Q)}`;

  type Edge = { segIdx: number; reverse: boolean; farKey: string };
  const adj = new Map<string, Edge[]>();
  const touch = (k: string) => { if (!adj.has(k)) adj.set(k, []); };

  for (let i = 0; i < pool.length; i++) {
    const seg = pool[i];
    const sk  = nodeKey(seg[0]);
    const ek  = nodeKey(seg[seg.length - 1]);
    touch(sk); touch(ek);
    if (sk === ek) continue; // degenerate zero-length loop — skip
    adj.get(sk)!.push({ segIdx: i, reverse: false, farKey: ek });
    adj.get(ek)!.push({ segIdx: i, reverse: true,  farKey: sk });
  }

  // ── Step 2: largest connected component (BFS on nodes) ───────────────────
  const visitedNodes = new Set<string>();
  let bestComp = new Set<string>();

  for (const start of adj.keys()) {
    if (visitedNodes.has(start)) continue;
    const comp = new Set([start]);
    const q: string[] = [start];
    let qi = 0;
    while (qi < q.length) {
      for (const e of adj.get(q[qi++]) ?? []) {
        if (!comp.has(e.farKey)) { comp.add(e.farKey); q.push(e.farKey); }
      }
    }
    for (const n of comp) visitedNodes.add(n);
    if (comp.size > bestComp.size) bestComp = comp;
  }

  // Restrict adjacency to the main component; count dropped segments
  let keptSegs = 0;
  for (const [k, edges] of adj) {
    if (!bestComp.has(k)) { adj.delete(k); continue; }
    const filtered = edges.filter(e => bestComp.has(e.farKey));
    adj.set(k, filtered);
    keptSegs += filtered.length;
  }
  keptSegs = keptSegs / 2; // each segment appears as two directed edges
  if (keptSegs < pool.length && typeof console !== "undefined") {
    console.warn(
      `[stitchSegments] dropped ${pool.length - Math.round(keptSegs)} orphaned segment(s) not connected to the main track chain`
    );
  }

  // ── Step 3: terminus node (minimum degree) ───────────────────────────────
  // For a pure linear chain the terminus has degree 1.
  // Static degree = number of edges in the original (full) graph — used later
  // to detect spur tips (degree 1 mid-route) vs through-nodes (degree ≥ 2).
  const staticDegree = new Map<string, number>();
  let startNode = '';
  let minDeg = Infinity;
  for (const [k, edges] of adj) {
    staticDegree.set(k, edges.length);
    if (edges.length < minDeg) { minDeg = edges.length; startNode = k; }
  }

  // ── Step 4: chain walk ────────────────────────────────────────────────────
  // At each node there is usually only one unvisited edge.  At a branch node
  // (spur junction, static degree ≥ 3) there may be two: the main-line
  // continuation and a spur.  We prefer the edge whose far node has static
  // degree > 1 (a through-node leading further along the main track) over the
  // edge whose far node has degree 1 (spur tip — a dead end).
  const usedSegs = new Set<number>();
  const result: [number, number][] = [];
  let cur = startNode;

  while (true) {
    const available = (adj.get(cur) ?? []).filter(e => !usedSegs.has(e.segIdx));
    if (available.length === 0) break;

    let chosen = available[0];
    if (available.length > 1) {
      // Prefer an edge that leads to a through-node (not a spur dead end)
      const through = available.filter(
        e => (staticDegree.get(e.farKey) ?? 0) > 1
      );
      if (through.length > 0) chosen = through[0];
    }

    const seg = [...pool[chosen.segIdx]];
    if (chosen.reverse) seg.reverse();
    usedSegs.add(chosen.segIdx);

    // First segment: include all points.
    // Subsequent segments: drop the first point — it is the junction shared
    // with the previous segment's last point (already in result).
    if (result.length === 0) {
      result.push(...seg);
    } else {
      result.push(...seg.slice(1));
    }

    cur = chosen.farKey;
  }

  return result;
}

export function buildRoutePaths(routes: SubwayRoute[]): RoutePath[] {
  return routes.map((route) => {
    // Stitch unordered OSM way-members into a continuous path.
    // We use the raw stitched coordinates (no Chaikin smoothing) so that train
    // positions are derived from the exact same lat/lng points that OSM stores.
    // SubwayLayer renders the original OSM segments directly, so keeping the
    // simulation on the same coordinate set guarantees trains are on the track.
    const waypoints = stitchSegments(route.segments);

    const distances: number[] = [0];
    for (let i = 1; i < waypoints.length; i++) {
      distances.push(distances[i - 1] + haversineKm(waypoints[i - 1], waypoints[i]));
    }

    return {
      routeId: route.id,
      routeRef: route.ref,
      routeColour: route.colour,
      routeName: route.name,
      waypoints,
      distances,
      totalDistance: distances[distances.length - 1] ?? 0,
      stops: [],
    };
  });
}

/**
 * Maximum distance (km) from a station node to the nearest route waypoint
 * for the station to be considered on that route.
 *
 * 0.35 km (350 m) is generous enough to account for:
 *   • Surface station nodes (station=subway tag) that sit at the street-level
 *     entrance while route waypoints follow the underground track centreline.
 *   • Minor coordinate offsets between OSM node positions and track geometry.
 *
 * DC Metro lines run in geographically distinct corridors, so false positives
 * are not a concern — except on shared track segments where including the
 * station on all sharing lines is the correct behaviour.
 */
const MAX_STATION_DIST_KM = 0.35;

/**
 * Populate `stops` on each RoutePath by finding every station whose nearest
 * waypoint is within MAX_STATION_DIST_KM of the route path.
 *
 * Previously used colour-tag matching, which silently dropped stations when:
 *   • Route relations stored stops as nested stop_area sub-relations or way
 *     members rather than bare "stop"-role node members (Orange, Blue lines).
 *   • OSM colour tags were inconsistent between station nodes and route relations.
 *
 * Proximity-only matching is more robust: a station belongs to a route if and
 * only if it lies physically close to the route's stitched waypoint path.
 */
export function mapStopsToRoute(
  path: RoutePath,
  stations: SubwayStation[]
): RoutePath {
  if (path.waypoints.length === 0) return path;

  const stops: RouteStop[] = [];

  for (const station of stations) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < path.waypoints.length; i++) {
      const d = haversineKm(path.waypoints[i], [station.lat, station.lng]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    // Only include this station if it lies on (or very near) this route's path
    if (bestDist > MAX_STATION_DIST_KM) continue;

    // Skip stations whose line data explicitly excludes this route.
    // Stations with empty colours (no OSM line data) fall through to proximity-only matching.
    if (station.colours.length > 0 && !station.colours.includes(path.routeColour)) continue;

    stops.push({
      stationName: station.name,
      waypointIndex: bestIdx,
      distanceAlong: path.distances[bestIdx],
    });
  }

  // Sort by position along the route
  stops.sort((a, b) => a.distanceAlong - b.distanceAlong);

  return { ...path, stops };
}

// ─── Train initialisation ─────────────────────────────────────────────────────

/**
 * Spawn `config.trainsPerRoute` trains per route, evenly spaced along the path.
 *
 * For routes that have a directional pair (routePairs lookup):
 *   - All trains start with direction=1 (always forward on this directional track).
 *   - partnerRouteId is set so trains transition to the return route at the terminus
 *     instead of reversing on the same track.
 *
 * For unpaired routes (no partner in routePairs):
 *   - Trains alternate direction as before (half forward, half reverse).
 *   - partnerRouteId is null; trains bounce at the terminus.
 */
export function initTrains(
  paths: RoutePath[],
  config: SimulationConfig = DEFAULT_CONFIG,
  routePairs: Map<number, number> = new Map()
): TrainState[] {
  const trains: TrainState[] = [];

  for (const path of paths) {
    if (path.waypoints.length === 0 || path.totalDistance === 0) continue;

    const partnerRouteId = routePairs.get(path.routeId) ?? null;

    for (let i = 0; i < config.trainsPerRoute; i++) {
      // Paired routes: spread trains evenly along the full route so they appear
      // distributed across the map immediately (not stacked at position 0).
      // All paired trains travel forward (dir +1) and transfer to the partner
      // route at the terminus.
      // Unpaired routes: alternate — even index at terminus A (pos 0, dir +1),
      //                              odd  index at terminus B (pos max, dir -1).
      const direction: TrainDirection =
        partnerRouteId !== null ? 1 : i % 2 === 0 ? 1 : -1;
      const distanceTravelled = partnerRouteId !== null
        ? (i / config.trainsPerRoute) * path.totalDistance
        : i % 2 === 0 ? 0 : path.totalDistance;

      trains.push({
        id: `${path.routeId}-${i + 1}`,
        routeId: path.routeId,
        routeRef: path.routeRef,
        routeColour: path.routeColour,
        routeName: path.routeName,
        distanceTravelled,
        direction,
        status: "moving",
        currentStation: null,
        platform: direction === 1 ? "A" : "B",
        dwellRemaining: 0,
        partnerRouteId,
        passengers: 0,
      });
    }
  }

  return trains;
}

// ─── Position interpolation ───────────────────────────────────────────────────

/**
 * Given a train's distanceTravelled, interpolate its [lat,lng] position
 * along the route path using binary search + linear interpolation.
 */
export function getTrainLatLng(
  train: TrainState,
  path: RoutePath
): [number, number] {
  const { waypoints, distances, totalDistance } = path;

  if (waypoints.length === 0) return [0, 0];
  if (waypoints.length === 1) return waypoints[0];

  const clamped = Math.max(0, Math.min(train.distanceTravelled, totalDistance));

  // Binary search for the segment
  let lo = 0;
  let hi = distances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] <= clamped) lo = mid;
    else hi = mid;
  }

  const segLen = distances[hi] - distances[lo];
  if (segLen === 0) return waypoints[lo];

  const t = (clamped - distances[lo]) / segLen;
  const a = waypoints[lo];
  const b = waypoints[hi];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// ─── Station approach + headway constants ─────────────────────────────────────

/** km before a station where the train begins decelerating. */
const SLOW_ZONE_KM = 0.25;
/** Minimum speed factor (fraction of full speed) inside the slow zone. */
const MIN_SPEED_FACTOR = 0.08;
/** km within which the train is considered to have arrived at a station. */
const AT_STATION_KM = 0.010;
/**
 * Minimum safe following distance on the same route in the same direction.
 * Below this gap the following train decelerates proportionally to zero.
 */
const MIN_HEADWAY_KM = 0.15;
/**
 * Hard-stop gap: if the following train is this close to the leader it
 * stops completely (prevents creeping into an occupied station platform).
 */
const HARD_STOP_KM = 0.020;

// ─── Multi-level station groups ───────────────────────────────────────────────
//
// These four WMATA stations have physically separate platforms on two levels.
// Trains from different level groups must NOT block each other — a Red Line
// train at Metro Center (level 0) and a Blue Line train (level 1) occupy
// independent platforms and should be tracked with separate occupancy keys.
//
// Format: stationName → [[routeRefs on level 0], [routeRefs on level 1]]
const MULTI_LEVEL_GROUPS = new Map<string, string[][]>([
  ["Metro Center",            [["RD"],             ["BL", "OR", "SV"]]],
  ["Gallery Place-Chinatown", [["RD"],             ["GR", "YL"]]],
  ["L'Enfant Plaza",          [["BL", "OR", "SV"], ["GR", "YL"]]],
  ["Fort Totten",             [["RD"],             ["GR", "YL"]]],
]);

/** Returns the station occupancy map key, incorporating level for multi-level stations. */
function stationKey(stationName: string, routeRef: string, direction: number): string {
  const groups = MULTI_LEVEL_GROUPS.get(stationName);
  if (groups) {
    const level = groups.findIndex((g) => g.includes(routeRef));
    return `${stationName}:${level >= 0 ? level : 0}:${direction}`;
  }
  return `${stationName}:${direction}`;
}

// ─── Simulation tick ──────────────────────────────────────────────────────────

/**
 * Advance the simulation by `dt` ms. Returns a new TrainState[] (immutable).
 *
 * Rules enforced each tick:
 *
 * 1. Station capacity = 1 per direction.
 *    Only one train may occupy a given station in a given direction of travel.
 *    An approaching train that would enter an occupied platform waits outside.
 *
 * 2. No overtaking on the same route.
 *    Trains on the same (routeId, direction) track maintain at least
 *    MIN_HEADWAY_KM behind the train directly ahead.  Speed is reduced
 *    proportionally as the gap shrinks; the train stops completely when
 *    within HARD_STOP_KM.
 *
 * 3. Smooth station approach.
 *    Within SLOW_ZONE_KM of the next stop the train decelerates linearly.
 *    Arrival is triggered when within AT_STATION_KM (10 m) of the platform.
 */
const TRAIN_CAPACITY = 1050; // 6 cars × 175 passengers

export function tickSimulation(
  trains: TrainState[],
  pathsMap: Map<number, RoutePath>,
  dt: number,
  config: SimulationConfig = DEFAULT_CONFIG,
  stationPassengers: Map<string, StationPassengerState> = new Map(),
  surgeMultipliers: Map<string, number> = new Map()
): TickResult {
  // ── Station passenger accumulation deltas ──────────────────────────────────
  const stationDeltas = new Map<string, number>();

  for (const [name, sp] of stationPassengers) {
    const multiplier = surgeMultipliers.get(name) ?? 1;
    // Accumulation rate: capacity * 0.0005 passengers/second * multiplier
    // Slower build-up — stations fill over 30+ minutes naturally
    const delta = sp.capacity * 0.0005 * multiplier * (dt / 1000);
    stationDeltas.set(name, delta);
  }

  // ── Pre-compute indices (built from the PREVIOUS frame's state) ────────────

  // Position index for no-overtaking:
  //   key = "routeId:direction"  →  sorted array of { id, distanceTravelled }
  type PosEntry = { id: string; distanceTravelled: number };
  const posIndex = new Map<string, PosEntry[]>();

  // Station-occupancy index for station-capacity rule:
  //   key = "stationName:direction"  →  true when a train is at_station there
  //   direction is +1 or -1 as a string so trains going opposite ways at the
  //   same physical station use separate slots (they are on different platforms).
  const stationOccupied = new Map<string, boolean>();

  for (const t of trains) {
    const posKey = `${t.routeId}:${t.direction}`;
    const list   = posIndex.get(posKey) ?? [];
    list.push({ id: t.id, distanceTravelled: t.distanceTravelled });
    posIndex.set(posKey, list);

    if (t.status === "at_station" && t.currentStation) {
      stationOccupied.set(stationKey(t.currentStation, t.routeRef, t.direction), true);
    }
  }
  for (const list of posIndex.values()) {
    list.sort((a, b) => a.distanceTravelled - b.distanceTravelled);
  }

  // ── Per-train tick ─────────────────────────────────────────────────────────
  const newTrains = trains.map((train): TrainState => {
    const path = pathsMap.get(train.routeId);
    if (!path || path.waypoints.length === 0) return train;

    // ── Dwell countdown ───────────────────────────────────────────────────────
    if (train.status === "at_station") {
      const remaining = train.dwellRemaining - dt;
      if (remaining > 0) return { ...train, dwellRemaining: remaining };
      // Departing — passengers alight (30% leave)
      const alighting = Math.floor(train.passengers * 0.30);
      return {
        ...train,
        passengers:     Math.max(0, train.passengers - alighting),
        status:         "moving" as TrainStatus,
        currentStation: null,
        dwellRemaining: 0,
        platform:       train.direction === 1 ? "A" : "B",
      };
    }

    // ── Next stop (strictly ahead — eliminates re-snap) ───────────────────────
    const nextStop = findNextStop(path.stops, train.distanceTravelled, train.direction);

    // ── Gap to leading train on the same route/direction ──────────────────────
    const posKey    = `${train.routeId}:${train.direction}`;
    const positions = posIndex.get(posKey) ?? [];
    let gapToLeader = Infinity;

    if (train.direction === 1) {
      const leader = positions.find(
        (p) => p.id !== train.id && p.distanceTravelled > train.distanceTravelled
      );
      if (leader) gapToLeader = leader.distanceTravelled - train.distanceTravelled;
    } else {
      for (let i = positions.length - 1; i >= 0; i--) {
        const p = positions[i];
        if (p.id !== train.id && p.distanceTravelled < train.distanceTravelled) {
          gapToLeader = train.distanceTravelled - p.distanceTravelled;
          break;
        }
      }
    }

    // ── Effective speed (station deceleration + headway constraint) ────────────
    let effectiveSpeed = config.speedKmPerMs;

    // 1. Decelerate smoothly approaching the next station
    if (nextStop) {
      const distToStop = train.direction === 1
        ? nextStop.distanceAlong - train.distanceTravelled
        : train.distanceTravelled - nextStop.distanceAlong;
      if (distToStop >= 0 && distToStop < SLOW_ZONE_KM) {
        effectiveSpeed = config.speedKmPerMs *
          Math.max(distToStop / SLOW_ZONE_KM, MIN_SPEED_FACTOR);
      }
    }

    // 2. No-overtaking: reduce speed when closing on the train ahead
    if (gapToLeader <= MIN_HEADWAY_KM) {
      if (gapToLeader <= HARD_STOP_KM) {
        effectiveSpeed = 0; // full stop — too close
      } else {
        // Proportional slow-down: zero speed at HARD_STOP_KM, full at MIN_HEADWAY_KM
        const headwayFactor =
          (gapToLeader - HARD_STOP_KM) / (MIN_HEADWAY_KM - HARD_STOP_KM);
        effectiveSpeed = Math.min(effectiveSpeed, config.speedKmPerMs * headwayFactor);
      }
    }

    // ── Move ──────────────────────────────────────────────────────────────────
    let dist = train.distanceTravelled + train.direction * effectiveSpeed * dt;
    let dir: TrainDirection  = train.direction;

    // ── Terminus: transition to partner route, or bounce ──────────────────────
    if (dist >= path.totalDistance) {
      const partnerPath = train.partnerRouteId !== null
        ? pathsMap.get(train.partnerRouteId)
        : undefined;

      if (partnerPath) {
        const myEnd        = path.waypoints[path.waypoints.length - 1];
        const partnerFirst = partnerPath.waypoints[0];
        const partnerLast  = partnerPath.waypoints[partnerPath.waypoints.length - 1];
        const fromStart    = haversineKm(myEnd, partnerFirst) <= haversineKm(myEnd, partnerLast);

        return {
          ...train,
          routeId:           train.partnerRouteId!,
          partnerRouteId:    train.routeId,
          routeRef:          partnerPath.routeRef,
          routeColour:       partnerPath.routeColour,
          routeName:         partnerPath.routeName,
          distanceTravelled: fromStart ? 0 : partnerPath.totalDistance,
          direction:         (fromStart ? 1 : -1) as TrainDirection,
          status:            "moving" as TrainStatus,
          currentStation:    null,
          dwellRemaining:    0,
          platform:          fromStart ? "A" : "B",
        };
      }
      dist = path.totalDistance;
      dir  = -1;
    } else if (dist <= 0) {
      dist = 0;
      dir  = 1;
    }

    // ── Station arrival (with capacity guard) ─────────────────────────────────
    if (nextStop && Math.abs(dist - nextStop.distanceAlong) <= AT_STATION_KM) {
      const occupancyKey = stationKey(nextStop.stationName, train.routeRef, dir);

      // If the platform is already occupied by a train going the same direction,
      // hold position — don't enter.  The train is already near-zero speed from
      // the slow-zone + headway deceleration, so holding looks natural.
      if (stationOccupied.get(occupancyKey)) {
        return { ...train }; // freeze at current position
      }

      const stopIndex  = path.stops.indexOf(nextStop);
      const isTerminus = stopIndex === 0 || stopIndex === path.stops.length - 1;

      // Boarding: pick up passengers waiting at this station
      const sp = stationPassengers.get(nextStop.stationName);
      const boarding = sp
        ? Math.min(Math.floor(sp.current), TRAIN_CAPACITY - train.passengers)
        : 0;
      if (boarding > 0) {
        // Record that passengers are boarding (negative delta = fewer waiting)
        stationDeltas.set(
          nextStop.stationName,
          (stationDeltas.get(nextStop.stationName) ?? 0) - boarding
        );
      }

      return {
        ...train,
        passengers:        Math.min(TRAIN_CAPACITY, train.passengers + boarding),
        distanceTravelled: nextStop.distanceAlong,
        direction:         dir,
        status:            "at_station" as TrainStatus,
        currentStation:    nextStop.stationName,
        platform:          dir === 1 ? "A" : "B",
        dwellRemaining:    isTerminus ? config.dwellTerminusMs : config.dwellMs,
      };
    }

    return {
      ...train,
      distanceTravelled: dist,
      direction:         dir,
      platform:          dir === 1 ? "A" : "B",
    };
  });

  return { trains: newTrains, stationDeltas };
}

/**
 * Returns the bearing (radians, 0 = North = up, clockwise positive) of the
 * waypoint segment the train is currently on.
 *
 * Uses the great-circle initial bearing between the two endpoints of the
 * segment. This is perfectly stable per segment — no frame-to-frame
 * numerical noise from pixel projection.
 *
 * For trains travelling in direction=-1 the bearing is flipped 180° so the
 * rectangle always points in the direction of travel.
 */
export function getTrainSegmentBearing(
  train: TrainState,
  path: RoutePath
): number {
  const { waypoints, distances } = path;
  if (waypoints.length < 2) return 0;

  const clamped = Math.max(0, Math.min(train.distanceTravelled, path.totalDistance));

  // Binary search for the segment the train is on
  let lo = 0;
  let hi = distances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] <= clamped) lo = mid;
    else hi = mid;
  }

  const a = waypoints[lo];
  const b = waypoints[Math.min(hi, waypoints.length - 1)];

  // Great-circle initial bearing (0 = North, π/2 = East, clockwise, radians)
  const dLng = (b[1] - a[1]) * RAD;
  const lat1  = a[0] * RAD;
  const lat2  = b[0] * RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  let bearing = Math.atan2(y, x);

  // Reverse-travelling trains face the opposite direction
  if (train.direction === -1) bearing += Math.PI;

  return bearing;
}

/**
 * Return a position `lookaheadKm` ahead of the train in its direction of
 * travel. Used by TrainLayer to compute the screen-space bearing so the
 * rectangle can be oriented along the track.
 */
export function getTrainAheadPos(
  train: TrainState,
  path: RoutePath,
  lookaheadKm = 0.05
): [number, number] {
  const aheadDist = Math.max(
    0,
    Math.min(
      train.distanceTravelled + train.direction * lookaheadKm,
      path.totalDistance
    )
  );
  return getTrainLatLng({ ...train, distanceTravelled: aheadDist }, path);
}

/**
 * Find the nearest stop strictly ahead of `distanceTravelled` in the given direction.
 *
 * "Strictly ahead" means:
 *   direction = +1 → stop.distanceAlong  >  distanceTravelled
 *   direction = −1 → stop.distanceAlong  <  distanceTravelled
 *
 * No backward tolerance is applied.  The previous tolerance of ±0.001 km
 * caused a re-snap loop: after a train's dwell ended it sat exactly at
 * stop.distanceAlong, and the tolerance allowed the same stop to be returned
 * again on the very next tick, snapping the train back indefinitely.
 *
 * The deceleration slow-zone (SLOW_ZONE_KM = 0.25 km) is far larger than
 * any floating-point rounding, so approach detection is unaffected by removing
 * the tolerance.
 */
function findNextStop(
  stops: RouteStop[],
  distanceTravelled: number,
  direction: TrainDirection
): RouteStop | null {
  if (stops.length === 0) return null;

  if (direction === 1) {
    for (const stop of stops) {
      if (stop.distanceAlong > distanceTravelled) return stop;
    }
    return null;
  } else {
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i].distanceAlong < distanceTravelled) return stops[i];
    }
    return null;
  }
}

// ─── Metro service hours ──────────────────────────────────────────────────────

/**
 * WMATA service hours (simplified):
 *   Mon–Thu, Sun : 05:00 – 24:00
 *   Fri–Sat      : 05:00 – 01:00 next day
 *
 * Returns true when trains should be running.
 * Uses EST/EDT (America/New_York).
 */
export function isMetroInService(): boolean {
  try {
    const now = new Date();
    const parts = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).split(", ");
    // parts[0] = "Mon" | "Tue" etc., parts[1] = "HH:MM"
    const day = parts[0]; // e.g. "Fri"
    const [hStr] = (parts[1] ?? "12:00").split(":");
    const h = parseInt(hStr, 10);
    const isLateSvc = day === "Fri" || day === "Sat"; // extended to 1 AM
    if (h < 5) return isLateSvc && h < 1; // late-night extension
    return h < 24;
  } catch {
    return true; // fail-open: keep running if locale parsing breaks
  }
}

/**
 * Human-readable next service transition time (for UI display).
 */
export function getMetroServiceLabel(): { active: boolean; label: string } {
  const active = isMetroInService();
  return {
    active,
    label: active ? "In Service" : "Out of Service · resumes 05:00 EST",
  };
}
