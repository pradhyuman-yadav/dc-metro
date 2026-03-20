import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSubwayColour,
  buildSubwayQuery,
  parseSubwayResponse,
  fetchSubwayRoutes,
  buildStationQuery,
  parseStationResponse,
  fetchSubwayStations,
  DC_BBOX,
  SUBWAY_COLOUR_FALLBACK,
  EXCLUDED_RELATION_IDS,
  type OverpassResponse,
} from '@/lib/overpass';

// ─── getSubwayColour ───────────────────────────────────────────────────────────

describe('getSubwayColour', () => {
  it('returns a valid 6-digit hex tag colour', () => {
    expect(getSubwayColour('#BF0000')).toBe('#BF0000');
  });

  it('returns a valid 3-digit hex tag colour', () => {
    expect(getSubwayColour('#F00')).toBe('#F00');
  });

  it('rejects non-hex colour strings and returns fallback', () => {
    expect(getSubwayColour('red')).toBe(SUBWAY_COLOUR_FALLBACK);
  });

  it('returns fallback when no colour provided', () => {
    expect(getSubwayColour()).toBe(SUBWAY_COLOUR_FALLBACK);
  });
});

// ─── buildSubwayQuery ─────────────────────────────────────────────────────────

describe('buildSubwayQuery', () => {
  it('filters to route=subway only', () => {
    expect(buildSubwayQuery()).toContain('"route"="subway"');
  });

  it('does not include bus or tram in the query', () => {
    const q = buildSubwayQuery();
    expect(q).not.toContain('bus');
    expect(q).not.toContain('tram');
  });

  it('includes the DC bbox by default', () => {
    const q = buildSubwayQuery();
    expect(q).toContain('38.76');
    expect(q).toContain('-77.55');
  });

  it('accepts a custom bbox', () => {
    const q = buildSubwayQuery([38.1, -78.2, 40.3, -76.4]);
    expect(q).toContain('38.1,-78.2,40.3,-76.4');
  });

  it('requests JSON output with geometry', () => {
    const q = buildSubwayQuery();
    expect(q).toContain('[out:json]');
    expect(q).toContain('out geom');
  });
});

// ─── parseSubwayResponse ──────────────────────────────────────────────────────

const MOCK_RESPONSE: OverpassResponse = {
  elements: [
    {
      type: 'relation', id: 1,
      tags: { name: 'Red Line', ref: 'RED', route: 'subway', colour: '#BF0000' },
      members: [
        { type: 'way', geometry: [{ lat: 38.90, lon: -77.03 }, { lat: 38.91, lon: -77.02 }] },
        { type: 'way', geometry: [{ lat: 38.91, lon: -77.02 }, { lat: 38.92, lon: -77.01 }] },
      ],
    },
    {
      type: 'relation', id: 2,
      tags: { name: 'Blue Line', route: 'subway' },
      members: [
        { type: 'way', geometry: [{ lat: 38.85, lon: -77.05 }, { lat: 38.86, lon: -77.04 }] },
      ],
    },
    // relation with no tags — should be ignored
    { type: 'relation', id: 3 },
    // relation with no valid way geometry — should be filtered
    {
      type: 'relation', id: 4,
      tags: { route: 'subway' },
      members: [{ type: 'node' }],
    },
  ],
};

describe('parseSubwayResponse', () => {
  it('returns one route per valid relation', () => {
    expect(parseSubwayResponse(MOCK_RESPONSE)).toHaveLength(2);
  });

  it('extracts name correctly', () => {
    expect(parseSubwayResponse(MOCK_RESPONSE)[0].name).toBe('Red Line');
  });

  it('extracts ref correctly', () => {
    expect(parseSubwayResponse(MOCK_RESPONSE)[0].ref).toBe('RED');
  });

  it('uses OSM colour tag when valid', () => {
    expect(parseSubwayResponse(MOCK_RESPONSE)[0].colour).toBe('#BF0000');
  });

  it('uses fallback colour when no colour tag', () => {
    expect(parseSubwayResponse(MOCK_RESPONSE)[1].colour).toBe(SUBWAY_COLOUR_FALLBACK);
  });

  it('converts geometry to [lat, lng] segments', () => {
    const seg = parseSubwayResponse(MOCK_RESPONSE)[0].segments[0];
    expect(seg[0]).toEqual([38.90, -77.03]);
  });

  it('creates one segment per way member', () => {
    expect(parseSubwayResponse(MOCK_RESPONSE)[0].segments).toHaveLength(2);
  });

  it('filters out relations with no valid segments', () => {
    const routes = parseSubwayResponse(MOCK_RESPONSE);
    expect(routes.find(r => r.id === 4)).toBeUndefined();
  });
});

// ─── EXCLUDED_RELATION_IDS ────────────────────────────────────────────────────

