import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { SubwayRoute, SubwayStation } from "@/lib/overpass";
import type { RoutePath, TrainState } from "@/lib/simulation";

// ── Mock the simulation engine ──────────────────────────────────────────────
// The pure functions are unit-tested in simulation.test.ts.
// Here we only verify the hook wires them correctly and returns the right shape.

const mockPath: RoutePath = {
  routeId: 1, routeRef: "RED", routeColour: "#BF0000", routeName: "Red Line",
  waypoints: [[38.9, -77.0], [38.91, -77.01]],
  distances: [0, 1.5],
  totalDistance: 1.5,
  stops: [],
};

const mockTrain: TrainState = {
  id: "RED-1", routeId: 1, routeRef: "RED", routeColour: "#BF0000",
  routeName: "Red Line", distanceTravelled: 0.3,
  direction: 1, status: "moving", currentStation: null,
  platform: "A", dwellRemaining: 0, partnerRouteId: null,
};

vi.mock("@/lib/simulation", () => ({
  buildRoutePaths: vi.fn(() => [mockPath]),
  mapStopsToRoute: vi.fn((p: RoutePath) => p),
  initTrains: vi.fn(() => [mockTrain]),
  tickSimulation: vi.fn((trains: TrainState[]) => trains),
  DEFAULT_CONFIG: {
    trainsPerRoute: 4,
    speedKmPerMs: 0.04,
    dwellMs: 2500,
    stationRadiusKm: 0.08,
  },
}));

// ── Stub RAF + fetch ─────────────────────────────────────────────────────────
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // Simulate empty saved states so seed() falls through to fresh initTrains
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ states: [] }) })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROUTE: SubwayRoute = {
  id: 1, name: "Red Line", ref: "RED", colour: "#BF0000",
  segments: [[[38.9, -77.0], [38.91, -77.01]]],
};
const STATION: SubwayStation = {
  id: 101, name: "Metro Center", lat: 38.9, lng: -77.0, colours: ["#BF0000"],
};

// Dynamic import after mocks are registered
const { useSimulation } = await import("@/hooks/useSimulation");

describe("useSimulation", () => {
  it("returns empty trains and empty pathsMap when routes are empty", () => {
    const { result } = renderHook(() => useSimulation([], []));
    expect(result.current.trainsRef.current).toHaveLength(0);
    expect(result.current.pathsMap.size).toBe(0);
  });

  it("returns initial trains from initTrains when routes provided", async () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    await waitFor(() => {
      expect(result.current.trainsRef.current).toHaveLength(1);
    });
    expect(result.current.trainsRef.current[0].id).toBe("RED-1");
  });

  it("pathsMap contains an entry for each route", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], []));
    expect(result.current.pathsMap.has(ROUTE.id)).toBe(true);
  });

  it("pathsMap entry has correct routeColour", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], []));
    expect(result.current.pathsMap.get(ROUTE.id)?.routeColour).toBe("#BF0000");
  });

  it("starts the RAF loop when routes are provided", () => {
    renderHook(() => useSimulation([ROUTE], []));
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it("does not start the RAF loop when routes are empty", () => {
    renderHook(() => useSimulation([], []));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
