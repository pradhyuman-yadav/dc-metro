import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { subwayRoutesToGeoJSON, routePathsToGeoJSON } from '@/components/SubwayLayer';
import type { SubwayRoute } from '@/lib/overpass';
import type { RoutePath } from '@/lib/simulation';

// Mock leaflet so jsdom doesn't choke on canvas operations
vi.mock('leaflet', () => {
  const mockLayer = {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  };
  return {
    default: {
      canvas: vi.fn(() => ({})),
      geoJSON: vi.fn(() => mockLayer),
    },
  };
});

// Mock react-leaflet's useMap to return a fake map
vi.mock('react-leaflet', () => ({
  useMap: vi.fn(() => ({
    removeLayer: vi.fn(),
    addLayer: vi.fn(),
  })),
}));

const SAMPLE_ROUTES: SubwayRoute[] = [
  {
    id: 1,
    name: 'Red Line',
    ref: 'Red',
    colour: '#e51636',
    segments: [
      [[38.9, -77.0], [38.91, -77.01]],
      [[38.91, -77.01], [38.92, -77.02]],
    ],
  },
  {
    id: 2,
    name: 'Blue Line',
    ref: 'Blue',
    colour: '#0074d9',
    segments: [[[38.88, -77.05], [38.89, -77.06]]],
  },
];

describe('subwayRoutesToGeoJSON', () => {
  it('returns a FeatureCollection', () => {
    const fc = subwayRoutesToGeoJSON([]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(0);
  });

  it('creates one Feature per segment', () => {
    const fc = subwayRoutesToGeoJSON(SAMPLE_ROUTES);
    // Red has 2 segments, Blue has 1 → 3 features total
    expect(fc.features).toHaveLength(3);
  });

  it('each Feature is a LineString', () => {
    const fc = subwayRoutesToGeoJSON(SAMPLE_ROUTES);
    fc.features.forEach((f) => {
      expect(f.geometry.type).toBe('LineString');
    });
  });

  it('flips coordinates from [lat,lng] to [lng,lat] (GeoJSON order)', () => {
    const routes: SubwayRoute[] = [
      { id: 1, name: 'X', ref: 'X', colour: '#000', segments: [[[38.9, -77.0]]] },
    ];
    const fc = subwayRoutesToGeoJSON(routes);
    const coords = (fc.features[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[0]).toEqual([-77.0, 38.9]); // lng first
  });

  it('preserves colour in feature properties', () => {
    const fc = subwayRoutesToGeoJSON(SAMPLE_ROUTES);
    expect(fc.features[0].properties?.colour).toBe('#e51636');
    expect(fc.features[2].properties?.colour).toBe('#0074d9');
  });

  it('preserves name and ref in feature properties', () => {
    const fc = subwayRoutesToGeoJSON(SAMPLE_ROUTES);
    expect(fc.features[0].properties?.name).toBe('Red Line');
    expect(fc.features[0].properties?.ref).toBe('Red');
  });

  it('handles empty segments array gracefully', () => {
    const routes: SubwayRoute[] = [
      { id: 1, name: 'Ghost', ref: 'G', colour: '#aaa', segments: [] },
    ];
    const fc = subwayRoutesToGeoJSON(routes);
    expect(fc.features).toHaveLength(0);
  });
});

// ─── routePathsToGeoJSON ──────────────────────────────────────────────────────

const SAMPLE_PATHS: RoutePath[] = [
  {
    routeId: 1, routeRef: 'Red', routeColour: '#e51636', routeName: 'Red Line',
    waypoints: [[38.9, -77.0], [38.91, -77.01]],
    distances: [0, 1.5],
    totalDistance: 1.5,
    stops: [],
  },
  {
    routeId: 2, routeRef: 'Blue', routeColour: '#0074d9', routeName: 'Blue Line',
    waypoints: [[38.88, -77.05], [38.89, -77.06]],
    distances: [0, 1.2],
    totalDistance: 1.2,
    stops: [],
  },
];

describe('routePathsToGeoJSON', () => {
  it('returns a FeatureCollection', () => {
    const fc = routePathsToGeoJSON([]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(0);
  });

  it('creates one Feature per path (one LineString per route)', () => {
    const fc = routePathsToGeoJSON(SAMPLE_PATHS);
    expect(fc.features).toHaveLength(2);
  });

  it('each Feature is a LineString', () => {
    const fc = routePathsToGeoJSON(SAMPLE_PATHS);
    fc.features.forEach((f) => expect(f.geometry.type).toBe('LineString'));
  });

  it('flips coordinates from [lat,lng] to [lng,lat] (GeoJSON order)', () => {
    const fc = routePathsToGeoJSON([SAMPLE_PATHS[0]]);
    const coords = (fc.features[0].geometry as GeoJSON.LineString).coordinates;
    // waypoints[0] = [38.9, -77.0] → GeoJSON → [-77.0, 38.9]
    expect(coords[0]).toEqual([-77.0, 38.9]);
  });

  it('preserves colour, name, and ref in feature properties', () => {
    const fc = routePathsToGeoJSON(SAMPLE_PATHS);
    expect(fc.features[0].properties?.colour).toBe('#e51636');
    expect(fc.features[0].properties?.name).toBe('Red Line');
    expect(fc.features[0].properties?.ref).toBe('Red');
  });
});

// ─── SubwayLayer component ────────────────────────────────────────────────────

describe('SubwayLayer component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null (no DOM output)', async () => {
    const { default: SubwayLayer } = await import('@/components/SubwayLayer');
    const { container } = render(<SubwayLayer routes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders without crashing when routes are provided', async () => {
    const { default: SubwayLayer } = await import('@/components/SubwayLayer');
    expect(() => render(<SubwayLayer routes={SAMPLE_ROUTES} />)).not.toThrow();
  });

  it('renders nothing when routes array is empty', async () => {
    const { default: SubwayLayer } = await import('@/components/SubwayLayer');
    const { container } = render(<SubwayLayer routes={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