describe('EXCLUDED_RELATION_IDS', () => {
  it('contains the four known legacy relation IDs', () => {
    expect(EXCLUDED_RELATION_IDS.has(3031441)).toBe(true); // Silver: Downtown Largo → Ashburn
    expect(EXCLUDED_RELATION_IDS.has(7919736)).toBe(true); // Silver: Ashburn → Downtown Largo
    expect(EXCLUDED_RELATION_IDS.has(918503)).toBe(true);  // Yellow: Mount Vernon Square → Huntington
    expect(EXCLUDED_RELATION_IDS.has(7572166)).toBe(true); // Yellow: Huntington → Mount Vernon Square
  });

  it('does not exclude known-good current IDs', () => {
    // Current Silver Line relations
    expect(EXCLUDED_RELATION_IDS.has(19274066)).toBe(false);
    expect(EXCLUDED_RELATION_IDS.has(19274067)).toBe(false);
    // Current Yellow Line relations
    expect(EXCLUDED_RELATION_IDS.has(20048303)).toBe(false);
    expect(EXCLUDED_RELATION_IDS.has(20048304)).toBe(false);
  });
});

describe('parseSubwayResponse — exclusion filter', () => {
  it('filters out relations whose IDs are in EXCLUDED_RELATION_IDS', () => {
    const response: OverpassResponse = {
      elements: [
        {
          type: 'relation', id: 3031441, // Silver Line legacy
          tags: { name: 'WMATA Silver Line', ref: 'S', route: 'subway', colour: '#919D9D' },
          members: [
            { type: 'way', geometry: [{ lat: 38.90, lon: -77.03 }, { lat: 38.91, lon: -77.02 }] },
          ],
        },
        {
          type: 'relation', id: 19274066, // Silver Line current — must be kept
          tags: { name: 'WMATA Silver Line', ref: 'S', route: 'subway', colour: '#919D9D' },
          members: [
            { type: 'way', geometry: [{ lat: 38.90, lon: -77.03 }, { lat: 38.91, lon: -77.02 }] },
          ],
        },
      ],
    };
    const routes = parseSubwayResponse(response);
    expect(routes).toHaveLength(1);
    expect(routes[0].id).toBe(19274066);
  });

  it('filters all four legacy IDs when present', () => {
    const makeRelation = (id: number) => ({
      type: 'relation' as const, id,
      tags: { name: 'Test', route: 'subway', colour: '#AAAAAA' },
      members: [
        { type: 'way', geometry: [{ lat: 38.9, lon: -77.0 }, { lat: 38.91, lon: -77.01 }] },
      ],
    });
    const response: OverpassResponse = {
      elements: [918503, 3031441, 7572166, 7919736].map(makeRelation),
    };
    expect(parseSubwayResponse(response)).toHaveLength(0);
  });
});

describe('parseStationResponse — exclusion filter', () => {
  it('ignores colour contributions from excluded legacy relations', () => {
    const response: OverpassResponse = {
      elements: [
        node(101, 38.898, -77.028, 'Metro Center'),
        // Legacy relation referencing Metro Center — its colour must NOT appear
        {
          type: 'relation' as const, id: 3031441,
          tags: { name: 'Silver Line legacy', route: 'subway', colour: '#919D9D' },
          members: [{ type: 'node', ref: 101, role: 'stop' }],
        } as unknown as OverpassResponse['elements'][0],
        // Current relation referencing Metro Center — its colour MUST appear
        {
          type: 'relation' as const, id: 19274066,
          tags: { name: 'Silver Line current', route: 'subway', colour: '#919D9D' },
          members: [{ type: 'node', ref: 101, role: 'stop' }],
        } as unknown as OverpassResponse['elements'][0],
      ],
    };
    // Both relations have the same colour, so test with a distinct legacy colour
    const response2: OverpassResponse = {
      elements: [
        node(101, 38.898, -77.028, 'Metro Center'),
        {
          type: 'relation' as const, id: 3031441,
          tags: { name: 'Silver Line legacy', route: 'subway', colour: '#ABCDEF' }, // fake unique colour
          members: [{ type: 'node', ref: 101, role: 'stop' }],
        } as unknown as OverpassResponse['elements'][0],
      ],
    };
    const stations = parseStationResponse(response2);
    const mc = stations.find((s) => s.name === 'Metro Center');
    // The fake legacy colour must not be added
    expect(mc?.colours).not.toContain('#ABCDEF');
  });
});

// ─── fetchSubwayRoutes ────────────────────────────────────────────────────────

describe('fetchSubwayRoutes', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('calls the Overpass API', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => ({ elements: [] }),
    });
    await fetchSubwayRoutes();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('URL contains overpass-api.de', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => ({ elements: [] }),
    });
    await fetchSubwayRoutes();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('overpass-api.de');
  });

  it('returns parsed routes on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => MOCK_RESPONSE,
    });
    const routes = await fetchSubwayRoutes();
    expect(routes).toHaveLength(2);
  });

  it('throws on non-OK HTTP response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(fetchSubwayRoutes()).rejects.toThrow('Overpass API error: 429');
  });
});

// ─── buildStationQuery ────────────────────────────────────────────────────────

