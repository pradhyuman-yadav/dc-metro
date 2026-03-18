import { NextRequest, NextResponse } from "next/server";
import { clearAll, upsertRoutes, upsertStations } from "@/lib/stations";
import { fetchSubwayRoutes, fetchSubwayStations } from "@/lib/overpass";

export const dynamic = "force-dynamic";

type Target = "routes" | "stations" | "all";

export async function POST(req: NextRequest) {
  let target: Target = "all";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.target === "routes" || body?.target === "stations") {
      target = body.target as Target;
    }
  } catch {
    // malformed body — default to "all"
  }

  clearAll();

  const refreshed: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  try {
    const fetches: Promise<void>[] = [];

    if (target === "routes" || target === "all") {
      fetches.push(
        fetchSubwayRoutes().then((routes) => {
          upsertRoutes(routes);
          refreshed.push("routes");
        })
      );
    }

    if (target === "stations" || target === "all") {
      fetches.push(
        fetchSubwayStations().then((stations) => {
          upsertStations(stations);
          refreshed.push("stations");
        })
      );
    }

    await Promise.all(fetches);

    return NextResponse.json({ refreshed, fetchedAt: now });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "upstream_error", message },
      { status: 502 }
    );
  }
}
