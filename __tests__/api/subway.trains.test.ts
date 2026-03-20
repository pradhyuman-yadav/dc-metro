import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrainState } from "@/lib/simulation";

const FAKE_TRAIN: TrainState = {
  id: "RED-1",
  routeId: 1,
  routeRef: "RED",
  routeColour: "#BF0000",
  routeName: "Red Line",
  distanceTravelled: 0.5,
  direction: 1,
  status: "moving",
  currentStation: null,
  platform: "A",
  dwellRemaining: 0,
  partnerRouteId: null,
  passengers: 0,
};

const { mockGetTrainStates, mockUpsertTrainStates } = vi.hoisted(() => ({
  mockGetTrainStates: vi.fn<() => { states: TrainState[]; savedAt: number } | null>(),
  mockUpsertTrainStates: vi.fn(),
}));

vi.mock("@/lib/stations", () => ({
  getTrainStates: mockGetTrainStates,
  upsertTrainStates: mockUpsertTrainStates,
}));

const { GET, POST } = await import("@/app/api/subway/trains/route");

beforeEach(() => {
  mockGetTrainStates.mockReset();
  mockUpsertTrainStates.mockReset();
});

describe("GET /api/subway/trains", () => {
  it("returns saved states when present", async () => {
    mockGetTrainStates.mockReturnValue({ states: [FAKE_TRAIN], savedAt: 1234567 });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.states).toHaveLength(1);
    expect(body.states[0].id).toBe("RED-1");
    expect(body.savedAt).toBe(1234567);
  });

  it("returns empty states array when nothing saved", async () => {
    mockGetTrainStates.mockReturnValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.states).toHaveLength(0);
    expect(body.savedAt).toBeNull();
  });

  it("returns 500 when getTrainStates throws", async () => {
    mockGetTrainStates.mockImplementation(() => {
      throw new Error("db error");
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

describe("POST /api/subway/trains", () => {
  it("saves trains and returns count", async () => {
    const req = new Request("http://localhost/api/subway/trains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([FAKE_TRAIN]),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.saved).toBe(1);
    expect(mockUpsertTrainStates).toHaveBeenCalledWith([FAKE_TRAIN]);
  });

  it("returns 400 when body is not an array", async () => {
    const req = new Request("http://localhost/api/subway/trains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "an array" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(mockUpsertTrainStates).not.toHaveBeenCalled();
  });

  it("saves empty array", async () => {
    const req = new Request("http://localhost/api/subway/trains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.saved).toBe(0);
  });

  it("returns 500 when upsertTrainStates throws", async () => {
    mockUpsertTrainStates.mockImplementation(() => {
      throw new Error("write failed");
    });

    const req = new Request("http://localhost/api/subway/trains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([FAKE_TRAIN]),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});
