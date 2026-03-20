import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MIN_STATION_ZOOM } from '@/components/StationLayer';
import type { SubwayStation } from '@/lib/overpass';
import { SUBWAY_COLOUR_FALLBACK } from '@/lib/overpass';

// Capture useMapEvents handler so tests can trigger zoom events
let capturedZoomHandler: ((e: { target: { getZoom: () => number } }) => void) | null = null;

vi.mock('react-leaflet', () => ({
  CircleMarker: vi.fn(({ children, fillColor }: { children: React.ReactNode; fillColor: string }) => (
    <div data-testid="circle-marker" data-fill={fillColor}>{children}</div>
  )),
  Tooltip: vi.fn(({ children }: { children: React.ReactNode }) => <span>{children}</span>),
  useMapEvents: vi.fn((handlers: { zoom?: (e: { target: { getZoom: () => number } }) => void }) => {
    capturedZoomHandler = handlers.zoom ?? null;
    return null;
  }),
}));

const SAMPLE_STATIONS: SubwayStation[] = [
  { id: 1, name: 'Metro Center', lat: 38.898, lng: -77.028, colours: ['#e51636', '#0074d9'] },
  { id: 2, name: 'Foggy Bottom', lat: 38.9, lng: -77.05, colours: ['#0074d9'] },
  { id: 3, name: 'Ghost Station', lat: 38.85, lng: -77.1, colours: [] },
];

beforeEach(() => {
  capturedZoomHandler = null;
  vi.clearAllMocks();
});

describe('StationLayer', () => {
  it('renders two CircleMarkers per station (outer ring + inner dot)', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    // 3 stations × 2 markers each = 6 total
    expect(screen.getAllByTestId('circle-marker')).toHaveLength(6);
  });

  it('renders nothing when stations array is empty', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    const { container } = render(<StationLayer stations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('outer ring markers are all black (#111111)', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    const markers = screen.getAllByTestId('circle-marker');
    // First N markers are the outer rings (painted first)
    expect(markers[0].dataset.fill).toBe('#111111');
    expect(markers[1].dataset.fill).toBe('#111111');
    expect(markers[2].dataset.fill).toBe('#111111');
  });

  it('inner dot markers use colours[0] as fillColor', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    const markers = screen.getAllByTestId('circle-marker');
    // Inner dots follow the outer rings (indices N..2N-1)
    expect(markers[3].dataset.fill).toBe('#e51636');
    expect(markers[4].dataset.fill).toBe('#0074d9');
  });

  it('falls back to SUBWAY_COLOUR_FALLBACK when colours is empty', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    const markers = screen.getAllByTestId('circle-marker');
    // Ghost Station is the third inner dot (index 5)
    expect(markers[5].dataset.fill).toBe(SUBWAY_COLOUR_FALLBACK);
  });

  it('renders a Tooltip with station name', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={[SAMPLE_STATIONS[0]]} />);
    expect(screen.getByText('Metro Center')).toBeInTheDocument();
  });
});

describe('MIN_STATION_ZOOM', () => {
  it('is 11', () => {
    expect(MIN_STATION_ZOOM).toBe(11);
  });
});
