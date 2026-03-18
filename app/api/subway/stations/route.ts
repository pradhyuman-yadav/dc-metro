import { NextResponse } from "next/server";
import { getCachedStations, upsertStations, getStationsFetchedAt } from "@/lib/stations";
import { fetchSubwayStations } from "@/lib/overpass";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cached = getCachedStations();
    if (cached) {
      return NextResponse.json({
        stations: cached,
        cached: true,
        fetchedAt: getStationsFetchedAt(),
      });
    }

    const stations = await fetchSubwayStations();
    upsertStations(stations);

    return NextResponse.json({
      stations,
      cached: false,
      fetchedAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "upstream_error", message },
      { status: 502 }
    );
  }
}
