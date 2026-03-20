import { describe, it, expect } from "vitest";
import { STATION_CAPACITIES, getStationCapacity } from "@/lib/station-capacities";

describe("STATION_CAPACITIES", () => {
  it("assigns 1200 to Metro Center (major hub)", () => {
    expect(STATION_CAPACITIES.get("Metro Center")).toBe(1200);
  });

  it("assigns 1200 to Gallery Place-Chinatown", () => {
    expect(STATION_CAPACITIES.get("Gallery Place-Chinatown")).toBe(1200);
  });

  it("assigns 1200 to Union Station", () => {
    expect(STATION_CAPACITIES.get("Union Station")).toBe(1200);
  });

  it("assigns 800 to Bethesda (medium station)", () => {
    expect(STATION_CAPACITIES.get("Bethesda")).toBe(800);
  });

  it("assigns 800 to Rosslyn", () => {
    expect(STATION_CAPACITIES.get("Rosslyn")).toBe(800);
  });

  it("assigns 300 to Vienna/Fairfax-GMU (terminal)", () => {
    expect(STATION_CAPACITIES.get("Vienna/Fairfax-GMU")).toBe(300);
  });

  it("assigns 300 to Shady Grove", () => {
    expect(STATION_CAPACITIES.get("Shady Grove")).toBe(300);
  });
});

describe("getStationCapacity", () => {
  it("returns the correct capacity for a known major hub", () => {
    expect(getStationCapacity("Metro Center")).toBe(1200);
  });

  it("returns the correct capacity for a known medium station", () => {
    expect(getStationCapacity("Bethesda")).toBe(800);
  });

  it("returns the correct capacity for a known terminal", () => {
    expect(getStationCapacity("Shady Grove")).toBe(300);
  });

  it("returns 500 (default) for an unknown station", () => {
    expect(getStationCapacity("Nonexistent Station XYZ")).toBe(500);
  });

  it("returns 500 for an empty string", () => {
    expect(getStationCapacity("")).toBe(500);
  });
});
