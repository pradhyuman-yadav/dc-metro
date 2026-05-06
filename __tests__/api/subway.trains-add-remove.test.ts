import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockAddTrain = vi.fn();
const mockRemoveTrain = vi.fn();
const mockEnsureInitialized = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/sim-server", () => ({
  getSimServer: () => ({
    ensureInitialized: mockEnsureInitialized,
    addTrain: mockAddTrain,
    removeTrain: mockRemoveTrain,
  }),
}));

const { POST: addPost } = await import("@/app/api/subway/trains/add/route");
const { POST: removePost } = await import("@/app/api/subway/trains/remove/route");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockAddTrain.mockReset();
  mockRemoveTrain.mockReset();
  mockEnsureInitialized.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/subway/trains/add", () => {
  it("valid routeRef → 200 { ok: true }", async () => {
    const res = await addPost(makeRequest({ routeRef: "RD" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockAddTrain).toHaveBeenCalledWith("RD");
  });

  it("calls addTrain for each valid line code", async () => {
    for (const ref of ["RD", "OR", "SV", "BL", "YL", "GR"]) {
      mockAddTrain.mockReset();
      const res = await addPost(makeRequest({ routeRef: ref }));
      expect(res.status).toBe(200);
      expect(mockAddTrain).toHaveBeenCalledWith(ref);
    }
  });

  it("invalid routeRef → 400", async () => {
    const res = await addPost(makeRequest({ routeRef: "XX" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid routeRef/i);
    expect(mockAddTrain).not.toHaveBeenCalled();
  });

  it("missing routeRef → 400", async () => {
    const res = await addPost(makeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(mockAddTrain).not.toHaveBeenCalled();
  });

  it("non-string routeRef → 400", async () => {
    const res = await addPost(makeRequest({ routeRef: 42 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(mockAddTrain).not.toHaveBeenCalled();
  });

  it("null routeRef → 400", async () => {
    const res = await addPost(makeRequest({ routeRef: null }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(mockAddTrain).not.toHaveBeenCalled();
  });

  it("sim error → 500", async () => {
    mockEnsureInitialized.mockRejectedValue(new Error("sim crashed"));
    const res = await addPost(makeRequest({ routeRef: "RD" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

describe("POST /api/subway/trains/remove", () => {
  it("valid routeRef → 200 { ok: true }", async () => {
    const res = await removePost(makeRequest({ routeRef: "BL" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockRemoveTrain).toHaveBeenCalledWith("BL");
  });

  it("calls removeTrain for each valid line code", async () => {
    for (const ref of ["RD", "OR", "SV", "BL", "YL", "GR"]) {
      mockRemoveTrain.mockReset();
      const res = await removePost(makeRequest({ routeRef: ref }));
      expect(res.status).toBe(200);
      expect(mockRemoveTrain).toHaveBeenCalledWith(ref);
    }
  });

  it("invalid routeRef → 400", async () => {
    const res = await removePost(makeRequest({ routeRef: "PURPLE" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid routeRef/i);
    expect(mockRemoveTrain).not.toHaveBeenCalled();
  });

  it("missing routeRef → 400", async () => {
    const res = await removePost(makeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(mockRemoveTrain).not.toHaveBeenCalled();
  });

  it("non-string routeRef → 400", async () => {
    const res = await removePost(makeRequest({ routeRef: true }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(mockRemoveTrain).not.toHaveBeenCalled();
  });

  it("sim error → 500", async () => {
    mockEnsureInitialized.mockRejectedValue(new Error("db gone"));
    const res = await removePost(makeRequest({ routeRef: "OR" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });

  it("removeTrain no-op when min reached → still 200", async () => {
    // removeTrain is a no-op at minimum (handled in sim-server, returns silently)
    mockRemoveTrain.mockImplementation(() => {/* no-op */});
    const res = await removePost(makeRequest({ routeRef: "GR" }));
    expect(res.status).toBe(200);
    expect(mockRemoveTrain).toHaveBeenCalledTimes(1);
  });
});
