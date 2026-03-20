import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SubwayRoute, SubwayStation } from "@/lib/overpass";

// ── Mock the simulation engine (used only for pathsMap building) ──────────────
vi.mock("@/lib/simulation", () => ({
  buildRoutePaths: vi.fn(() => [mockPath]),
  mapStopsToRoute: vi.fn((p: unknown) => p),
  DEFAULT_CONFIG: {
    trainsPerRoute: 4,
    speedKmPerMs: 0.04,
    dwellMs: 2500,
    stationRadiusKm: 0.08,
  },
}));

import type { RoutePath } from "@/lib/simulation";

const mockPath: RoutePath = {
  routeId: 1, routeRef: "RED", routeColour: "#BF0000", routeName: "Red Line",
  waypoints: [[38.9, -77.0], [38.91, -77.01]],
  distances: [0, 1.5],
  totalDistance: 1.5,
  stops: [],
};

// ── EventSource mock ──────────────────────────────────────────────────────────

type MessageHandler = (e: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: MessageHandler | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  /** Helper: push a server frame to this client */
  push(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close = vi.fn();
}

const ROUTE: SubwayRoute = {
  id: 1, name: "Red Line", ref: "RED", colour: "#BF0000",
  segments: [[[38.9, -77.0], [38.91, -77.01]]],
};
const STATION: SubwayStation = {
  id: 101, name: "Metro Center", lat: 38.9, lng: -77.0, colours: ["#BF0000"],
};

const SSE_FRAME = {
  trains: [{ id: "RED-1", routeId: 1, routeRef: "RED", routeColour: "#BF0000",
    routeName: "Red Line", distanceTravelled: 0.3, direction: 1, status: "moving",
    currentStation: null, platform: "A", dwellRemaining: 0, partnerRouteId: null, passengers: 0 }],
  stationPassengers: [["Metro Center", { capacity: 1200, current: 340 }]],
  surgeEvents: [],
  serviceActive: true,
};

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Dynamic import after mocks are registered
const { useSimulation } = await import("@/hooks/useSimulation");

describe("useSimulation", () => {
  it("returns empty trainsRef and pathsMap when routes are empty", () => {
    const { result } = renderHook(() => useSimulation([], []));
    expect(result.current.trainsRef.current).toHaveLength(0);
    expect(result.current.pathsMap.size).toBe(0);
  });

  it("does NOT open EventSource when routes are empty", () => {
    renderHook(() => useSimulation([], []));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("opens EventSource('/api/subway/stream') when routes are provided", () => {
    renderHook(() => useSimulation([ROUTE], [STATION]));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/subway/stream");
  });

  it("updates trainsRef from SSE message", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    act(() => { MockEventSource.instances[0].push(SSE_FRAME); });
    expect(result.current.trainsRef.current).toHaveLength(1);
    expect(result.current.trainsRef.current[0].id).toBe("RED-1");
  });

  it("updates stationPassengers React state from SSE message", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    act(() => { MockEventSource.instances[0].push(SSE_FRAME); });
    expect(result.current.stationPassengers).toBeInstanceOf(Map);
    expect(result.current.stationPassengers.get("Metro Center")?.current).toBe(340);
  });

  it("updates surgeEvents from SSE message", () => {
    const frame = { ...SSE_FRAME, surgeEvents: [{ id: "s1", stationName: "Metro Center",
      label: "Rush hour", multiplier: 4, startedAt: 0, expiresAt: 9_999_999_999 }] };
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    act(() => { MockEventSource.instances[0].push(frame); });
    expect(result.current.surgeEvents).toHaveLength(1);
    expect(result.current.surgeEvents[0].id).toBe("s1");
  });

  it("pathsMap contains an entry for the route", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    expect(result.current.pathsMap.has(ROUTE.id)).toBe(true);
  });

  it("pathsMap entry has correct routeColour", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    expect(result.current.pathsMap.get(ROUTE.id)?.routeColour).toBe("#BF0000");
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useSimulation([ROUTE], [STATION]));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.close).toHaveBeenCalled();
  });

  it("returns stationPassengers as a Map initially", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    expect(result.current.stationPassengers).toBeInstanceOf(Map);
  });

  it("returns surgeEvents as an array initially", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    expect(Array.isArray(result.current.surgeEvents)).toBe(true);
  });

  it("exposes addTrain and removeTrain as functions", () => {
    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    expect(typeof result.current.addTrain).toBe("function");
    expect(typeof result.current.removeTrain).toBe("function");
  });

  it("addTrain POSTs to /api/subway/trains/add", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    await act(async () => { result.current.addTrain("RED"); });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/subway/trains/add",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ routeRef: "RED" }) })
    );
    vi.unstubAllGlobals();
    vi.stubGlobal("EventSource", MockEventSource);
  });

  it("removeTrain POSTs to /api/subway/trains/remove", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSimulation([ROUTE], [STATION]));
    await act(async () => { result.current.removeTrain("RED"); });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/subway/trains/remove",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ routeRef: "RED" }) })
    );
    vi.unstubAllGlobals();
    vi.stubGlobal("EventSource", MockEventSource);
  });
});
