import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetStationPassengers, mockUpsertStationPassengers } = vi.hoisted(() => ({
  mockGetStationPassengers: vi.fn<() => Map<string, { capacity: number; current: number }>>(),
  mockUpsertStationPassengers: vi.fn(),
}));

vi.mock("@/lib/stations", () => ({
  getStationPassengers: mockGetStationPassengers,
  upsertStationPassengers: mockUpsertStationPassengers,
}));

const { GET, POST } = await import("@/app/api/subway/station-passengers/route");

beforeEach(() => {
  mockGetStationPassengers.mockReset();
  mockUpsertStationPassengers.mockReset();
});

describe("GET /api/subway/station-passengers", () => {
  it("returns entries array from station passenger map", async () => {
    const map = new Map<string, { capacity: number; current: number }>([
      ["Metro Center", { capacity: 1200, current: 600 }],
      ["Bethesda", { capacity: 800, current: 200 }],
    ]);
    mockGetStationPassengers.mockReturnValue(map);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entries).toHaveLength(2);
    const mc = body.entries.find((e: { stationName: string }) => e.stationName === "Metro Center");
    expect(mc).toBeDefined();
    expect(mc.capacity).toBe(1200);
    expect(mc.current).toBe(600);
  });

  it("returns empty entries array when map is empty", async () => {
    mockGetStationPassengers.mockReturnValue(new Map());

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entries).toHaveLength(0);
  });

  it("returns 500 when getStationPassengers throws", async () => {
    mockGetStationPassengers.mockImplementation(() => { throw new Error("db error"); });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

describe("POST /api/subway/station-passengers", () => {
  it("saves entries and returns count", async () => {
    const body = [{ stationName: "Metro Center", capacity: 1200, current: 400 }];
    const req = new Request("http://localhost/api/subway/station-passengers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.saved).toBe(1);
    expect(mockUpsertStationPassengers).toHaveBeenCalledWith(body);
  });

  it("returns 400 when body is not an array", async () => {
    const req = new Request("http://localhost/api/subway/station-passengers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "an array" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
    expect(mockUpsertStationPassengers).not.toHaveBeenCalled();
  });

  it("returns 500 when upsertStationPassengers throws", async () => {
    mockUpsertStationPassengers.mockImplementation(() => { throw new Error("write failed"); });

    const req = new Request("http://localhost/api/subway/station-passengers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ stationName: "Metro Center", capacity: 1200, current: 400 }]),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBeTruthy();
  });
});
