import { getSimServer } from "@/lib/sim-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sim = getSimServer();
  await sim.ensureInitialized();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately so the client renders on first connect
      controller.enqueue(encoder.encode(`data: ${sim.snapshot()}\n\n`));

      // Subscribe to server broadcasts
      const unsub = sim.subscribe((data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller already closed — subscriber will be cleaned up on abort
        }
      });

      // Clean up when the client disconnects
      request.signal.addEventListener("abort", () => {
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx proxy buffering
    },
  });
}
