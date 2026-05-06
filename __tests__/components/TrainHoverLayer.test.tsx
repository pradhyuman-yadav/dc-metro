import { describe, it, expect } from "vitest";
import { getAdjacentStations } from "@/components/TrainHoverLayer";
import type { TrainState, RoutePath } from "@/lib/simulation";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeTrain(distance: number, direction: 1 | -1): TrainState {
  return {
    id: "T1",
    routeId: 1,
    routeRef: "RD",
    routeColour: "#BF0D3E",
    routeName: "Red Line",
    distanceTravelled: distance,
    direction,
    status: "moving",
    currentStation: null,
    platform: "A",
    dwellRemaining: 0,
    partnerRouteId: null,
    passengers: 0,
  };
}

function makePath(stopDistances: number[]): RoutePath {
  return {
    routeId: 1,
    routeRef: "RD",
    routeColour: "#BF0D3E",
    routeName: "Red Line",
    waypoints: stopDistances.map((_, i) => [38.9 + i * 0.01, -77.0]),
    distances: stopDistances,
    totalDistance: stopDistances[stopDistances.length - 1],
    stops: stopDistances.map((d, i) => ({
      stationName: `Stop ${i + 1}`,
      waypointIndex: i,
      distanceAlong: d,
    })),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("getAdjacentStations — forward direction (direction = 1)", () => {
  const path = makePath([0, 1, 2, 3, 4]);

  it("returns correct next/prev when train is between stops", () => {
    const train = makeTrain(1.5, 1); // between Stop 2 (d=1) and Stop 3 (d=2)
    const { next, prev } = getAdjacentStations(train, path);
    expect(next).toBe("Stop 3"); // first stop > 1.5
    expect(prev).toBe("Stop 2"); // last stop <= 1.5
  });

  it("returns null prev at start of route", () => {
    const train = makeTrain(0, 1); // at first stop
    const { next, prev } = getAdjacentStations(train, path);
    expect(next).toBe("Stop 2"); // first stop > 0
    expect(prev).toBe("Stop 1"); // stop at exactly 0 <= 0
  });

  it("returns null next at end of route", () => {
    const train = makeTrain(4.5, 1); // beyond last stop
    const { next, prev } = getAdjacentStations(train, path);
    expect(next).toBeNull(); // no stop > 4.5
    expect(prev).toBe("Stop 5"); // last stop <= 4.5
  });

  it("returns null both for empty stops", () => {
    const emptyPath: RoutePath = { ...makePath([]), stops: [] };
    const train = makeTrain(1.0, 1);
    const { next, prev } = getAdjacentStations(train, emptyPath);
    expect(next).toBeNull();
    expect(prev).toBeNull();
  });
});

describe("getAdjacentStations — reverse direction (direction = -1)", () => {
  const path = makePath([0, 1, 2, 3, 4]);

  it("returns correct next/prev when train is between stops (reverse)", () => {
    // direction -1: train at d=2.5
    // stops = [{d:0,Stop1},{d:1,Stop2},{d:2,Stop3},{d:3,Stop4},{d:4,Stop5}]
    // next = [...stops].reverse().find(s => s.distanceAlong < 2.5)
    //      → reversed: [4,3,2,1,0], first d<2.5 is d=2 → "Stop 3"
    // prev = stops.find(s => s.distanceAlong >= 2.5)
    //      → forward: first d>=2.5 is d=3 → "Stop 4"
    const train = makeTrain(2.5, -1);
    const { next, prev } = getAdjacentStations(train, path);
    expect(next).toBe("Stop 3"); // d=2 < 2.5
    expect(prev).toBe("Stop 4"); // d=3 >= 2.5
  });

  it("returns null next at start of reverse journey", () => {
    const train = makeTrain(0, -1); // at beginning (lowest distance)
    const { next } = getAdjacentStations(train, path);
    // reversed scan for d < 0: none
    expect(next).toBeNull();
  });

  it("returns null prev at far end of reverse journey", () => {
    const train = makeTrain(5, -1); // beyond end
    const { prev } = getAdjacentStations(train, path);
    // forward scan for d >= 5: none in [0,1,2,3,4]
    expect(prev).toBeNull();
  });
});
