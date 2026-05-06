import { NextRequest, NextResponse } from "next/server";
import { clearAll, upsertRoutes, upsertStations } from "@/lib/stations";
import { fetchSubwayRoutes, fetchSubwayStations } from "@/lib/overpass";

export const dynamic = "force-dynamic";

type Target = "routes" | "stations" | "all";

export async function POST(req: NextRequest) {
  let target: Target = "all";

  // Only attempt to parse body if Content-Type suggests JSON
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    let text: string;
    try {
      text = await req.text();
    } catch {
      text = "";
    }
    if (text.trim()) {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
      }
      if (
        body !== null &&
        typeof body === "object" &&
        "target" in body &&
        (body as Record<string, unknown>).target !== undefined
      ) {
        const t = (body as Record<string, unknown>).target;
        if (t === "routes" || t === "stations") {
          target = t as Target;
        } else if (t !== "all" && t !== undefined) {
          return NextResponse.json({ error: "target must be 'routes', 'stations', or 'all'" }, { status: 400 });
        }
      }
    }
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
