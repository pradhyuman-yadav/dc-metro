import { NextResponse } from "next/server";
import { getStationPassengers, upsertStationPassengers } from "@/lib/stations";

export async function GET() {
  try {
    const map = getStationPassengers();
    const entries = Array.from(map.entries()).map(([stationName, v]) => ({
      stationName,
      capacity: v.capacity,
      current: v.current,
    }));
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[station-passengers] GET error", err);
    return NextResponse.json({ error: "Failed to load station passengers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Array<{
      stationName: string;
      capacity: number;
      current: number;
    }>;
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be an array" }, { status: 400 });
    }
    upsertStationPassengers(body);
    return NextResponse.json({ ok: true, saved: body.length });
  } catch (err) {
    console.error("[station-passengers] POST error", err);
    return NextResponse.json({ error: "Failed to save station passengers" }, { status: 500 });
  }
}
