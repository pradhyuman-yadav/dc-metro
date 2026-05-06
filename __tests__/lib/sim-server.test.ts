import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrainState, RoutePath } from "@/lib/simulation";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePath(routeId: number, routeRef: string, stops = 5): RoutePath {
  const waypoints: [number, number][] = Array.from({ length: 10 }, (_, i) => [38.9 + i * 0.01, -77.0]);
  const distances = waypoints.map((_, i) => i * 0.5);
  return {
    routeId,
    routeRef,
    routeColour: "#BF0D3E",
    routeName: `${routeRef} Line`,
    waypoints,
    distances,
    totalDistance: distances[distances.length - 1],
    stops: Array.from({ length: stops }, (_, i) => ({
      stationName: `Station ${i + 1}`,
      waypointIndex: i + 1,
      distanceAlong: (i + 1) * 0.5,
    })),
  };
}

function makeTrain(id: string, routeId: number, routeRef: string): TrainState {
  return {
    id,
    routeId,
    routeRef,
    routeColour: "#BF0D3E",
    routeName: `${routeRef} Line`,
    distanceTravelled: 1.0,
    direction: 1,
    status: "moving",
    currentStation: null,
    platform: "A",
    dwellRemaining: 0,
    partnerRouteId: null,
    passengers: 0,
  };
}

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockUpsertTrainStates = vi.fn();
const mockUpsertStationPassengers = vi.fn();
const mockGetCachedRoutes = vi.fn();
const mockGetCachedStations = vi.fn();
const mockGetCachedRoutePaths = vi.fn();
const mockGetTrainStates = vi.fn();
const mockGetStationPassengers = vi.fn();
const mockFetchSubwayRoutes = vi.fn();
const mockFetchSubwayStations = vi.fn();
const mockPairRoutes = vi.fn();

vi.mock("@/lib/stations", () => ({
  getCachedRoutes: () => mockGetCachedRoutes(),
  upsertRoutes: vi.fn(),
  getCachedStations: () => mockGetCachedStations(),
  upsertStations: vi.fn(),
  getCachedRoutePaths: () => mockGetCachedRoutePaths(),
  upsertRoutePaths: vi.fn(),
  getTrainStates: () => mockGetTrainStates(),
  upsertTrainStates: (...args: unknown[]) => mockUpsertTrainStates(...args),
  getStationPassengers: () => mockGetStationPassengers(),
  upsertStationPassengers: (...args: unknown[]) => mockUpsertStationPassengers(...args),
}));

vi.mock("@/lib/overpass", () => ({
  fetchSubwayRoutes: () => mockFetchSubwayRoutes(),
  fetchSubwayStations: () => mockFetchSubwayStations(),
  pairRoutes: (...args: unknown[]) => mockPairRoutes(...args),
}));

vi.mock("@/lib/station-capacities", () => ({
  getStationCapacity: vi.fn().mockReturnValue(500),
}));

