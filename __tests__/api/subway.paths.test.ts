import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RoutePath } from "@/lib/simulation";

const FAKE_PATH: RoutePath = {
  routeId: 1,
  routeRef: "RED",
  routeColour: "#BF0000",
  routeName: "Red Line",
  waypoints: [[38.9, -77.0], [38.91, -77.01]],
  distances: [0, 1.5],
  totalDistance: 1.5,
  stops: [],
};

const { mockGetCachedRoutePaths, mockUpsertRoutePaths } = vi.hoisted(() => ({
  mockGetCachedRoutePaths: vi.fn<() => Omit<RoutePath, "stops">[] | null>(),
  mockUpsertRoutePaths: vi.fn(),
}));

vi.mock("@/lib/stations", () => ({
  getCachedRoutePaths: mockGetCachedRoutePaths,
  upsertRoutePaths: mockUpsertRoutePaths,
}));

const { GET, POST } = await import("@/app/api/subway/paths/route");

beforeEach(() => {
  mockGetCachedRoutePaths.mockReset();
  mockUpsertRoutePaths.mockReset();
});

describe("GET /api/subway/paths", () => {
  it("returns cached paths when present", async () => {
    const { stops: _stops, ...pathWithoutStops } = FAKE_PATH;
    mockGetCachedRoutePaths.mockReturnValue([pathWithoutStops]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.paths).toHaveLength(1);
    expect(body.paths[0].routeId).toBe(1);
  });

  it("returns empty paths array when nothing cached", async () => {
    mockGetCachedRoutePaths.mockReturnValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.paths).toHaveLength(0);
  });

  it("returns 500 when getCachedRoutePaths throws", async () => {
    mockGetCachedRoutePaths.mockImplementation(() => {
      throw new Error("db error");
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

describe("POST /api/subway/paths", () => {
  it("saves paths and returns count", async () => {
    const req = new Request("http://localhost/api/subway/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([FAKE_PATH]),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.saved).toBe(1);
    expect(mockUpsertRoutePaths).toHaveBeenCalledWith([FAKE_PATH]);
  });

  it("returns 400 when body is not an array", async () => {
    const req = new Request("http://localhost/api/subway/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "an array" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(mockUpsertRoutePaths).not.toHaveBeenCalled();
  });

  it("saves empty array", async () => {
    const req = new Request("http://localhost/api/subway/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.saved).toBe(0);
  });

  it("returns 500 when upsertRoutePaths throws", async () => {
    mockUpsertRoutePaths.mockImplementation(() => {
      throw new Error("write failed");
    });

    const req = new Request("http://localhost/api/subway/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([FAKE_PATH]),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});
