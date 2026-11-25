import { z } from "zod";
import { creativeAgentApi } from "@/lib/creative-agent/api";
import {
  requireCreativeAgentCanvas,
  requireCreativeAgentUser,
} from "@/lib/creative-agent/access";
import { creativeAgentStore } from "@/lib/creative-agent/store";
import { isCreativeAgentRunActive } from "@/lib/creative-agent/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const actorUserId = await requireCreativeAgentUser(request);
    let after = z.coerce
      .number()
      .int()
      .nonnegative()
      .safe()
      .parse(new URL(request.url).searchParams.get("after") || 0);
    const run = await creativeAgentStore.getRun(params.id, actorUserId);
    await requireCreativeAgentCanvas(actorUserId, run.canvasId);
    const encoder = new TextEncoder();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const cancel = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      wake?.();
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const deadline = Date.now() + 25_000;
        let status = "";
        let mediaState = "";
        let terminalDrained = false;
        try {
          while (
            !cancelled &&
            !request.signal.aborted &&
            Date.now() < deadline
          ) {
            const batch = await creativeAgentStore.events(
              run.id,
              actorUserId,
              after,
            );
            if (cancelled || request.signal.aborted) break;
            const nextMediaState = JSON.stringify([batch.media, batch.mediaPending, batch.editableMessageId]);
            const drained = batch.nextSequence <= after;
            const nextTerminalDrained = !isCreativeAgentRunActive(batch.run.status) && drained;
            if (batch.events.length || status !== batch.run.status || mediaState !== nextMediaState || (nextTerminalDrained && !terminalDrained)) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(batch)}\n\n`),
              );
              status = batch.run.status;
              mediaState = nextMediaState;
            }
            terminalDrained = nextTerminalDrained;
            after = batch.nextSequence;
            if (!isCreativeAgentRunActive(batch.run.status) && !batch.mediaPending && drained) {
              controller.enqueue(
                encoder.encode("event: complete\ndata: {}\n\n"),
              );
              break;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, batch.events.length >= 200 ? 0 : 1200);
            });
          }
        } catch {
          if (!cancelled)
            controller.enqueue(
              encoder.encode("event: reconnect\ndata: {}\n\n"),
            );
        } finally {
          request.signal.removeEventListener("abort", cancel);
          if (timer) clearTimeout(timer);
          if (!cancelled) controller.close();
        }
      },
      cancel,
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return creativeAgentApi(async () => {
      throw error;
    });
  }
}
