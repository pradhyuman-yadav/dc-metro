import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { _clearStationCache, useSubwayStations } from '@/hooks/useSubwayStations';
import type { SubwayStation } from '@/lib/overpass';
import { DC_BBOX } from '@/lib/overpass';

const FAKE_STATIONS: SubwayStation[] = [
  { id: 101, name: 'Metro Center', lat: 38.898, lng: -77.028, colours: ['#e51636'] },
];

function mockFetch(stations: SubwayStation[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ stations, cached: true, fetchedAt: 0 }),
  }));
}

function mockFetchError(status = 500) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: 'error' }),
  }));
}

beforeEach(() => {
  _clearStationCache();
});

afterEach(() => {
  _clearStationCache();
  vi.unstubAllGlobals();
});

describe('useSubwayStations', () => {
  it('starts in loading state', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderHook(() => useSubwayStations());
    expect(result.current.loading).toBe(true);
    expect(result.current.stations).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('returns stations on success', async () => {
    mockFetch(FAKE_STATIONS);
    const { result } = renderHook(() => useSubwayStations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stations).toEqual(FAKE_STATIONS);
    expect(result.current.error).toBeNull();
  });

  it('sets error on non-ok response', async () => {
    mockFetchError(502);
    const { result } = renderHook(() => useSubwayStations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.stations).toHaveLength(0);
  });

  it('uses session cache on second call with same bbox', async () => {
    mockFetch(FAKE_STATIONS);
    const { result: r1 } = renderHook(() => useSubwayStations(DC_BBOX));
    await waitFor(() => expect(r1.current.loading).toBe(false));

    const { result: r2 } = renderHook(() => useSubwayStations(DC_BBOX));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(r2.current.stations).toEqual(FAKE_STATIONS);
  });

  it('_clearStationCache resets the session cache', async () => {
    mockFetch(FAKE_STATIONS);
    const { result: r1 } = renderHook(() => useSubwayStations(DC_BBOX));
    await waitFor(() => expect(r1.current.loading).toBe(false));

    _clearStationCache();

    const { result: r2 } = renderHook(() => useSubwayStations(DC_BBOX));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
