import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DC_CENTER, DEFAULT_ZOOM, TILE_URL, TILE_ATTRIBUTION, TILE_SUBDOMAINS, TILE_MAX_ZOOM } from '@/components/MapInner';

vi.mock('leaflet/dist/leaflet.css', () => ({}));

// Subway/station/train layers and hooks tested in their own files
vi.mock('@/components/SubwayLayer', () => ({ default: () => null }));
vi.mock('@/components/StationLayer', () => ({ default: () => null }));
vi.mock('@/components/TrainLayer', () => ({ default: () => null }));
vi.mock('@/hooks/useSubwayRoutes', () => ({
  useSubwayRoutes: () => ({ routes: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useSubwayStations', () => ({
  useSubwayStations: () => ({ stations: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useSimulation', () => ({
  useSimulation: () => ({ trainsRef: { current: [] }, pathsMap: new Map() }),
}));

const mockTileLayer = vi.fn(() => null);
const mockMapContainer = vi.fn(({ children }: { children: React.ReactNode }) => (
  <div data-testid="map-container">{children}</div>
));

vi.mock('react-leaflet', () => ({
  MapContainer: (props: unknown) => mockMapContainer(props),
  TileLayer: (props: unknown) => mockTileLayer(props),
}));

const { default: MapInner } = await import('@/components/MapInner');

describe('MapInner', () => {
  beforeEach(() => {
    mockMapContainer.mockClear();
    mockTileLayer.mockClear();
  });

  it('renders the map container', () => {
    render(<MapInner />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('centers on Washington DC coordinates', () => {
    render(<MapInner />);
    const [lat, lng] = mockMapContainer.mock.calls[0][0].center;
    expect(lat).toBeCloseTo(38.9072, 3);
    expect(lng).toBeCloseTo(-77.0369, 3);
  });

  it('uses zoom level 12 by default', () => {
    render(<MapInner />);
    expect(mockMapContainer.mock.calls[0][0].zoom).toBe(12);
  });

  it('uses CartoDB Positron tile URL', () => {
    render(<MapInner />);
    expect(mockTileLayer.mock.calls[0][0].url).toContain('basemaps.cartocdn.com/light_all');
  });

  it('includes OpenStreetMap attribution', () => {
    render(<MapInner />);
    expect(mockTileLayer.mock.calls[0][0].attribution).toContain('OpenStreetMap');
  });

  it('includes CARTO attribution', () => {
    render(<MapInner />);
    expect(mockTileLayer.mock.calls[0][0].attribution).toContain('CARTO');
  });

  it('uses abcd subdomains', () => {
    render(<MapInner />);
    expect(mockTileLayer.mock.calls[0][0].subdomains).toBe('abcd');
  });

  it('allows max zoom of 20', () => {
    render(<MapInner />);
    expect(mockTileLayer.mock.calls[0][0].maxZoom).toBe(20);
  });
});

describe('DC_CENTER constant', () => {
  it('is latitude ~38.9 (Washington DC)', () => {
    expect(DC_CENTER[0]).toBeCloseTo(38.9072, 3);
  });

  it('is longitude ~-77.0 (Washington DC)', () => {
    expect(DC_CENTER[1]).toBeCloseTo(-77.0369, 3);
  });

  it('lat is within DC bounding box (38.8 – 39.0)', () => {
    expect(DC_CENTER[0]).toBeGreaterThan(38.8);
    expect(DC_CENTER[0]).toBeLessThan(39.0);
  });

  it('lng is within DC bounding box (-77.2 – -76.9)', () => {
    expect(DC_CENTER[1]).toBeGreaterThan(-77.2);
    expect(DC_CENTER[1]).toBeLessThan(-76.9);
  });
});

describe('Tile constants (CartoDB Positron / Silver style)', () => {
  it('TILE_URL points to CartoDB light_all', () => {
    expect(TILE_URL).toContain('basemaps.cartocdn.com/light_all');
  });

  it('TILE_URL is a valid tile template with {z}/{x}/{y}', () => {
    expect(TILE_URL).toMatch(/\{z\}.*\{x\}.*\{y\}/);
  });

  it('TILE_ATTRIBUTION credits OpenStreetMap', () => {
    expect(TILE_ATTRIBUTION).toContain('OpenStreetMap');
  });

  it('TILE_ATTRIBUTION credits CARTO', () => {
    expect(TILE_ATTRIBUTION).toContain('CARTO');
  });

  it('TILE_SUBDOMAINS is "abcd"', () => {
    expect(TILE_SUBDOMAINS).toBe('abcd');
  });

  it('TILE_MAX_ZOOM is 20', () => {
    expect(TILE_MAX_ZOOM).toBe(20);
  });
});

describe('DEFAULT_ZOOM constant', () => {
  it('is 12', () => {
    expect(DEFAULT_ZOOM).toBe(12);
  });

  it('is a city-level zoom (between 10 and 15)', () => {
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(15);
  });
});
