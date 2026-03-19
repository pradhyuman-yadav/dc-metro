import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { getTrainSize, MIN_TRAIN_ZOOM, darkenColour } from '@/components/TrainLayer';
import type { MutableRefObject } from 'react';
import type { TrainState, RoutePath } from '@/lib/simulation';

// ── Mock react-leaflet ────────────────────────────────────────────────────────
const overlayPane = document.createElement('div');
const mapPane     = document.createElement('div');
const trainPane   = document.createElement('div');

// Chainable Point stub
function makePoint(x = 0, y = 0): Record<string, unknown> {
  const pt: Record<string, unknown> = {
    x, y,
    subtract: vi.fn(() => makePoint(0, 0)),
    add:      vi.fn(() => makePoint(0, 0)),
    divideBy: vi.fn(() => makePoint(0, 0)),
    round:    vi.fn(() => makePoint(0, 0)),
  };
  return pt;
}

vi.mock('react-leaflet', () => ({
  useMap: () => ({
    getPanes: vi.fn(() => ({ overlayPane, mapPane })),
    getPane:    vi.fn((name: string) => name === 'trainPane' ? trainPane : undefined),
    createPane: vi.fn(() => { trainPane.style.zIndex = ''; return trainPane; }),
    getSize:  vi.fn(() => makePoint(800, 600)),
    getZoom:  vi.fn(() => 12),
    getZoomScale: vi.fn(() => 2),
    containerPointToLayerPoint: vi.fn(() => makePoint(0, 0)),
    containerPointToLatLng: vi.fn(() => ({ lat: 38.9, lng: -77.0 })),
    latLngToLayerPoint: vi.fn(() => makePoint(100, 100)),
    project: vi.fn(() => makePoint(100, 100)),
    on:  vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('leaflet', () => ({
  default: {
    latLng:  vi.fn((lat: number, lng: number) => ({ lat, lng })),
    point:   vi.fn((x: number, y: number)     => makePoint(x, y)),
    DomUtil: {
      setPosition:  vi.fn(),
      setTransform: vi.fn(),
      getPosition:  vi.fn(() => makePoint(0, 0)),
    },
  },
  latLng:  vi.fn((lat: number, lng: number) => ({ lat, lng })),
  point:   vi.fn((x: number, y: number)     => makePoint(x, y)),
  DomUtil: {
    setPosition:  vi.fn(),
    setTransform: vi.fn(),
    getPosition:  vi.fn(() => makePoint(0, 0)),
  },
}));

vi.mock('@/lib/simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/simulation')>();
  return {
    ...actual,
    getTrainLatLng:        vi.fn(() => [38.9, -77.0] as [number, number]),
    getTrainSegmentBearing: vi.fn(() => 0),
  };
});

const makePath = (id: number): RoutePath => ({
  routeId: id, routeRef: 'RED', routeColour: '#BF0000', routeName: 'Red Line',
  waypoints: [[38.9, -77.0], [38.91, -77.01]], distances: [0, 1], totalDistance: 1, stops: [],
});

const makeTrain = (id: string, routeId: number): TrainState => ({
  id, routeId, routeRef: 'RED', routeColour: '#BF0000', routeName: 'Red Line',
  distanceTravelled: 0.5, direction: 1, status: 'moving', currentStation: null,
  platform: 'A', dwellRemaining: 0, partnerRouteId: null,
});

// Dynamic import after mocks are set up
const { default: TrainLayer } = await import('@/components/TrainLayer');

// ─── MIN_TRAIN_ZOOM ───────────────────────────────────────────────────────────

describe('MIN_TRAIN_ZOOM', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(MIN_TRAIN_ZOOM)).toBe(true);
    expect(MIN_TRAIN_ZOOM).toBeGreaterThan(0);
  });

  it('is less than the typical max zoom (20)', () => {
    expect(MIN_TRAIN_ZOOM).toBeLessThan(20);
  });
});

// ─── getTrainSize ─────────────────────────────────────────────────────────────

describe('getTrainSize', () => {
  it('returns positive width and height at zoom 12', () => {
    const { w, h } = getTrainSize(12);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('height is greater than width (train is longer than wide)', () => {
    const { w, h } = getTrainSize(12);
    expect(h).toBeGreaterThan(w);
  });

  it('size increases with zoom level', () => {
    const s12 = getTrainSize(12);
    const s15 = getTrainSize(15);
    expect(s15.h).toBeGreaterThan(s12.h);
    expect(s15.w).toBeGreaterThan(s12.w);
  });

  it('caps at a maximum size at very high zoom', () => {
    const s20 = getTrainSize(20);
    expect(s20.w).toBeLessThanOrEqual(22);
    expect(s20.h).toBeLessThanOrEqual(60);
  });

  it('stays at base size below zoom 12', () => {
    const s10 = getTrainSize(10);
    const s12 = getTrainSize(12);
    expect(s10.w).toBe(s12.w);
    expect(s10.h).toBe(s12.h);
  });
});

// ─── darkenColour ─────────────────────────────────────────────────────────────

describe('darkenColour', () => {
  it('returns a valid hex string', () => {
    expect(darkenColour('#BF0000', 0.6)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns #000000 for white at factor 0', () => {
    expect(darkenColour('#ffffff', 0)).toBe('#000000');
  });

  it('returns the same colour at factor 1', () => {
    expect(darkenColour('#BF0000', 1)).toBe('#bf0000');
  });

  it('darkens each channel proportionally', () => {
    // #BF0000 → R=0xBF=191, factor=0.5 → R=95=0x5F
    const result = darkenColour('#BF0000', 0.5);
    const r = parseInt(result.slice(1, 3), 16);
    expect(r).toBe(Math.round(0xBF * 0.5));
  });

  it('handles 3-digit shorthand hex (#RGB)', () => {
    // #fff expanded = #ffffff, factor=0.5 → #7f7f7f
    const result = darkenColour('#fff', 0.5);
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
    const r = parseInt(result.slice(1, 3), 16);
    expect(r).toBe(Math.round(0xff * 0.5));
  });

  it('does not exceed 255 per channel', () => {
    const result = darkenColour('#ffffff', 2);
    const r = parseInt(result.slice(1, 3), 16);
    const g = parseInt(result.slice(3, 5), 16);
    const b = parseInt(result.slice(5, 7), 16);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
  });
});

// ─── TrainLayer component ─────────────────────────────────────────────────────

describe('TrainLayer', () => {
  it('returns null (canvas is attached imperatively, not via JSX)', () => {
    const trainsRef: MutableRefObject<TrainState[]> = { current: [] };
    const { container } = render(
      <TrainLayer trainsRef={trainsRef} pathsMap={new Map()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('mounts without error when trains are present', () => {
    const pathsMap = new Map([[1, makePath(1)]]);
    const trainsRef: MutableRefObject<TrainState[]> = {
      current: [makeTrain('RED-1', 1)],
    };
    expect(() =>
      render(<TrainLayer trainsRef={trainsRef} pathsMap={pathsMap} />)
    ).not.toThrow();
  });
});
