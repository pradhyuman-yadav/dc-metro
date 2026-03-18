import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubwayRoute } from '@/lib/overpass';

const FAKE_ROUTES: SubwayRoute[] = [
  { id: 1, name: 'Red Line', ref: 'Red', colour: '#e51636', segments: [[[38.9, -77.0]]] },
];

const { mockGetCachedRoutes, mockUpsertRoutes, mockGetRoutesFetchedAt, mockFetchSubwayRoutes } =
  vi.hoisted(() => ({
    mockGetCachedRoutes: vi.fn<() => SubwayRoute[] | null>(),
    mockUpsertRoutes: vi.fn(),
    mockGetRoutesFetchedAt: vi.fn(() => 0),
    mockFetchSubwayRoutes: vi.fn<() => Promise<SubwayRoute[]>>(),
  }));

vi.mock('@/lib/stations', () => ({
  getCachedRoutes: mockGetCachedRoutes,
  upsertRoutes: mockUpsertRoutes,
  getRoutesFetchedAt: mockGetRoutesFetchedAt,
}));

vi.mock('@/lib/overpass', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/overpass')>();
  return { ...actual, fetchSubwayRoutes: mockFetchSubwayRoutes };
});

import { GET } from '@/app/api/subway/routes/route';
import { NextRequest } from 'next/server';

function makeReq() {
  return new NextRequest('http://localhost/api/subway/routes');
}

beforeEach(() => {
  mockGetCachedRoutes.mockReset();
  mockUpsertRoutes.mockReset();
  mockFetchSubwayRoutes.mockReset();
  mockGetRoutesFetchedAt.mockReturnValue(0);
});

describe('GET /api/subway/routes', () => {
  it('returns cached routes when cache is warm', async () => {
    mockGetCachedRoutes.mockReturnValue(FAKE_ROUTES);
    mockGetRoutesFetchedAt.mockReturnValue(1234567);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.routes).toHaveLength(1);
    expect(mockFetchSubwayRoutes).not.toHaveBeenCalled();
  });

  it('fetches from Overpass and upserts when cache is cold', async () => {
    mockGetCachedRoutes.mockReturnValue(null);
    mockFetchSubwayRoutes.mockResolvedValue(FAKE_ROUTES);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cached).toBe(false);
    expect(body.routes).toHaveLength(1);
    expect(mockUpsertRoutes).toHaveBeenCalledWith(FAKE_ROUTES);
  });

  it('returns 502 when Overpass throws', async () => {
    mockGetCachedRoutes.mockReturnValue(null);
    mockFetchSubwayRoutes.mockRejectedValue(new Error('network down'));

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('upstream_error');
    expect(body.message).toContain('network down');
  });

  it('response Content-Type is application/json', async () => {
    mockGetCachedRoutes.mockReturnValue(FAKE_ROUTES);
    const res = await GET(makeReq());
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
