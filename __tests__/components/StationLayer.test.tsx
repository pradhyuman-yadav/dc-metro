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
  it('renders one CircleMarker per station', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    expect(screen.getAllByTestId('circle-marker')).toHaveLength(3);
  });

  it('renders nothing when stations array is empty', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    const { container } = render(<StationLayer stations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('uses colours[0] as fillColor', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    const markers = screen.getAllByTestId('circle-marker');
    expect(markers[0].dataset.fill).toBe('#e51636');
    expect(markers[1].dataset.fill).toBe('#0074d9');
  });

  it('falls back to SUBWAY_COLOUR_FALLBACK when colours is empty', async () => {
    const { default: StationLayer } = await import('@/components/StationLayer');
    render(<StationLayer stations={SAMPLE_STATIONS} />);
    const markers = screen.getAllByTestId('circle-marker');
    expect(markers[2].dataset.fill).toBe(SUBWAY_COLOUR_FALLBACK);
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
