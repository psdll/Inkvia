import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { creativeAgentApi } from "@/lib/creative-agent/api";
import { requireDebugRun } from "@/lib/creative-agent/debug-access";
import { readDebugBatch, requireDebugStorage } from "@/lib/creative-agent/debug-store";
import { isCreativeAgentRunActive } from "@/lib/creative-agent/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireDebugRun(request, params.id);
    await requireDebugStorage();
    const query = new URL(request.url).searchParams;
    let after = z.coerce.number().int().nonnegative().safe().parse(query.get("after") || 0);
    let publicAfter = z.coerce.number().int().nonnegative().safe().parse(query.get("publicAfter") || 0);
    const cancel = new AbortController();
    const abort = () => cancel.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) cancel.abort();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const deadline = Date.now() + 25_000;
        let terminalSince = 0;
        try {
          while (!cancel.signal.aborted && Date.now() < deadline) {
            // Revalidate current admin token, run owner and canvas access on every batch.
            const run = await requireDebugRun(request, params.id);
            const batch = await readDebugBatch(run, after, publicAfter);
            if (cancel.signal.aborted) break;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(batch)}\n\n`));
            after = batch.nextSequence; publicAfter = batch.nextPublicSequence;
            if (!isCreativeAgentRunActive(run.status) && !batch.events.length && !batch.hasMore) {
              terminalSince ||= Date.now();
              if (Date.now() - terminalSince >= 2000) { controller.enqueue(encoder.encode("event: complete\ndata: {}\n\n")); break; }
            } else terminalSince = 0;
            await delay(batch.hasMore ? 0 : 500, undefined, { signal: cancel.signal });
          }
        } catch (error) {
          if (!cancel.signal.aborted) {
            const forbidden = [401, 403, 404].includes(Number((error as { status?: number }).status));
            controller.enqueue(encoder.encode(`event: ${forbidden ? "forbidden" : "reconnect"}\ndata: {}\n\n`));
          }
        } finally {
          request.signal.removeEventListener("abort", abort);
          if (!cancel.signal.aborted) controller.close();
        }
      },
      cancel: abort,
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return creativeAgentApi(async () => { throw error; }); }
}
