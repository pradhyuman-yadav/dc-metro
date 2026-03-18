import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubwayRoute, SubwayStation } from '@/lib/overpass';

// ── Mock better-sqlite3 before any imports ────────────────────────────────────
let mockRouteRows: unknown[] = [];
let mockStationRows: unknown[] = [];
let mockLineRows: unknown[] = [];
let mockMinFetched: { t: number | null } = { t: null };

const mockPrepare = vi.fn((sql: string) => ({
  run: vi.fn(),
  get: vi.fn(() => mockMinFetched),
  all: vi.fn(() => {
    if (sql.includes('subway_routes')) return mockRouteRows;
    if (sql.includes('station_lines')) return mockLineRows;
    if (sql.includes('subway_stations')) return mockStationRows;
    return [];
  }),
}));

const mockTransaction = vi.fn((fn: () => void) => () => fn());

const mockDb = {
  pragma: vi.fn(),
  exec: vi.fn(),
  prepare: mockPrepare,
  transaction: mockTransaction,
};

vi.mock('better-sqlite3', () => ({ default: vi.fn(() => mockDb) }));
vi.mock('fs', () => ({ default: { mkdirSync: vi.fn() }, mkdirSync: vi.fn() }));

// ── Import isCacheStale so we can control staleness ───────────────────────────
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => mockDb),
  isCacheStale: vi.fn(() => false), // fresh by default
  CACHE_TTL_SECONDS: 86400,
}));

import { isCacheStale } from '@/lib/db';
import {
  getCachedRoutes, upsertRoutes, getRoutesFetchedAt,
  getCachedStations, upsertStations, getStationsFetchedAt,
  clearAll,
} from '@/lib/stations';

const NOW_SECS = Math.floor(Date.now() / 1000);

const FAKE_ROUTES: SubwayRoute[] = [
  { id: 1, name: 'Red Line', ref: 'Red', colour: '#e51636', segments: [[[38.9, -77.0], [38.91, -77.01]]] },
];

const FAKE_STATIONS: SubwayStation[] = [
  { id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, colours: ['#e51636', '#0074d9'] },
];

beforeEach(() => {
  mockRouteRows = [];
  mockStationRows = [];
  mockLineRows = [];
  mockMinFetched = { t: null };
  vi.mocked(isCacheStale).mockReturnValue(false);
  mockPrepare.mockClear();
  mockTransaction.mockClear();
});

// ── Routes ────────────────────────────────────────────────────────────────────

describe('getCachedRoutes', () => {
  it('returns null when table is empty', () => {
    mockRouteRows = [];
    expect(getCachedRoutes()).toBeNull();
  });

  it('returns null when cache is stale', () => {
    mockRouteRows = [{ id: 1, name: 'Red Line', ref: 'Red', colour: '#e51636', segments: '[]', fetched_at: 0 }];
    vi.mocked(isCacheStale).mockReturnValue(true);
    expect(getCachedRoutes()).toBeNull();
  });

  it('returns deserialized routes when fresh', () => {
    const segJson = JSON.stringify(FAKE_ROUTES[0].segments);
    mockRouteRows = [{ id: 1, name: 'Red Line', ref: 'Red', colour: '#e51636', segments: segJson, fetched_at: NOW_SECS }];
    const result = getCachedRoutes();
    expect(result).not.toBeNull();
    expect(result![0].segments).toEqual(FAKE_ROUTES[0].segments);
  });
});

describe('getRoutesFetchedAt', () => {
  it('returns 0 when no rows', () => {
    mockMinFetched = { t: null };
    expect(getRoutesFetchedAt()).toBe(0);
  });

  it('returns the MIN fetched_at timestamp', () => {
    mockMinFetched = { t: NOW_SECS };
    expect(getRoutesFetchedAt()).toBe(NOW_SECS);
  });
});

describe('upsertRoutes', () => {
  it('wraps operations in a transaction', () => {
    upsertRoutes(FAKE_ROUTES);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ── Stations ──────────────────────────────────────────────────────────────────

describe('getCachedStations', () => {
  it('returns null when table is empty', () => {
    mockStationRows = [];
    expect(getCachedStations()).toBeNull();
  });

  it('returns null when cache is stale', () => {
    mockStationRows = [{ id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, fetched_at: 0 }];
    vi.mocked(isCacheStale).mockReturnValue(true);
    expect(getCachedStations()).toBeNull();
  });

  it('aggregates station_lines colours per station', () => {
    mockStationRows = [{ id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, fetched_at: NOW_SECS }];
    mockLineRows = [
      { station_id: 101, route_ref: 'Red', colour: '#e51636' },
      { station_id: 101, route_ref: 'Blue', colour: '#0074d9' },
    ];
    const result = getCachedStations();
    expect(result).not.toBeNull();
    expect(result![0].colours).toContain('#e51636');
    expect(result![0].colours).toContain('#0074d9');
  });

  it('returns empty colours when no lines recorded', () => {
    mockStationRows = [{ id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, fetched_at: NOW_SECS }];
    mockLineRows = [];
    const result = getCachedStations();
    expect(result![0].colours).toHaveLength(0);
  });
});

describe('getStationsFetchedAt', () => {
  it('returns 0 when no rows', () => {
    mockMinFetched = { t: null };
    expect(getStationsFetchedAt()).toBe(0);
  });
});

describe('upsertStations', () => {
  it('wraps operations in a transaction', () => {
    upsertStations(FAKE_STATIONS);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('executes within a transaction', () => {
    clearAll();
    expect(mockTransaction).toHaveBeenCalled();
  });
});
