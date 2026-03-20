import { getSimServer } from "@/lib/sim-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { routeRef?: string };
    if (typeof body.routeRef !== "string") {
      return Response.json({ error: "routeRef required" }, { status: 400 });
    }
    const sim = getSimServer();
    await sim.ensureInitialized();
    sim.removeTrain(body.routeRef);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
