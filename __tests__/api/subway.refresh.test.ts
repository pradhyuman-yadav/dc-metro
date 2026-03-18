import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubwayRoute, SubwayStation } from '@/lib/overpass';

const FAKE_ROUTES: SubwayRoute[] = [
  { id: 1, name: 'Red Line', ref: 'Red', colour: '#e51636', segments: [] },
];
const FAKE_STATIONS: SubwayStation[] = [
  { id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, colours: [] },
];

const { mockClearAll, mockUpsertRoutes, mockUpsertStations, mockFetchSubwayRoutes, mockFetchSubwayStations } =
  vi.hoisted(() => ({
    mockClearAll: vi.fn(),
    mockUpsertRoutes: vi.fn(),
    mockUpsertStations: vi.fn(),
    mockFetchSubwayRoutes: vi.fn<() => Promise<SubwayRoute[]>>(),
    mockFetchSubwayStations: vi.fn<() => Promise<SubwayStation[]>>(),
  }));

vi.mock('@/lib/stations', () => ({
  clearAll: mockClearAll,
  upsertRoutes: mockUpsertRoutes,
  upsertStations: mockUpsertStations,
}));

vi.mock('@/lib/overpass', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/overpass')>();
  return {
    ...actual,
    fetchSubwayRoutes: mockFetchSubwayRoutes,
    fetchSubwayStations: mockFetchSubwayStations,
  };
});

import { POST } from '@/app/api/subway/refresh/route';
import { NextRequest } from 'next/server';

function makeReq(body?: object) {
  return new NextRequest('http://localhost/api/subway/refresh', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  mockClearAll.mockReset();
  mockUpsertRoutes.mockReset();
  mockUpsertStations.mockReset();
  mockFetchSubwayRoutes.mockReset();
  mockFetchSubwayStations.mockReset();
  mockFetchSubwayRoutes.mockResolvedValue(FAKE_ROUTES);
  mockFetchSubwayStations.mockResolvedValue(FAKE_STATIONS);
});

describe('POST /api/subway/refresh', () => {
  it('calls clearAll before fetching', async () => {
    await POST(makeReq());
    expect(mockClearAll).toHaveBeenCalledTimes(1);
  });

  it('refreshes both routes and stations when target=all (default)', async () => {
    const res = await POST(makeReq());
    const body = await res.json();

    expect(body.refreshed).toContain('routes');
    expect(body.refreshed).toContain('stations');
    expect(mockUpsertRoutes).toHaveBeenCalledWith(FAKE_ROUTES);
    expect(mockUpsertStations).toHaveBeenCalledWith(FAKE_STATIONS);
  });

  it('refreshes only routes when target=routes', async () => {
    const res = await POST(makeReq({ target: 'routes' }));
    const body = await res.json();

    expect(body.refreshed).toContain('routes');
    expect(body.refreshed).not.toContain('stations');
    expect(mockFetchSubwayStations).not.toHaveBeenCalled();
  });

  it('refreshes only stations when target=stations', async () => {
    const res = await POST(makeReq({ target: 'stations' }));
    const body = await res.json();

    expect(body.refreshed).toContain('stations');
    expect(body.refreshed).not.toContain('routes');
    expect(mockFetchSubwayRoutes).not.toHaveBeenCalled();
  });

  it('returns 502 when an upstream fetch fails', async () => {
    mockFetchSubwayRoutes.mockRejectedValue(new Error('Overpass down'));

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('upstream_error');
  });

  it('returns fetchedAt timestamp in response', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await POST(makeReq());
    const body = await res.json();
    const after = Math.floor(Date.now() / 1000);

    expect(body.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(body.fetchedAt).toBeLessThanOrEqual(after);
  });
});
