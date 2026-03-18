import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubwayStation } from '@/lib/overpass';

const FAKE_STATIONS: SubwayStation[] = [
  { id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, colours: ['#e51636'] },
];

const { mockGetCachedStations, mockUpsertStations, mockGetStationsFetchedAt, mockFetchSubwayStations } =
  vi.hoisted(() => ({
    mockGetCachedStations: vi.fn<() => SubwayStation[] | null>(),
    mockUpsertStations: vi.fn(),
    mockGetStationsFetchedAt: vi.fn(() => 0),
    mockFetchSubwayStations: vi.fn<() => Promise<SubwayStation[]>>(),
  }));

vi.mock('@/lib/stations', () => ({
  getCachedStations: mockGetCachedStations,
  upsertStations: mockUpsertStations,
  getStationsFetchedAt: mockGetStationsFetchedAt,
}));

vi.mock('@/lib/overpass', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/overpass')>();
  return { ...actual, fetchSubwayStations: mockFetchSubwayStations };
});

import { GET } from '@/app/api/subway/stations/route';
import { NextRequest } from 'next/server';

function makeReq() {
  return new NextRequest('http://localhost/api/subway/stations');
}

beforeEach(() => {
  mockGetCachedStations.mockReset();
  mockUpsertStations.mockReset();
  mockFetchSubwayStations.mockReset();
  mockGetStationsFetchedAt.mockReturnValue(0);
});

describe('GET /api/subway/stations', () => {
  it('returns cached stations when cache is warm', async () => {
    mockGetCachedStations.mockReturnValue(FAKE_STATIONS);
    mockGetStationsFetchedAt.mockReturnValue(9999);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.stations).toHaveLength(1);
    expect(mockFetchSubwayStations).not.toHaveBeenCalled();
  });

  it('fetches from Overpass and upserts when cache is cold', async () => {
    mockGetCachedStations.mockReturnValue(null);
    mockFetchSubwayStations.mockResolvedValue(FAKE_STATIONS);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cached).toBe(false);
    expect(body.stations).toHaveLength(1);
    expect(mockUpsertStations).toHaveBeenCalledWith(FAKE_STATIONS);
  });

  it('returns 502 when Overpass throws', async () => {
    mockGetCachedStations.mockReturnValue(null);
    mockFetchSubwayStations.mockRejectedValue(new Error('timeout'));

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe('upstream_error');
  });

  it('response Content-Type is application/json', async () => {
    mockGetCachedStations.mockReturnValue(FAKE_STATIONS);
    const res = await GET(makeReq());
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