vi.mock("@/lib/simulation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/simulation")>();
  return {
    ...actual,
    // Keep trainsPerRoute=1 so initTrains doesn't pre-fill the cap in tests
    DEFAULT_CONFIG: { ...actual.DEFAULT_CONFIG, trainsPerRoute: 1 },
    buildRoutePaths: vi.fn().mockImplementation((routes: { id: number; ref: string }[]) =>
      routes.map((r) => makePath(r.id, r.ref))
    ),
    mapStopsToRoute: vi.fn().mockImplementation((p: RoutePath) => p),
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

async function makeInitializedServer() {
  // Reset module registry so getSimServer() returns a fresh instance
  vi.resetModules();

  // Re-apply mocks after module reset
  vi.mock("@/lib/stations", () => ({
    getCachedRoutes: () => mockGetCachedRoutes(),
    upsertRoutes: vi.fn(),
    getCachedStations: () => mockGetCachedStations(),
    upsertStations: vi.fn(),
    getCachedRoutePaths: () => mockGetCachedRoutePaths(),
    upsertRoutePaths: vi.fn(),
    getTrainStates: () => mockGetTrainStates(),
    upsertTrainStates: (...args: unknown[]) => mockUpsertTrainStates(...args),
    getStationPassengers: () => mockGetStationPassengers(),
    upsertStationPassengers: (...args: unknown[]) => mockUpsertStationPassengers(...args),
  }));

  const { getSimServer } = await import("@/lib/sim-server");
  // Clear global singleton
  (global as Record<string, unknown>).__dcMetroSim = undefined;
  return getSimServer();
}

describe("SimServer — addTrain / removeTrain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedRoutes.mockReturnValue([{ id: 1, name: "Red Line", ref: "RD", colour: "#BF0D3E", segments: [] }]);
    mockGetCachedStations.mockReturnValue([]);
    mockGetCachedRoutePaths.mockReturnValue([makePath(1, "RD", 4)]);
    mockGetTrainStates.mockReturnValue(null);
    mockGetStationPassengers.mockReturnValue(new Map());
    mockPairRoutes.mockReturnValue(new Map());
    (global as Record<string, unknown>).__dcMetroSim = undefined;
  });

  it("addTrain creates a new train on the correct route", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    const before = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    sim.addTrain("RD");
    const after = JSON.parse(sim.snapshot()) as { trains: TrainState[] };

    expect(after.trains.length).toBeGreaterThan(before.trains.length);
    const newTrain = after.trains[after.trains.length - 1];
    expect(newTrain.routeRef).toBe("RD");
  });

  it("addTrain persists immediately (upsertTrainStates called)", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();
    mockUpsertTrainStates.mockClear();

    sim.addTrain("RD");
    // Allow microtask queue to flush (persist returns Promise)
    await new Promise((r) => setTimeout(r, 0));

    expect(mockUpsertTrainStates).toHaveBeenCalledTimes(1);
  });

  it("addTrain respects route cap (stops.length - 1)", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    // Set up path with only 2 stops → max 1 train
    mockGetCachedRoutePaths.mockReturnValue([makePath(1, "RD", 2)]);
    await sim.ensureInitialized();

    const snapshotBefore = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    // Attempt to add more trains than the cap allows
    for (let i = 0; i < 5; i++) sim.addTrain("RD");
    const snapshotAfter = JSON.parse(sim.snapshot()) as { trains: TrainState[] };

    // Should not exceed maxTrains = stops.length - 1 = 1
    const rdTrains = snapshotAfter.trains.filter((t) => t.routeRef === "RD");
    expect(rdTrains.length).toBeLessThanOrEqual(1);
    // Train count should not decrease
    expect(snapshotAfter.trains.length).toBeGreaterThanOrEqual(snapshotBefore.trains.length);
  });

  it("removeTrain removes last train on route", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    sim.addTrain("RD");
    const before = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    const beforeCount = before.trains.filter((t) => t.routeRef === "RD").length;

    sim.removeTrain("RD");
    const after = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    const afterCount = after.trains.filter((t) => t.routeRef === "RD").length;

    expect(afterCount).toBe(beforeCount - 1);
  });

  it("removeTrain refuses to remove last train (keeps minimum 1)", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    // Remove until only 1 remains, then try again
    const snapshot = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    const rdCount = snapshot.trains.filter((t) => t.routeRef === "RD").length;
    for (let i = 0; i < rdCount - 1; i++) sim.removeTrain("RD");

    const before = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    const beforeRd = before.trains.filter((t) => t.routeRef === "RD").length;
    expect(beforeRd).toBe(1);

    // This remove should be a no-op
    sim.removeTrain("RD");
    const after = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    expect(after.trains.filter((t) => t.routeRef === "RD").length).toBe(1);
  });

  it("removeTrain persists immediately", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();
    sim.addTrain("RD");
    mockUpsertTrainStates.mockClear();

    sim.removeTrain("RD");
    await new Promise((r) => setTimeout(r, 0));

    expect(mockUpsertTrainStates).toHaveBeenCalledTimes(1);
  });

  it("addTrain is a no-op for unknown routeRef", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    const before = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    sim.addTrain("BOGUS");
    const after = JSON.parse(sim.snapshot()) as { trains: TrainState[] };

    expect(after.trains.length).toBe(before.trains.length);
  });
});

describe("SimServer — snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedRoutes.mockReturnValue([{ id: 1, name: "Red Line", ref: "RD", colour: "#BF0D3E", segments: [] }]);
    mockGetCachedStations.mockReturnValue([]);
    mockGetCachedRoutePaths.mockReturnValue([makePath(1, "RD")]);
    mockGetTrainStates.mockReturnValue(null);
    mockGetStationPassengers.mockReturnValue(new Map());
    mockPairRoutes.mockReturnValue(new Map());
    (global as Record<string, unknown>).__dcMetroSim = undefined;
  });

  it("snapshot returns valid JSON with expected shape", async () => {
    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    const raw = sim.snapshot();
    const data = JSON.parse(raw);

    expect(data).toHaveProperty("trains");
    expect(data).toHaveProperty("stationPassengers");
    expect(data).toHaveProperty("surgeEvents");
    expect(data).toHaveProperty("serviceActive");
    expect(Array.isArray(data.trains)).toBe(true);
    expect(Array.isArray(data.stationPassengers)).toBe(true);
    expect(Array.isArray(data.surgeEvents)).toBe(true);
  });
});

describe("SimServer — train restore from saved state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedRoutes.mockReturnValue([{ id: 1, name: "Red Line", ref: "RD", colour: "#BF0D3E", segments: [] }]);
    mockGetCachedStations.mockReturnValue([]);
    mockGetCachedRoutePaths.mockReturnValue([makePath(1, "RD")]);
    mockGetStationPassengers.mockReturnValue(new Map());
    mockPairRoutes.mockReturnValue(new Map());
    (global as Record<string, unknown>).__dcMetroSim = undefined;
  });

  it("restores trains from saved state for known routes", async () => {
    const savedTrain = makeTrain("RD-saved-1", 1, "RD");
    mockGetTrainStates.mockReturnValue({
      states: [savedTrain],
      savedAt: Math.floor(Date.now() / 1000),
    });

    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    const data = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    const rdTrains = data.trains.filter((t: TrainState) => t.routeRef === "RD");
    expect(rdTrains.some((t: TrainState) => t.id === "RD-saved-1")).toBe(true);
  });

  it("spawns fresh trains when no saved state exists", async () => {
    mockGetTrainStates.mockReturnValue(null);

    const { getSimServer } = await import("@/lib/sim-server");
    const sim = getSimServer();
    await sim.ensureInitialized();

    const data = JSON.parse(sim.snapshot()) as { trains: TrainState[] };
    expect(data.trains.length).toBeGreaterThan(0);
    expect(data.trains.every((t: TrainState) => t.routeRef === "RD")).toBe(true);
  });
});
