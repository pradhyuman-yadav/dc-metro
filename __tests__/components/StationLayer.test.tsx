import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MIN_STATION_ZOOM } from '@/components/StationLayer';
import type { SubwayStation } from '@/lib/overpass';
import { SUBWAY_COLOUR_FALLBACK } from '@/lib/overpass';

// Capture useMapEvents handler so tests can trigger zoom events
let capturedZoomHandler: ((e: { target: { getZoom: () => number } }) => void) | null = null;

vi.mock('react-leaflet', () => ({
  // Support both direct fillColor prop and pathOptions object (react-leaflet v4 style)
  CircleMarker: vi.fn(({ children, pathOptions }: {
    children?: React.ReactNode;
    pathOptions?: { fillColor?: string; color?: string };
  }) => (
    <div data-testid="circle-marker" data-fill={pathOptions?.fillColor ?? pathOptions?.color}>{children}</div>
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
  it('renders three CircleMarkers per station (bg ring + progress arc + inner dot)', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} stationPassengers={new Map()} />);
    // 3 stations × 3 markers each = 9 total
    expect(screen.getAllByTestId('circle-marker')).toHaveLength(9);
  });

  it('renders nothing when stations array is empty', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    const { container } = render(<StationLayer stations={[]} stationPassengers={new Map()} />);
    expect(container.firstChild).toBeNull();
  });

  it('progress arc markers use green (#22c55e) at 0% load', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} stationPassengers={new Map()} />);
    const markers = screen.getAllByTestId('circle-marker');
    // Pass 1 = bg rings (indices 0-2), Pass 2 = progress arcs (indices 3-5)
    expect(markers[3].dataset.fill).toBe('#22c55e');
    expect(markers[4].dataset.fill).toBe('#22c55e');
    expect(markers[5].dataset.fill).toBe('#22c55e');
  });

  it('inner dot markers use colours[0] as fillColor', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} stationPassengers={new Map()} />);
    const markers = screen.getAllByTestId('circle-marker');
    // Pass 3 = inner dots (indices 6-8)
    expect(markers[6].dataset.fill).toBe('#e51636');
    expect(markers[7].dataset.fill).toBe('#0074d9');
  });

  it('falls back to SUBWAY_COLOUR_FALLBACK when colours is empty', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} stationPassengers={new Map()} />);
    const markers = screen.getAllByTestId('circle-marker');
    // Ghost Station is the third inner dot (index 8)
    expect(markers[8].dataset.fill).toBe(SUBWAY_COLOUR_FALLBACK);
  });

  it('renders a Tooltip containing station name', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={[SAMPLE_STATIONS[0]]} stationPassengers={new Map()} />);
    expect(screen.getByText(/Metro Center/)).toBeInTheDocument();
  });
});

describe('MIN_STATION_ZOOM', () => {
  it('is 11', () => {
    expect(MIN_STATION_ZOOM).toBe(11);
  });
});
