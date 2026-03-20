export interface SubwayRoute {
  id: number;
  name: string;
  ref: string;
  colour: string;
  /** Ordered [lat, lng] pairs per way member */
  segments: [number, number][][];
}

interface OverpassMember {
  type: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: OverpassMember[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

/** DC metro area bounding box [south, west, north, east] */
export const DC_BBOX: [number, number, number, number] = [38.79, -77.25, 39.01, -76.87];

/**
 * WMATA Metro line colours from OSM colour tags.
 * Fallback when a route has no colour tag.
 */
export const SUBWAY_COLOUR_FALLBACK = "#666666";

/** Returns the route colour — prefers OSM colour tag if valid hex */
export function getSubwayColour(tagColour?: string): string {
  if (tagColour && /^#[0-9A-Fa-f]{3,6}$/.test(tagColour)) return tagColour;
  return SUBWAY_COLOUR_FALLBACK;
}

/** Overpass QL query — only subway route relations in the DC bbox */
export function buildSubwayQuery(
  bbox: [number, number, number, number] = DC_BBOX
): string {
  const [s, w, n, e] = bbox;
  return (
    `[out:json][timeout:20];` +
    `rel["type"="route"]["route"="subway"](${s},${w},${n},${e});` +
    `out geom;`
  );
}

/**
 * Legacy OSM relation IDs that are superseded by newer WMATA route relations.
 * These truncated/outdated relations cause >2 km stitching jumps and must be
 * excluded from both route rendering and simulation:
 *
 * Silver Line — old relations used "Downtown Largo" as the eastern terminus;
 * replaced by IDs 19274066 / 19274067 which correctly terminate at New Carrollton.
 *   3031441  Downtown Largo → Ashburn  (superseded)
 *   7919736  Ashburn → Downtown Largo  (superseded)
 *
 * Yellow Line — old relations used "Mount Vernon Square" as the northern terminus;
 * replaced by IDs 20048303 / 20048304 which correctly terminate at Greenbelt.
 *   918503   Mount Vernon Square → Huntington  (superseded)
 *   7572166  Huntington → Mount Vernon Square  (superseded)
 */
export const EXCLUDED_RELATION_IDS = new Set<number>([
  3031441, // Silver Line: Downtown Largo → Ashburn (superseded)
  7919736, // Silver Line: Ashburn → Downtown Largo (superseded)
  918503,  // Yellow Line: Mount Vernon Square → Huntington (superseded)
  7572166, // Yellow Line: Huntington → Mount Vernon Square (superseded)
]);

/** Converts raw Overpass response into SubwayRoute[] */
export function parseSubwayResponse(data: OverpassResponse): SubwayRoute[] {
  return data.elements
    .filter((el) => el.type === "relation" && !!el.tags && !EXCLUDED_RELATION_IDS.has(el.id))
    .map((el) => {
      const tags = el.tags!;
      const segments: [number, number][][] = (el.members ?? [])
        .filter((m) => m.type === "way" && m.geometry && m.geometry.length >= 2)
        .map((m) => m.geometry!.map(({ lat, lon }) => [lat, lon] as [number, number]));

      return {
        id: el.id,
        name: tags["name"] ?? tags["ref"] ?? `Route ${el.id}`,
        ref: tags["ref"] ?? "",
        colour: getSubwayColour(tags["colour"]),
        segments: segments.filter((s) => s.length >= 2),
      };
    })
    .filter((r) => r.segments.length > 0);
}

/**
 * Groups loaded routes by their `ref` tag and pairs the two directional
 * relations that make up each physical line.
 *
 * DC Metro OSM data has exactly 2 route relations per line — one per direction.
 * Both share the same `ref` value (e.g. "R", "B", "S").  The pair map lets
 * the simulation transition a train from the outbound relation to the inbound
 * relation at the terminus, and back again, so trains never reverse direction
 * on a one-way track.
 *
 * Returns a bidirectional map:  routeId → partnerRouteId
 * Routes whose ref appears only once (unpaired) are omitted.
 */
export function pairRoutes(routes: SubwayRoute[]): Map<number, number> {
  const byRef = new Map<string, SubwayRoute[]>();
  for (const r of routes) {
    const list = byRef.get(r.ref) ?? [];
    list.push(r);
    byRef.set(r.ref, list);
  }
  const pairs = new Map<number, number>();
  for (const [, group] of byRef) {
    if (group.length === 2) {
      pairs.set(group[0].id, group[1].id);
      pairs.set(group[1].id, group[0].id);
    }
  }
  return pairs;
}

/** Fetches DC Metro subway routes from Overpass (single call for all of DC) */
export async function fetchSubwayRoutes(
  bbox: [number, number, number, number] = DC_BBOX
): Promise<SubwayRoute[]> {
  const query = buildSubwayQuery(bbox);
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data: OverpassResponse = await res.json();
  return parseSubwayResponse(data);
}

// ─── Stations ─────────────────────────────────────────────────────────────────

export interface SubwayStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
  /** One colour per line serving this station (may be empty) */
  colours: string[];
}

/**
 * Derives stations directly from subway route-relation members rather than
 * relying on `station=subway` tags (which many WMATA stops lack).
 *
 * Strategy (single Overpass round-trip):
 *   1. Find all subway route relations in the bbox → stored in .routes
 *   2. Collect every node member whose role starts with "stop" → .stops
 *   3. Return both so the parser can build colour maps from relation members
 *      and attach lat/lon from node geometry.
 */
export function buildStationQuery(
  bbox: [number, number, number, number] = DC_BBOX
): string {
  const [s, w, n, e] = bbox;
  return (
    `[out:json][timeout:25];` +
    `rel["type"="route"]["route"="subway"](${s},${w},${n},${e})->.routes;` +
    `(` +
    // Nodes that are explicit stop members of route relations (any role variant)
    `node(r.routes:"stop");` +
    `node(r.routes:"stop_entry_only");` +
    `node(r.routes:"stop_exit_only");` +
    // All nodes tagged station=subway in the bbox — this catches every WMATA
    // station regardless of how (or whether) it appears in route relations.
    // Some lines (Orange, Blue) store their stops as nested stop_area sub-relations
    // or way members rather than bare node members, so the relation-based filter
    // above misses them entirely.
    `node["station"="subway"](${s},${w},${n},${e});` +
    `)->.stops;` +
    `(.stops;.routes;);` +
    `out body;`
  );
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: Array<{ type: string; ref: number; role: string }>;
}

/** Converts the combined station+relation response into SubwayStation[] */
export function parseStationResponse(
  data: OverpassResponse
): SubwayStation[] {
  // Step 1: deduplicate node elements by OSM id.
  // The Overpass union can return the same node id more than once when a node
  // satisfies multiple role filters (e.g. "stop" in one line AND
  // "stop_entry_only" in another).
  const nodeMap = new Map<number, OverpassNode>();
  for (const el of data.elements) {
    if (el.type === "node" && !nodeMap.has(el.id)) {
      nodeMap.set(el.id, el as OverpassNode);
    }
  }

  const relations = data.elements.filter(
    (el): el is OverpassRelation =>
      el.type === "relation" && !EXCLUDED_RELATION_IDS.has(el.id)
  );

  // Build map: node id → set of line colours (from parent route relations)
  const coloursByNodeId = new Map<number, Set<string>>();
  for (const rel of relations) {
    const colour = getSubwayColour(rel.tags?.["colour"]);
    for (const member of rel.members ?? []) {
      if (member.type === "node") {
        const set = coloursByNodeId.get(member.ref) ?? new Set<string>();
        set.add(colour);
        coloursByNodeId.set(member.ref, set);
      }
    }
  }

  // Step 2: deduplicate by station name.
  // Multi-level stations (e.g. Metro Center) have one OSM node per platform,
  // all sharing the same "name" tag. Collapse them into a single entry and
  // merge their line colours. Nodes with no name tag are skipped — they are
  // typically entrance/exit-only nodes, not named stop positions.
  const byName = new Map<string, SubwayStation>();

  for (const node of nodeMap.values()) {
    const name = node.tags?.["name"];
    if (!name) continue; // skip unnamed entrance / platform nodes

    const colours = Array.from(coloursByNodeId.get(node.id) ?? []);
    const existing = byName.get(name);

    if (existing) {
      // Merge colours from all nodes that share the same station name
      byName.set(name, {
        ...existing,
        colours: Array.from(new Set([...existing.colours, ...colours])),
      });
    } else {
      byName.set(name, {
        id: node.id,
        name,
        lat: node.lat,
        lng: node.lon,
        colours,
      });
    }
  }

  return Array.from(byName.values());
}

/** Fetches DC Metro subway stations from Overpass */
export async function fetchSubwayStations(
  bbox: [number, number, number, number] = DC_BBOX
): Promise<SubwayStation[]> {
  const query = buildStationQuery(bbox);
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data: OverpassResponse = await res.json();
  return parseStationResponse(data);
}
