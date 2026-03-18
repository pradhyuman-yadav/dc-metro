import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { _clearCache, useSubwayRoutes } from '@/hooks/useSubwayRoutes';
import type { SubwayRoute } from '@/lib/overpass';
import { DC_BBOX } from '@/lib/overpass';

const FAKE_ROUTES: SubwayRoute[] = [
  {
    id: 1,
    name: 'Red Line',
    ref: 'Red',
    colour: '#e51636',
    segments: [[[38.9, -77.0], [38.91, -77.01]]],
  },
];

function mockFetch(routes: SubwayRoute[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ routes, cached: true, fetchedAt: 0 }),
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
  _clearCache();
});

afterEach(() => {
  _clearCache();
  vi.unstubAllGlobals();
});

describe('useSubwayRoutes', () => {
  it('starts in loading state', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderHook(() => useSubwayRoutes());
    expect(result.current.loading).toBe(true);
    expect(result.current.routes).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('returns routes on success', async () => {
    mockFetch(FAKE_ROUTES);
    const { result } = renderHook(() => useSubwayRoutes());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routes).toEqual(FAKE_ROUTES);
    expect(result.current.error).toBeNull();
  });

  it('sets error on non-ok API response', async () => {
    mockFetchError(502);
    const { result } = renderHook(() => useSubwayRoutes());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.routes).toHaveLength(0);
  });

  it('uses the session cache on second call with same bbox', async () => {
    mockFetch(FAKE_ROUTES);

    const { result: r1 } = renderHook(() => useSubwayRoutes(DC_BBOX));
    await waitFor(() => expect(r1.current.loading).toBe(false));

    const { result: r2 } = renderHook(() => useSubwayRoutes(DC_BBOX));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(r2.current.routes).toEqual(FAKE_ROUTES);
  });

  it('fetches again when bbox changes', async () => {
    const OTHER_BBOX: [number, number, number, number] = [39.0, -77.5, 39.2, -77.2];
    mockFetch(FAKE_ROUTES);

    const { result: r1 } = renderHook(() => useSubwayRoutes(DC_BBOX));
    await waitFor(() => expect(r1.current.loading).toBe(false));

    const { result: r2 } = renderHook(() => useSubwayRoutes(OTHER_BBOX));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('_clearCache resets the session cache', async () => {
    mockFetch(FAKE_ROUTES);

    const { result: r1 } = renderHook(() => useSubwayRoutes(DC_BBOX));
    await waitFor(() => expect(r1.current.loading).toBe(false));

    _clearCache();

    const { result: r2 } = renderHook(() => useSubwayRoutes(DC_BBOX));
    await waitFor(() => expect(r2.current.loading).toBe(false));

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
