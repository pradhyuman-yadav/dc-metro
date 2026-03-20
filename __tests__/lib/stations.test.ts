import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubwayRoute, SubwayStation } from '@/lib/overpass';

// ── Mock better-sqlite3 before any imports ────────────────────────────────────
let mockRouteRows: unknown[] = [];
let mockStationRows: unknown[] = [];
let mockLineRows: unknown[] = [];
let mockTrainRows: unknown[] = [];
let mockPathRows: unknown[] = [];
let mockPassengerRows: unknown[] = [];
let mockMinFetched: { t: number | null } = { t: null };

const mockPrepare = vi.fn((sql: string) => ({
  run: vi.fn(),
  get: vi.fn(() => mockMinFetched),
  all: vi.fn(() => {
    if (sql.includes('route_paths'))         return mockPathRows;
    if (sql.includes('train_states'))        return mockTrainRows;
    if (sql.includes('station_passengers'))  return mockPassengerRows;
    if (sql.includes('subway_routes'))       return mockRouteRows;
    if (sql.includes('station_lines'))       return mockLineRows;
    if (sql.includes('subway_stations'))     return mockStationRows;
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
  getTrainStates, upsertTrainStates,
  getCachedRoutePaths, upsertRoutePaths,
  getStationPassengers, upsertStationPassengers,
  clearAll,
} from '@/lib/stations';
import type { RoutePath } from '@/lib/simulation';
import type { TrainState } from '@/lib/simulation';

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
  mockTrainRows = [];
  mockPathRows = [];
  mockPassengerRows = [];
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

// ── Train states ──────────────────────────────────────────────────────────────

const FAKE_TRAIN: TrainState = {
  id: 'RED-1', routeId: 1, routeRef: 'RED', routeColour: '#BF0000',
  routeName: 'Red Line', distanceTravelled: 5.2, direction: 1,
  status: 'moving', currentStation: null, platform: 'A', dwellRemaining: 0, partnerRouteId: null,
  passengers: 0,
};

describe('getTrainStates', () => {
  it('returns null when table is empty', () => {
    mockTrainRows = [];
    expect(getTrainStates()).toBeNull();
  });

  it('returns null when cache is stale', () => {
    mockTrainRows = [{
      id: 'RED-1', route_id: 1, ref: 'RED', colour: '#BF0000', name: 'Red Line',
      dist: 5.2, direction: 1, status: 'moving', station: null,
      platform: 'A', dwell: 0, saved_at: 0,
    }];
    vi.mocked(isCacheStale).mockReturnValue(true);
    expect(getTrainStates()).toBeNull();
  });

  it('deserialises a saved train correctly', () => {
    mockTrainRows = [{
      id: 'RED-1', route_id: 1, ref: 'RED', colour: '#BF0000', name: 'Red Line',
      dist: 5.2, direction: 1, status: 'moving', station: null,
      platform: 'A', dwell: 0, saved_at: NOW_SECS, passengers: 42,
    }];
    const result = getTrainStates();
    expect(result).not.toBeNull();
    expect(result!.states[0].id).toBe('RED-1');
    expect(result!.states[0].distanceTravelled).toBe(5.2);
    expect(result!.states[0].direction).toBe(1);
    expect(result!.states[0].passengers).toBe(42);
  });
});

describe('upsertTrainStates', () => {
  it('wraps operations in a transaction', () => {
    upsertTrainStates([FAKE_TRAIN]);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ── Route paths ───────────────────────────────────────────────────────────────

const FAKE_PATH: RoutePath = {
  routeId: 1, routeRef: 'RED', routeColour: '#BF0000', routeName: 'Red Line',
  waypoints: [[38.9, -77.0], [38.91, -77.01]],
  distances: [0, 1.5],
  totalDistance: 1.5,
  stops: [],
};

describe('getCachedRoutePaths', () => {
  it('returns null when table is empty', () => {
    mockPathRows = [];
    expect(getCachedRoutePaths()).toBeNull();
  });

  it('returns null when cache is stale', () => {
    mockPathRows = [{
      route_id: 1, route_ref: 'RED', route_colour: '#BF0000', route_name: 'Red Line',
      waypoints: '[]', distances: '[]', total_distance: 0, fetched_at: 0,
    }];
    vi.mocked(isCacheStale).mockReturnValue(true);
    expect(getCachedRoutePaths()).toBeNull();
  });

  it('deserialises waypoints and distances from JSON', () => {
    mockPathRows = [{
      route_id: 1, route_ref: 'RED', route_colour: '#BF0000', route_name: 'Red Line',
      waypoints: JSON.stringify(FAKE_PATH.waypoints),
      distances: JSON.stringify(FAKE_PATH.distances),
      total_distance: FAKE_PATH.totalDistance,
      fetched_at: NOW_SECS,
    }];
    const result = getCachedRoutePaths();
    expect(result).not.toBeNull();
    expect(result![0].routeId).toBe(1);
    expect(result![0].waypoints).toEqual(FAKE_PATH.waypoints);
    expect(result![0].distances).toEqual(FAKE_PATH.distances);
    expect(result![0].totalDistance).toBe(1.5);
  });

  it('returns multiple paths when several rows present', () => {
    mockPathRows = [
      {
        route_id: 1, route_ref: 'RED', route_colour: '#BF0000', route_name: 'Red Line',
        waypoints: '[]', distances: '[]', total_distance: 0, fetched_at: NOW_SECS,
      },
      {
        route_id: 2, route_ref: 'BLUE', route_colour: '#0074d9', route_name: 'Blue Line',
        waypoints: '[]', distances: '[]', total_distance: 0, fetched_at: NOW_SECS,
      },
    ];
    const result = getCachedRoutePaths();
    expect(result).toHaveLength(2);
  });
});

describe('upsertRoutePaths', () => {
  it('wraps operations in a transaction', () => {
    upsertRoutePaths([FAKE_PATH]);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ── Station passengers ────────────────────────────────────────────────────────

describe('getStationPassengers', () => {
  it('returns an empty map when table is empty', () => {
    mockPassengerRows = [];
    const result = getStationPassengers();
    expect(result.size).toBe(0);
  });

  it('returns station passenger data keyed by station name', () => {
    mockPassengerRows = [
      { station_name: 'Metro Center', capacity: 1200, current_passengers: 600, updated_at: NOW_SECS },
      { station_name: 'Bethesda', capacity: 800, current_passengers: 100, updated_at: NOW_SECS },
    ];
    const result = getStationPassengers();
    expect(result.size).toBe(2);
    expect(result.get('Metro Center')).toEqual({ capacity: 1200, current: 600 });
    expect(result.get('Bethesda')).toEqual({ capacity: 800, current: 100 });
  });
});

describe('upsertStationPassengers', () => {
  it('wraps operations in a transaction', () => {
    upsertStationPassengers([{ stationName: 'Metro Center', capacity: 1200, current: 400 }]);
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
