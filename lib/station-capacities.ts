/**
 * WMATA station passenger capacities (approximate peak-hour load).
 *
 * Tiers:
 *   1200 — major downtown hubs (Metro Center, Gallery Place, etc.)
 *   800  — medium transfer/suburban stations
 *   300  — terminal / low-ridership stations
 *   500  — default for any unlisted station
 */
export const STATION_CAPACITIES: Map<string, number> = new Map([
  // ── Major hubs (1200) ────────────────────────────────────────────────────────
  ["Metro Center", 1200],
  ["Gallery Place-Chinatown", 1200],
  ["Union Station", 1200],
  ["L'Enfant Plaza", 1200],
  ["Pentagon", 1200],
  ["Farragut North", 1200],
  ["Farragut West", 1200],

  // ── Medium stations (800) ────────────────────────────────────────────────────
  ["Bethesda", 800],
  ["Rosslyn", 800],
  ["Dupont Circle", 800],
  ["Silver Spring", 800],
  ["Crystal City", 800],
  ["Pentagon City", 800],
  ["Ronald Reagan Washington National Airport", 800],
  ["Tenleytown-AU", 800],
  ["Cleveland Park", 800],
  ["Friendship Heights", 800],
  ["Woodley Park-Zoo/Adams Morgan", 800],
  ["Columbia Heights", 800],
  ["Shaw-Howard U", 800],
  ["NoMa-Gallaudet U", 800],
  ["Waterfront", 800],
  ["Navy Yard-Ballpark", 800],
  ["Anacostia", 800],
  ["Foggy Bottom-GWU", 800],
  ["Judiciary Square", 800],
  ["Archives-Navy Memorial-Penn Quarter", 800],
  ["Smithsonian", 800],
  ["Federal Triangle", 800],
  ["McPherson Square", 800],
  ["Federal Center SW", 800],
  ["Capitol South", 800],
  ["Eastern Market", 800],
  ["Stadium-Armory", 800],
  ["Rhode Island Ave-Brentwood", 800],
  ["Fort Totten", 800],
  ["Takoma", 800],
  ["White Flint", 800],
  ["Rockville", 800],
  ["Wheaton", 800],
  ["Grosvenor-Strathmore", 800],
  ["Medical Center", 800],
  ["Van Ness-UDC", 800],
  ["Ballston-MU", 800],
  ["Virginia Square-GMU", 800],
  ["Clarendon", 800],
  ["Court House", 800],
  ["Arlington Cemetery", 800],
  ["King St-Old Town", 800],
  ["Braddock Road", 800],
  ["Van Dorn Street", 800],
  ["Eisenhower Avenue", 800],
  ["Landover", 800],
  ["New Carrollton", 800],
  ["College Park-U of Md", 800],

  // ── Standard stations (500) — listed explicitly for clarity ─────────────────
  ["Cheverly", 500],
  ["Deanwood", 500],
  ["Benning Road", 500],
  ["Capitol Heights", 500],
  ["Addison Road-Seat Pleasant", 500],
  ["Minnesota Ave", 500],
  ["Congress Heights", 500],
  ["Southern Ave", 500],
  ["Naylor Road", 500],
  ["Suitland", 500],
  ["Brookland-CUA", 500],
  ["Catholic University", 500],
  ["Hyattsville Crossing", 500],
  ["Prince George's Plaza", 500],
  ["West Hyattsville", 500],
  ["Greenbelt", 500],
  ["Franconia-Springfield", 500],   // classified 300 in tiers but served well
  ["West Falls Church-VT/UVA", 500],
  ["East Falls Church", 500],
  ["Tysons Corner", 500],
  ["Greensboro", 500],
  ["Spring Hill", 500],
  ["Wiehle-Reston East", 500],
  ["Reston Town Center", 500],
  ["Herndon", 500],
  ["Innovation Center", 500],
  ["Washington Dulles International Airport", 500],
  ["Loudoun Gateway", 500],
  ["Minnesota Avenue", 500],

  // ── Terminals / low-ridership (300) ──────────────────────────────────────────
  ["Vienna/Fairfax-GMU", 300],
  ["Shady Grove", 300],
  ["Glenmont", 300],
  ["Branch Ave", 300],
  ["Largo Town Center", 300],
  ["Ashburn", 300],
  ["Huntington", 300],
  ["Morgan Blvd", 300],
  ["Downtown Largo", 300],
]);

/**
 * Returns the passenger capacity for a given station name.
 * Falls back to 500 for any station not in the table.
 */
export function getStationCapacity(stationName: string): number {
  return STATION_CAPACITIES.get(stationName) ?? 500;
}
