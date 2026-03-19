import { NextResponse } from "next/server";
import { getTrainStates, upsertTrainStates } from "@/lib/stations";
import type { TrainState } from "@/lib/simulation";

/** GET /api/subway/trains — return saved train states */
export async function GET() {
  try {
    const result = getTrainStates();
    if (!result) {
      return NextResponse.json({ states: [], savedAt: null });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[trains] GET error", err);
    return NextResponse.json({ error: "Failed to read train states" }, { status: 500 });
  }
}

/** POST /api/subway/trains — persist current train states */
export async function POST(req: Request) {
  try {
    const body = await req.json() as TrainState[];
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be an array of TrainState" }, { status: 400 });
    }
    upsertTrainStates(body);
    return NextResponse.json({ ok: true, saved: body.length });
  } catch (err) {
    console.error("[trains] POST error", err);
    return NextResponse.json({ error: "Failed to save train states" }, { status: 500 });
  }
}
