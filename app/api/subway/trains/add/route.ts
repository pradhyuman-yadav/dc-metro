import { getSimServer } from "@/lib/sim-server";

export const dynamic = "force-dynamic";

const VALID_ROUTE_REFS = new Set(["RD", "OR", "SV", "BL", "YL", "GR"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { routeRef?: string };
    if (typeof body.routeRef !== "string") {
      return Response.json({ error: "routeRef required" }, { status: 400 });
    }
    if (!VALID_ROUTE_REFS.has(body.routeRef)) {
      return Response.json({ error: `invalid routeRef: must be one of ${[...VALID_ROUTE_REFS].join(", ")}` }, { status: 400 });
    }
    const sim = getSimServer();
    await sim.ensureInitialized();
    sim.addTrain(body.routeRef);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
