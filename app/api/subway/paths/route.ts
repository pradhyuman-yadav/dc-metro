import { NextResponse } from "next/server";
import { getCachedRoutePaths, upsertRoutePaths } from "@/lib/stations";
import type { RoutePath } from "@/lib/simulation";

/** GET /api/subway/paths — return cached stitched+smoothed route paths */
export async function GET() {
  try {
    const paths = getCachedRoutePaths();
    return NextResponse.json({ paths: paths ?? [] });
  } catch (err) {
    console.error("[paths] GET error", err);
    return NextResponse.json({ error: "Failed to read route paths" }, { status: 500 });
  }
}

/** POST /api/subway/paths — persist stitched+smoothed route paths */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RoutePath[];
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: "Body must be an array of RoutePath" },
        { status: 400 }
      );
    }
    upsertRoutePaths(body);
    return NextResponse.json({ ok: true, saved: body.length });
  } catch (err) {
    console.error("[paths] POST error", err);
    return NextResponse.json({ error: "Failed to save route paths" }, { status: 500 });
  }
}
