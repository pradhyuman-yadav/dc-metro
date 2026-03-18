import { NextResponse } from "next/server";
import { getCachedRoutes, upsertRoutes, getRoutesFetchedAt } from "@/lib/stations";
import { fetchSubwayRoutes } from "@/lib/overpass";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cached = getCachedRoutes();
    if (cached) {
      return NextResponse.json({
        routes: cached,
        cached: true,
        fetchedAt: getRoutesFetchedAt(),
      });
    }

    const routes = await fetchSubwayRoutes();
    upsertRoutes(routes);

    return NextResponse.json({
      routes,
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