describe('buildStationQuery', () => {
  it('finds stations via route-relation member roles', () => {
    const q = buildStationQuery();
    expect(q).toContain('node(r.routes:"stop")');
    expect(q).toContain('node(r.routes:"stop_entry_only")');
    expect(q).toContain('node(r.routes:"stop_exit_only")');
  });

  it('also fetches station=subway nodes to cover lines with incomplete relations', () => {
    // Some WMATA lines (Orange, Blue) store stops as nested stop_area sub-relations
    // or way members rather than bare "stop"-role nodes, so relation-member queries
    // miss them. Fetching station=subway nodes covers all WMATA stations.
    expect(buildStationQuery()).toContain('"station"="subway"');
  });

  it('filters route relations to subway only', () => {
    expect(buildStationQuery()).toContain('"route"="subway"');
  });

  it('includes the DC bbox by default', () => {
    const q = buildStationQuery();
    expect(q).toContain('38.76');
    expect(q).toContain('-77.55');
  });

  it('accepts a custom bbox', () => {
    const q = buildStationQuery([38.1, -78.2, 40.3, -76.4]);
    expect(q).toContain('38.1,-78.2,40.3,-76.4');
  });

  it('returns both stop nodes and route relations', () => {
    const q = buildStationQuery();
    expect(q).toContain('.stops');
    expect(q).toContain('.routes');
  });
});

// ─── parseStationResponse ─────────────────────────────────────────────────────

const node = (id: number, lat: number, lon: number, name?: string) => ({
  type: 'node' as const, id, lat, lon,
  tags: name ? { name } : {},
} as unknown as OverpassResponse['elements'][0]);

const rel = (id: number, colour: string, memberIds: number[]) => ({
  type: 'relation' as const, id,
  tags: { name: 'Test Line', route: 'subway', colour },
  members: memberIds.map((ref) => ({ type: 'node', ref, role: 'stop' })),
} as unknown as OverpassResponse['elements'][0]);

const STATION_RESPONSE: OverpassResponse = {
  elements: [
    node(101, 38.898, -77.028, 'Metro Center'),
    node(102, 38.9,   -77.05,  'Farragut North'),
    node(103, 38.91,  -77.06),            // no name → skipped
    rel(201, '#e51636', [101]),
  ],
};

describe('parseStationResponse', () => {
  it('returns only named nodes (unnamed entrance nodes are skipped)', () => {
    expect(parseStationResponse(STATION_RESPONSE)).toHaveLength(2);
  });

  it('extracts lat/lng correctly', () => {
    const stations = parseStationResponse(STATION_RESPONSE);
    const mc = stations.find((s) => s.name === 'Metro Center')!;
    expect(mc.lat).toBe(38.898);
    expect(mc.lng).toBe(-77.028);
  });

  it('extracts station name from tag', () => {
    const stations = parseStationResponse(STATION_RESPONSE);
    expect(stations.map((s) => s.name)).toContain('Metro Center');
  });

  it('skips nodes that have no name tag', () => {
    const stations = parseStationResponse(STATION_RESPONSE);
    expect(stations.every((s) => s.name !== 'Unknown Station')).toBe(true);
  });

  it('attaches line colour from parent relation member', () => {
    const stations = parseStationResponse(STATION_RESPONSE);
    const mc = stations.find((s) => s.id === 101);
    expect(mc?.colours).toContain('#e51636');
  });

  it('has empty colours for a named node not referenced by any relation', () => {
    const stations = parseStationResponse(STATION_RESPONSE);
    const fn = stations.find((s) => s.name === 'Farragut North');
    expect(fn?.colours).toHaveLength(0);
  });

  it('deduplicates nodes with the same OSM id', () => {
    // Same node returned twice (Overpass role-union edge case)
    const response: OverpassResponse = {
      elements: [
        node(101, 38.898, -77.028, 'Metro Center'),
        node(101, 38.898, -77.028, 'Metro Center'), // duplicate
        rel(201, '#e51636', [101]),
      ],
    };
    expect(parseStationResponse(response)).toHaveLength(1);
  });

  it('collapses same-name nodes and merges their colours', () => {
    // Metro Center: separate OSM nodes per platform level, same name
    const response: OverpassResponse = {
      elements: [
        node(101, 38.898, -77.028, 'Metro Center'), // Red Line platform
        node(102, 38.898, -77.028, 'Metro Center'), // Blue/Orange/Silver platform
        rel(201, '#BF0000', [101]), // Red Line
        rel(202, '#0076A8', [102]), // Blue Line
      ],
    };
    const stations = parseStationResponse(response);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Metro Center');
    expect(stations[0].colours).toContain('#BF0000');
    expect(stations[0].colours).toContain('#0076A8');
  });
});

// ─── fetchSubwayStations ──────────────────────────────────────────────────────

describe('fetchSubwayStations', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('calls the Overpass API', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => ({ elements: [] }),
    });
    await fetchSubwayStations();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('URL contains overpass-api.de', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: async () => ({ elements: [] }),
    });
    await fetchSubwayStations();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('overpass-api.de');
  });

  it('throws on non-OK HTTP response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchSubwayStations()).rejects.toThrow('Overpass API error: 503');
  });
});
